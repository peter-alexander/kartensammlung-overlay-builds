#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

INPUT_DIR="$SCRIPT_DIR/input"
OUTPUT_DIR="$SCRIPT_DIR/output"
BUILD_DIR="$SCRIPT_DIR/build"
NODE_SCRIPT="$SCRIPT_DIR/build.mjs"
TIPPECANOE_BIN="${TIPPECANOE_BIN:-tippecanoe}"
BUILD_PMTILES="${BUILD_PMTILES:-true}"
BUILD_PBF_TILES="${BUILD_PBF_TILES:-true}"

PMTILES_FILE="$BUILD_DIR/radparken.pmtiles"
PBF_DIR="$BUILD_DIR/tiles"

STRASSENGRAPH_URL="https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&typeName=ogdwien:STRASSENGRAPHOGD&srsName=EPSG:4326&outputFormat=json"
FAHRRADABSTELLANLAGE_URL="https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&typeName=ogdwien:FAHRRADABSTELLANLAGEOGD&srsName=EPSG:4326&outputFormat=json"

log() {
	printf '[%s] %s
' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

download_with_retry() {
	local url="$1"
	local outfile="$2"
	local attempt

	for attempt in 1 2 3; do
		if curl --fail --silent --show-error --location "$url" -o "$outfile" && [ -s "$outfile" ]; then
			return 0
		fi

		log "Download fehlgeschlagen: $url (Versuch $attempt von 3)"
		sleep 120
	done

	return 1
}

require_file() {
	local file="$1"

	if [ ! -f "$file" ]; then
		log "Datei fehlt: $file"
		exit 1
	fi
}

mkdir -p "$INPUT_DIR" "$OUTPUT_DIR" "$BUILD_DIR"
rm -rf "$INPUT_DIR"/* "$OUTPUT_DIR"/* "$BUILD_DIR"/*

require_file "$NODE_SCRIPT"
command -v node >/dev/null 2>&1
command -v "$TIPPECANOE_BIN" >/dev/null 2>&1

log "Lade WFS-Daten"
download_with_retry "$STRASSENGRAPH_URL" "$INPUT_DIR/STRASSENGRAPHOGD.json"
download_with_retry "$FAHRRADABSTELLANLAGE_URL" "$INPUT_DIR/FAHRRADABSTELLANLAGEOGD.json"

log "Starte Node-Build"
node "$NODE_SCRIPT" "$INPUT_DIR" "$OUTPUT_DIR"

log "Prüfe Build-Ergebnisse"
require_file "$OUTPUT_DIR/STRASSENGRAPHOGD.json"
require_file "$OUTPUT_DIR/FAHRRADABSTELLANLAGEOGD.json"
require_file "$OUTPUT_DIR/k25.geojson"
require_file "$OUTPUT_DIR/k45.geojson"
require_file "$OUTPUT_DIR/k60.geojson"
require_file "$OUTPUT_DIR/k70.geojson"
require_file "$OUTPUT_DIR/i25.geojson"
require_file "$OUTPUT_DIR/i45.geojson"
require_file "$OUTPUT_DIR/i60.geojson"
require_file "$OUTPUT_DIR/i70.geojson"

if [ "$BUILD_PMTILES" = true ]; then
	log "Erzeuge PMTiles"
	"$TIPPECANOE_BIN" 		-Z8 		-z17 		--force 		--no-tile-size-limit 		-o "$PMTILES_FILE" 		"$OUTPUT_DIR/FAHRRADABSTELLANLAGEOGD.json" 		"$OUTPUT_DIR/STRASSENGRAPHOGD.json" 		"$OUTPUT_DIR/k25.geojson" 		"$OUTPUT_DIR/k45.geojson" 		"$OUTPUT_DIR/k60.geojson" 		"$OUTPUT_DIR/k70.geojson" 		"$OUTPUT_DIR/i25.geojson" 		"$OUTPUT_DIR/i45.geojson" 		"$OUTPUT_DIR/i60.geojson" 		"$OUTPUT_DIR/i70.geojson"
fi

if [ "$BUILD_PBF_TILES" = true ]; then
	log "Erzeuge unkomprimierte PBF-Tiles"
	mkdir -p "$PBF_DIR"
	"$TIPPECANOE_BIN" 		-Z8 		-z14 		--force 		--no-tile-size-limit 		--no-tile-compression 		-e "$PBF_DIR" 		"$OUTPUT_DIR/FAHRRADABSTELLANLAGEOGD.json" 		"$OUTPUT_DIR/STRASSENGRAPHOGD.json" 		"$OUTPUT_DIR/k25.geojson" 		"$OUTPUT_DIR/k45.geojson" 		"$OUTPUT_DIR/k60.geojson" 		"$OUTPUT_DIR/k70.geojson" 		"$OUTPUT_DIR/i25.geojson" 		"$OUTPUT_DIR/i45.geojson" 		"$OUTPUT_DIR/i60.geojson" 		"$OUTPUT_DIR/i70.geojson"
fi

log "Radparken-Build fertig"
