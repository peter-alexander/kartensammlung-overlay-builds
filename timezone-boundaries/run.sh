#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INPUT_DIR="$SCRIPT_DIR/input"
BUILD_DIR="$SCRIPT_DIR/build"
TMP_DIR="$BUILD_DIR/tmp"
PUBLISH_DIR="${PUBLISH_DIR:-$BUILD_DIR/TimezoneBoundaries}"
PUBLISHED_PMTILES_FILE="$PUBLISH_DIR/timezone-boundaries.pmtiles"
PUBLISHED_RELEASE_FILE="$PUBLISH_DIR/release.json"
TMP_PMTILES_FILE="$BUILD_DIR/.timezone-boundaries.pmtiles"

TIPPECANOE_BIN="${TIPPECANOE_BIN:-tippecanoe}"
LAYER_NAME="timezone_boundaries"
GITHUB_OWNER="evansiroky"
GITHUB_REPO="timezone-boundary-builder"
GITHUB_API_URL="https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
ASSET_NAME="${TIMEZONE_BOUNDARIES_ASSET_NAME:-timezones-with-oceans-now.geojson.zip}"

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

github_headers() {
	if [ -n "$GITHUB_TOKEN" ]; then
		printf -- "-H\0Authorization: Bearer %s\0-H\0Accept: application/vnd.github+json\0-H\0X-GitHub-Api-Version: 2022-11-28\0" "$GITHUB_TOKEN"
		return
	fi

	printf -- "-H\0Accept: application/vnd.github+json\0-H\0X-GitHub-Api-Version: 2022-11-28\0"
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
		const missingTzid = data.features.findIndex((feature) => {
			const properties = feature && feature.properties;
			return !properties || typeof properties.tzid !== "string" || properties.tzid.length === 0;
		});
		if (missingTzid !== -1) {
			console.error(`Feature ohne tzid in ${file}: ${missingTzid}`);
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

publish_atomically() {
	local source_file="$1"
	local target_file="$2"
	local target_dir
	local tmp_target

	target_dir="$(dirname -- "$target_file")"
	tmp_target="$target_dir/.$(basename -- "$target_file").tmp"

	mkdir -p "$target_dir"
	cp "$source_file" "$tmp_target"
	mv -f "$tmp_target" "$target_file"
}

mkdir -p "$INPUT_DIR" "$BUILD_DIR" "$TMP_DIR" "$PUBLISH_DIR"

command -v curl >/dev/null 2>&1
command -v node >/dev/null 2>&1
command -v unzip >/dev/null 2>&1
command -v "$TIPPECANOE_BIN" >/dev/null 2>&1

log "Prüfe neuesten Timezone Boundary Builder Release"
readarray -d '' -t api_headers < <(github_headers)
release_json="$(curl --fail --silent --show-error --location \
	"${api_headers[@]}" \
	"$GITHUB_API_URL")"

release_info="$(node --eval '
	const release = JSON.parse(process.argv[1]);
	const assetName = process.argv[2];
	const asset = (release.assets || []).find((item) => item && item.name === assetName);
	if (!release.tag_name || !asset || !asset.browser_download_url) {
		console.error(`Release-Asset nicht gefunden: ${assetName}`);
		process.exit(1);
	}
	process.stdout.write([
		release.tag_name,
		release.published_at || "",
		asset.name,
		asset.browser_download_url,
	].join("\t"));
' "$release_json" "$ASSET_NAME")"

latest_tag="${release_info%%$'\t'*}"
rest="${release_info#*$'\t'}"
published_at="${rest%%$'\t'*}"
rest="${rest#*$'\t'}"
asset_name="${rest%%$'\t'*}"
asset_url="${rest#*$'\t'}"

if [ -s "$PUBLISHED_RELEASE_FILE" ] && [ -f "$PUBLISHED_PMTILES_FILE" ]; then
	current_tag="$(node --eval '
		const fs = require("node:fs");
		const file = process.argv[1];
		try {
			const data = JSON.parse(fs.readFileSync(file, "utf8"));
			process.stdout.write(data.release || "");
		}
		catch {
			process.exit(0);
		}
	' "$PUBLISHED_RELEASE_FILE")"

	if [ "$current_tag" = "$latest_tag" ]; then
		log "Keine neue Zeitzonen-Version: $latest_tag"
		exit 0
	fi
fi

archive_file="$INPUT_DIR/$asset_name"
extracted_file="$INPUT_DIR/timezones.geojson"
tmp_archive="$archive_file.tmp"

log "Lade $asset_name ($latest_tag)"
curl --fail --silent --show-error --location \
	--output "$tmp_archive" \
	"$asset_url"
mv "$tmp_archive" "$archive_file"

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
unzip -q -o "$archive_file" -d "$TMP_DIR"

shopt -s nullglob
geojson_candidates=("$TMP_DIR"/*.geojson "$TMP_DIR"/*.json)
if [ "${#geojson_candidates[@]}" -ne 1 ]; then
	log "Erwartet genau eine GeoJSON-Datei im Release-Archiv, gefunden: ${#geojson_candidates[@]}"
	exit 1
fi

mv "${geojson_candidates[0]}" "$extracted_file"
validate_geojson "$extracted_file"

log "Erzeuge PMTiles"
"$TIPPECANOE_BIN" \
	-Z0 \
	-z8 \
	--force \
	--no-feature-limit \
	--no-tile-size-limit \
	--layer="$LAYER_NAME" \
	-o "$TMP_PMTILES_FILE" \
	"$extracted_file"

require_file "$TMP_PMTILES_FILE"
validate_pmtiles_magic "$TMP_PMTILES_FILE"
publish_atomically "$TMP_PMTILES_FILE" "$PUBLISHED_PMTILES_FILE"
rm -f "$TMP_PMTILES_FILE"

node --eval '
	const fs = require("node:fs");
	const file = process.argv[1];
	const data = {
		source: "evansiroky/timezone-boundary-builder",
		release: process.argv[2],
		published_at: process.argv[3],
		asset: process.argv[4],
		layer: process.argv[5],
		built_at: new Date().toISOString(),
	};
	fs.writeFileSync(file, `${JSON.stringify(data, null, "\t")}\n`);
' "$PUBLISHED_RELEASE_FILE.tmp" "$latest_tag" "$published_at" "$asset_name" "$LAYER_NAME"
publish_atomically "$PUBLISHED_RELEASE_FILE.tmp" "$PUBLISHED_RELEASE_FILE"
rm -f "$PUBLISHED_RELEASE_FILE.tmp"

require_file "$PUBLISHED_PMTILES_FILE"
require_file "$PUBLISHED_RELEASE_FILE"
log "Zeitzonen-Build fertig: $PUBLISHED_PMTILES_FILE"
