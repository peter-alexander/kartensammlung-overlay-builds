#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${WIEN_BUILDINGS_PUBLIC_BASE_URL:-https://tiles.radlobby.at/WienBuildings/LOD1}"
MAP_ORIGIN="${WIEN_BUILDINGS_MAP_ORIGIN:-https://fahrrad.lima-city.de}"
WORK_DIR="$(mktemp -d)"
CACHE_BUST="$(date +%s)"
trap 'rm -rf "$WORK_DIR"' EXIT

log() {
	printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
	log "FEHLER: $*"
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "Benötigtes Programm fehlt: $1"
}

assert_cors() {
	local headers="$1"
	local relative="$2"
	local value

	value="$(
		awk 'BEGIN { IGNORECASE=1 }
			/^Access-Control-Allow-Origin:/ {
				sub(/\r$/, "");
				sub(/^[^:]+:[[:space:]]*/, "");
				print
			}' "$headers" | tail -n 1
	)"

	[ -n "$value" ] || die "$relative: Access-Control-Allow-Origin fehlt"
	if [ "$value" != "*" ] && [ "$value" != "$MAP_ORIGIN" ]; then
		die "$relative: unerwartetes Access-Control-Allow-Origin: $value"
	fi
}

fetch_public() {
	local relative="$1"
	local output="$2"
	local headers="$3"
	local separator='?'
	local status

	if [[ "$relative" == *\?* ]]; then
		separator='&'
	fi

	rm -f "$output" "$headers"
	status="$(
		curl \
			--silent \
			--show-error \
			--location \
			--fail-with-body \
			--retry 5 \
			--retry-delay 3 \
			--retry-all-errors \
			--connect-timeout 20 \
			--max-time 90 \
			--header "Origin: $MAP_ORIGIN" \
			--header 'Cache-Control: no-cache' \
			--dump-header "$headers" \
			--output "$output" \
			--write-out '%{http_code}' \
			"$BASE_URL/$relative${separator}verify=$CACHE_BUST"
	)" || die "$relative: Download fehlgeschlagen"

	[ "$status" = "200" ] || die "$relative: erwartet HTTP 200, erhalten $status"
	[ -s "$output" ] || die "$relative: leere Antwort"
	assert_cors "$headers" "$relative"
}

verify_manifests() {
	local release="$WORK_DIR/release.json"
	local release_headers="$WORK_DIR/release.headers"
	local tilejson="$WORK_DIR/tilejson.json"
	local tilejson_headers="$WORK_DIR/tilejson.headers"

	log "Prüfe release.json und CORS"
	fetch_public "release.json" "$release" "$release_headers"

	log "Prüfe tilejson.json und CORS"
	fetch_public "tilejson.json" "$tilejson" "$tilejson_headers"

	node - "$release" "$tilejson" "$WORK_DIR/samples.tsv" <<'NODE'
const fs = require("fs");

const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const tilejson = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const samplesPath = process.argv[4];
const expectedZooms = [10, 11, 12, 13, 14, 15];
const vectorTiles = release?.vectorTiles;

if (!vectorTiles || vectorTiles.layer !== "wien_buildings") {
	throw new Error("release.json: Wiener Gebäudelayer fehlt");
}
if (Number(vectorTiles.minzoom) !== 10 || Number(vectorTiles.maxzoom) !== 15) {
	throw new Error(
		`release.json: unerwarteter Zoombereich ${vectorTiles.minzoom}-${vectorTiles.maxzoom}`
	);
}
if (Number(tilejson?.minzoom) !== 10 || Number(tilejson?.maxzoom) !== 15) {
	throw new Error(
		`tilejson.json: unerwarteter Zoombereich ${tilejson?.minzoom}-${tilejson?.maxzoom}`
	);
}
if (!Array.isArray(tilejson?.tiles) || !tilejson.tiles.length) {
	throw new Error("tilejson.json: tiles fehlt");
}

const tileCounts = vectorTiles.tileCounts || {};
const sampleTiles = vectorTiles.sampleTiles || {};
const rows = [];

for (const zoom of expectedZooms) {
	const count = Number(tileCounts[zoom]);
	const sample = String(sampleTiles[zoom] || "");
	if (!(count > 0)) {
		throw new Error(`release.json: keine Kacheln für Z${zoom}`);
	}
	if (!new RegExp(`^${zoom}/\\d+/\\d+$`).test(sample)) {
		throw new Error(`release.json: ungültige Beispielkachel für Z${zoom}: ${sample}`);
	}
	rows.push(`${zoom}\t${sample}`);
}

fs.writeFileSync(samplesPath, rows.join("\n") + "\n", "utf8");
console.log(
	"Manifest OK: "
	+ expectedZooms.map((zoom) => `Z${zoom}=${tileCounts[zoom]}`).join(", ")
);
NODE
}

verify_sample_tiles() {
	local samples="$WORK_DIR/samples.tsv"

	while IFS=$'\t' read -r zoom key; do
		[ -n "$zoom" ] || continue
		local relative="tiles/$key.pbf"
		local body="$WORK_DIR/tile-$zoom.pbf"
		local headers="$WORK_DIR/tile-$zoom.headers"

		log "Prüfe Z$zoom Beispielkachel und CORS: $relative"
		fetch_public "$relative" "$body" "$headers"

		local bytes
		bytes="$(wc -c < "$body" | tr -d ' ')"
		[ "$bytes" -ge 16 ] || die "$relative: verdächtig kleine PBF-Antwort ($bytes Byte)"
		log "Z$zoom OK: $bytes Byte, HTTP 200, CORS vorhanden"
	done < "$samples"
}

main() {
	require_command curl
	require_command node

	verify_manifests
	verify_sample_tiles
	log "Öffentliche Wiener Gebäudekacheln Z10-Z15 vollständig geprüft."
}

main "$@"
