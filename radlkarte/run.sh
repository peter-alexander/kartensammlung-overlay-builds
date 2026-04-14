#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INPUT_DIR="$SCRIPT_DIR/input"
BUILD_DIR="$SCRIPT_DIR/build"
TIPPECANOE_BIN="${TIPPECANOE_BIN:-tippecanoe}"

PUBLISH_DIR="${PUBLISH_DIR:-$BUILD_DIR/Radlkarte}"
PUBLISHED_PMTILES_FILE="$PUBLISH_DIR/radlkarte.pmtiles"
TMP_PMTILES_FILE="$BUILD_DIR/.radlkarte.pmtiles"
LAYER_NAME="radlkarte"
GITHUB_OWNER="markusstraub"
GITHUB_REPO="radlkarte"
GITHUB_DATA_PATH="data"
GITHUB_REF="${GITHUB_REF:-main}"
GITHUB_API_URL="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_DATA_PATH}?ref=${GITHUB_REF}&per_page=100"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

log() {
	printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_file() {
	local file="$1"
	if [ ! -f "$file" ]; then
		log "Datei fehlt: $file"
		exit 1
	fi
}

validate_geojson() {
	local file="$1"
	node --eval '
		const fs = require("node:fs");
		const file = process.argv[1];
		let data;
		try {
			data = JSON.parse(fs.readFileSync(file, "utf8"));
		}
		catch (error) {
			console.error(`Ungültiges JSON: ${file}`);
			process.exit(1);
		}
		if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
			console.error(`Keine gültige GeoJSON FeatureCollection: ${file}`);
			process.exit(1);
		}
	' "$file"
}

validate_pmtiles_magic() {
	local file="$1"
	node --eval '
		const fs = require("node:fs");
		const file = process.argv[1];
		const fd = fs.openSync(file, "r");
		const header = Buffer.alloc(7);
		fs.readSync(fd, header, 0, 7, 0);
		fs.closeSync(fd);
		if (header.toString("utf8") !== "PMTiles") {
			console.error(`Ungültiger PMTiles-Header in ${file}: ${header.toString("hex")}`);
			process.exit(1);
		}
	' "$file"
}

github_headers() {
	local accept_header="$1"

	if [ -n "$GITHUB_TOKEN" ]; then
		printf -- "-H\0Authorization: Bearer %s\0-H\0Accept: %s\0-H\0X-GitHub-Api-Version: 2022-11-28\0" "$GITHUB_TOKEN" "$accept_header"
		return
	fi

	printf -- "-H\0Accept: %s\0-H\0X-GitHub-Api-Version: 2022-11-28\0" "$accept_header"
}

publish_pmtiles_atomically() {
	local source_file="$1"
	local target_file="$2"
	local target_dir
	local tmp_target

	target_dir="$(dirname -- "$target_file")"
	tmp_target="$target_dir/.radlkarte.pmtiles.tmp"

	mkdir -p "$target_dir"
	cp "$source_file" "$tmp_target"
	mv -f "$tmp_target" "$target_file"
}

mkdir -p "$INPUT_DIR" "$BUILD_DIR"

command -v curl >/dev/null 2>&1
command -v node >/dev/null 2>&1
command -v "$TIPPECANOE_BIN" >/dev/null 2>&1

log "Hole Dateiliste von GitHub"
readarray -d '' -t api_headers < <(github_headers "application/vnd.github+json")
manifest_json="$(curl --fail --silent --show-error --location \
	"${api_headers[@]}" \
	"$GITHUB_API_URL")"

mapfile -t file_rows < <(
	node --eval '
		const input = process.argv[1];
		const entries = JSON.parse(input);
		if (!Array.isArray(entries)) process.exit(0);
		for (const entry of entries) {
			if (!entry || entry.type !== "file") continue;
			if (typeof entry.name !== "string" || typeof entry.download_url !== "string") continue;
			if (!entry.name.endsWith(".geojson")) continue;
			if (/example|rendertest/i.test(entry.name)) continue;
			process.stdout.write(`${entry.name}\t${entry.download_url}\n`);
		}
	' "$manifest_json"
)

if [ "${#file_rows[@]}" -eq 0 ]; then
	log "Keine passenden GeoJSON-Dateien in ${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_DATA_PATH} gefunden"
	exit 1
fi

changed=0
expected_geojson_files=()

for row in "${file_rows[@]}"; do
	name="${row%%$'\t'*}"
	download_url="${row#*$'\t'}"
	local_file="$INPUT_DIR/$name"
	etag_file="$local_file.etag"
	tmp_file="$local_file.tmp"

	log "Prüfe $name"
	expected_geojson_files+=("$name")

	readarray -d '' -t headers < <(github_headers "application/octet-stream")

	if [ -s "$etag_file" ]; then
		etag_value="$(cat "$etag_file")"
		headers+=( -H "If-None-Match: $etag_value" )
	fi

	status="$(curl --silent --show-error --location \
		--output "$tmp_file" \
		--dump-header "$tmp_file.headers" \
		--write-out '%{http_code}' \
		"${headers[@]}" \
		"$download_url")"

	if [ "$status" = "304" ]; then
		rm -f "$tmp_file" "$tmp_file.headers"
		log "→ Keine Änderung"
		continue
	fi

	if [ "$status" != "200" ]; then
		rm -f "$tmp_file" "$tmp_file.headers"
		log "Download fehlgeschlagen für $name (HTTP $status)"
		exit 1
	fi

	mv "$tmp_file" "$local_file"
	validate_geojson "$local_file"

	etag_line="$(awk 'tolower($1)=="etag:" {print $2; exit}' "$tmp_file.headers" | tr -d $'\r')"
	rm -f "$tmp_file.headers"
	if [ -n "$etag_line" ]; then
		echo "$etag_line" > "$etag_file"
	fi

	changed=1
	log "→ Aktualisiert"
done

# Entfernte Dateien auch lokal entfernen, damit sie nicht mehr in PMTiles landen.
shopt -s nullglob
local_geojson_files=("$INPUT_DIR"/*.geojson)
for local_path in "${local_geojson_files[@]}"; do
	local_name="$(basename -- "$local_path")"
	keep_file=0

	for expected_name in "${expected_geojson_files[@]}"; do
		if [ "$local_name" = "$expected_name" ]; then
			keep_file=1
			break
		fi
	done

	if [ "$keep_file" -eq 0 ]; then
		log "Entferne lokal veraltete Datei: $local_name"
		rm -f "$local_path" "$local_path.etag"
		changed=1
	fi
done

geojson_files=("$INPUT_DIR"/*.geojson)

if [ "${#geojson_files[@]}" -eq 0 ]; then
	log "Keine GeoJSON-Dateien für Tippecanoe vorhanden"
	exit 1
fi

if [ "$changed" -eq 0 ] && [ -f "$PUBLISHED_PMTILES_FILE" ]; then
	log "Keine Änderungen erkannt, bestehende PMTiles bleibt unverändert"
	exit 0
fi

log "Erzeuge PMTiles"
"$TIPPECANOE_BIN" \
	-Z5 \
	-z14 \
	-B5 \
	--force \
	--no-feature-limit \
	--no-tile-size-limit \
	--no-feature-limit \
	--layer="$LAYER_NAME" \
	-o "$TMP_PMTILES_FILE" \
	"${geojson_files[@]}"

require_file "$TMP_PMTILES_FILE"
validate_pmtiles_magic "$TMP_PMTILES_FILE"
publish_pmtiles_atomically "$TMP_PMTILES_FILE" "$PUBLISHED_PMTILES_FILE"
rm -f "$TMP_PMTILES_FILE"

require_file "$PUBLISHED_PMTILES_FILE"
log "Radlkarte-Build fertig: $PUBLISHED_PMTILES_FILE"
