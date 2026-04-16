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
	printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_file() {
	local file="$1"

	if [ ! -f "$file" ]; then
		log "Datei fehlt: $file"
		exit 1
	fi
}

require_nonempty_file() {
	local file="$1"

	require_file "$file"

	if [ ! -s "$file" ]; then
		log "Datei ist leer: $file"
		exit 1
	fi
}

validate_json_file() {
	local file="$1"

	node -e '
		const fs = require("fs");
		const path = process.argv[1];
		JSON.parse(fs.readFileSync(path, "utf8"));
	' "$file" >/dev/null 2>&1
}

require_valid_json_file() {
	local file="$1"

	require_nonempty_file "$file"

	if ! validate_json_file "$file"; then
		log "Ungültiges JSON: $file"
		exit 1
	fi
}

download_json_with_retry() {
	local url="$1"
	local outfile="$2"
	local tmpfile
	local attempt
	local max_attempts=3
	local sleep_seconds=120

	rm -f "$outfile"

	for (( attempt=1; attempt<=max_attempts; attempt++ )); do
		tmpfile="$(mktemp "${outfile}.tmp.XXXXXX")"

		if curl \
			--fail \
			--silent \
			--show-error \
			--location \
			"$url" \
			-o "$tmpfile"
		then
			if [ -s "$tmpfile" ] && validate_json_file "$tmpfile"; then
				mv -f "$tmpfile" "$outfile"
				log "Download erfolgreich und JSON valide: $outfile"
				return 0
			fi

			log "Download lieferte kein gültiges JSON: $url (Versuch $attempt von $max_attempts)"
		else
			log "Download fehlgeschlagen: $url (Versuch $attempt von $max_attempts)"
		fi

		rm -f "$tmpfile"

		if [ "$attempt" -lt "$max_attempts" ]; then
			sleep "$sleep_seconds"
		fi
	done

	log "Download endgültig fehlgeschlagen oder nie valides JSON erhalten: $url"
	return 1
}

mkdir -p "$INPUT_DIR" "$OUTPUT_DIR" "$BUILD_DIR"
rm -rf "$INPUT_DIR"/* "$OUTPUT_DIR"/* "$BUILD_DIR"/*

require_file "$NODE_SCRIPT"
command -v node >/dev/null 2>&1
command -v "$TIPPECANOE_BIN" >/dev/null 2>&1

log "Lade WFS-Daten"
download_json_with_retry "$STRASSENGRAPH_URL" "$INPUT_DIR/STRASSENGRAPHOGD.json"
download_json_with_retry "$FAHRRADABSTELLANLAGE_URL" "$INPUT_DIR/FAHRRADABSTELLANLAGEOGD.json"

log "Prüfe Input-Dateien"
require_valid_json_file "$INPUT_DIR/STRASSENGRAPHOGD.json"
require_valid_json_file "$INPUT_DIR/FAHRRADABSTELLANLAGEOGD.json"

log "Starte Node-Build"
node "$NODE_SCRIPT" "$INPUT_DIR" "$OUTPUT_DIR"

log "Prüfe Build-Ergebnisse"
require_valid_json_file "$OUTPUT_DIR/STRASSENGRAPHOGD.json"
require_valid_json_file "$OUTPUT_DIR/FAHRRADABSTELLANLAGEOGD.json"
require_valid_json_file "$OUTPUT_DIR/k25.geojson"
require_valid_json_file "$OUTPUT_DIR/k45.geojson"
require_valid_json_file "$OUTPUT_DIR/k60.geojson"
require_valid_json_file "$OUTPUT_DIR/k70.geojson"
require_valid_json_file "$OUTPUT_DIR/i25.geojson"
require_valid_json_file "$OUTPUT_DIR/i45.geojson"
require_valid_json_file "$OUTPUT_DIR/i60.geojson"
require_valid_json_file "$OUTPUT_DIR/i70.geojson"

if [ "$BUILD_PMTILES" = true ]; then
	log "Erzeuge PMTiles"
	"$TIPPECANOE_BIN" \
		-Z8 \
		-z14 \
		--force \
		--no-tile-size-limit \
		--no-feature-limit \
		-o "$PMTILES_FILE" \
		"$OUTPUT_DIR/FAHRRADABSTELLANLAGEOGD.json" \
		"$OUTPUT_DIR/STRASSENGRAPHOGD.json" \
		"$OUTPUT_DIR/k25.geojson" \
		"$OUTPUT_DIR/k45.geojson" \
		"$OUTPUT_DIR/k60.geojson" \
		"$OUTPUT_DIR/k70.geojson" \
		"$OUTPUT_DIR/i25.geojson" \
		"$OUTPUT_DIR/i45.geojson" \
		"$OUTPUT_DIR/i60.geojson" \
		"$OUTPUT_DIR/i70.geojson"
fi

if [ "$BUILD_PBF_TILES" = true ]; then
	log "Erzeuge unkomprimierte PBF-Tiles"
	mkdir -p "$PBF_DIR"
	"$TIPPECANOE_BIN" \
		-Z8 \
		-z14 \
		--force \
		--no-tile-size-limit \
		--no-tile-compression \
		-e "$PBF_DIR" \
		"$OUTPUT_DIR/FAHRRADABSTELLANLAGEOGD.json" \
		"$OUTPUT_DIR/STRASSENGRAPHOGD.json" \
		"$OUTPUT_DIR/k25.geojson" \
		"$OUTPUT_DIR/k45.geojson" \
		"$OUTPUT_DIR/k60.geojson" \
		"$OUTPUT_DIR/k70.geojson" \
		"$OUTPUT_DIR/i25.geojson" \
		"$OUTPUT_DIR/i45.geojson" \
		"$OUTPUT_DIR/i60.geojson" \
		"$OUTPUT_DIR/i70.geojson"
fi

log "Radparken-Build fertig"
