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

header_value() {
	local headers="$1"
	local name="$2"

	awk -v wanted="$name" '
		BEGIN { IGNORECASE=1 }
		{
			line=$0
			sub(/\r$/, "", line)
			separator=index(line, ":")
			if (!separator) next
			key=substr(line, 1, separator - 1)
			if (tolower(key) != tolower(wanted)) next
			value=substr(line, separator + 1)
			sub(/^[[:space:]]+/, "", value)
			print value
		}
	' "$headers" | tail -n 1
}

assert_cors() {
	local headers="$1"
	local relative="$2"
	local value

	value="$(header_value "$headers" 'Access-Control-Allow-Origin')"
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
const vectorTiles = release?.vectorTiles;

if (!vectorTiles || vectorTiles.layer !== "wien_buildings") {
	throw new Error("release.json: Wiener Gebäudelayer fehlt");
}
if (vectorTiles.compression !== "gzip") {
	throw new Error(`release.json: erwartete gzip-Kompression, erhalten ${vectorTiles.compression}`);
}

const minZoom = Number(vectorTiles.minzoom);
const maxZoom = Number(vectorTiles.maxzoom);
if (
	!Number.isInteger(minZoom)
	|| !Number.isInteger(maxZoom)
	|| minZoom < 0
	|| maxZoom > 24
	|| minZoom > maxZoom
) {
	throw new Error(
		`release.json: ungültiger Zoombereich ${vectorTiles.minzoom}-${vectorTiles.maxzoom}`
	);
}

if (Number(tilejson?.minzoom) !== minZoom || Number(tilejson?.maxzoom) !== maxZoom) {
	throw new Error(
		`tilejson.json: Zoombereich ${tilejson?.minzoom}-${tilejson?.maxzoom} stimmt nicht mit release.json ${minZoom}-${maxZoom} überein`
	);
}
if (!Array.isArray(tilejson?.tiles) || !tilejson.tiles.length) {
	throw new Error("tilejson.json: tiles fehlt");
}

const expectedZooms = Array.from(
	{ length: maxZoom - minZoom + 1 },
	(_, index) => minZoom + index
);
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
	`Manifest OK (${minZoom}-${maxZoom}): `
	+ expectedZooms.map((zoom) => `Z${zoom}=${tileCounts[zoom]}`).join(", ")
);
NODE
}

verify_tile() {
	local label="$1"
	local relative="$2"
	local body="$WORK_DIR/${label}.pbf"
	local headers="$WORK_DIR/${label}.headers"
	local bytes
	local content_encoding

	log "Prüfe $label, CORS und gzip-Auslieferung: $relative"
	fetch_public "$relative" "$body" "$headers"

	bytes="$(wc -c < "$body" | tr -d ' ')"
	[ "$bytes" -ge 16 ] || die "$relative: verdächtig kleine PBF-Antwort ($bytes Byte)"

	gzip -t "$body" || die "$relative: Antwort enthält keine gültigen gzip-Daten"
	content_encoding="$(header_value "$headers" 'Content-Encoding')"
	if [ "${content_encoding,,}" != "gzip" ]; then
		die "$relative: gzip-PBF wird ohne Content-Encoding: gzip ausgeliefert (erhalten: ${content_encoding:-<fehlt>})"
	fi

	log "$label OK: $bytes Byte, HTTP 200, CORS vorhanden, Content-Encoding: gzip"
}

verify_sample_tiles() {
	local samples="$WORK_DIR/samples.tsv"

	while IFS=$'\t' read -r zoom key; do
		[ -n "$zoom" ] || continue
		verify_tile "Z$zoom-Beispielkachel" "tiles/$key.pbf"
	done < "$samples"
}

main() {
	require_command curl
	require_command node
	require_command gzip

	verify_manifests
	verify_sample_tiles
	log "Öffentliche Wiener Gebäudekacheln anhand der veröffentlichten Zoomgrenzen vollständig geprüft."
}

main "$@"
