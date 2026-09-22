#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PUBLISH_DIR="$BUILD_DIR/Baumkataster"
WORK_DIR="$BUILD_DIR/tmp"
GEOJSONSEQ_FILE="$WORK_DIR/baumkataster.geojsonseq"
PBF_DIR="$PUBLISH_DIR/tiles"
RELEASE_FILE="$PUBLISH_DIR/release.json"
TILEJSON_FILE="$PUBLISH_DIR/tilejson.json"
TIPPECANOE_BIN="${TIPPECANOE_BIN:-tippecanoe}"

log() {
	printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

rm -rf "$BUILD_DIR"
mkdir -p "$PUBLISH_DIR" "$WORK_DIR"

command -v node >/dev/null 2>&1
command -v "$TIPPECANOE_BIN" >/dev/null 2>&1

log "Lade und normalisiere Wiener Baumkataster-WFS"
node "$SCRIPT_DIR/build.mjs" \
	--output "$GEOJSONSEQ_FILE" \
	--release "$RELEASE_FILE"

test -s "$GEOJSONSEQ_FILE"
test -s "$RELEASE_FILE"

log "Erzeuge ungekomprimierte Z12-Z15-PBF-Vektorkacheln"
mkdir -p "$PBF_DIR"
"$TIPPECANOE_BIN" \
	--minimum-zoom=12 \
	--maximum-zoom=15 \
	--layer=baumkataster \
	--force \
	--no-feature-limit \
	--no-tile-size-limit \
	--no-tile-compression \
	--output-to-directory="$PBF_DIR" \
	"$GEOJSONSEQ_FILE"

log "Finalisiere TileJSON und Z15-Kachelindex aus den erzeugten PBF-Dateien"
node "$SCRIPT_DIR/finalize.mjs" --publish-dir "$PUBLISH_DIR"

test -s "$TILEJSON_FILE"

z15_tile_count="$(find "$PBF_DIR/15" -type f -name '*.pbf' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$z15_tile_count" -lt 50 ]; then
	log "Zu wenige Z15-PBF-Kacheln erzeugt: $z15_tile_count"
	exit 1
fi

expected_z15_tile_count="$(node -e '
	const release = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
	process.stdout.write(String(release.vectorTiles.presentTilesZ15.length));
' "$RELEASE_FILE")"
if [ "$z15_tile_count" -ne "$expected_z15_tile_count" ]; then
	log "Z15-Kachelindex stimmt nicht: Dateien=$z15_tile_count, Index=$expected_z15_tile_count"
	exit 1
fi

for zoom in 12 13 14 15; do
	tile_count="$(find "$PBF_DIR/$zoom" -type f -name '*.pbf' 2>/dev/null | wc -l | tr -d ' ')"
	if [ "$tile_count" -lt 1 ]; then
		log "Keine PBF-Kacheln für Z$zoom erzeugt"
		exit 1
	fi
	log "Z$zoom: $tile_count PBF-Kacheln"
done

log "Baumdatensatz-Build fertig: $z15_tile_count vollständige Z15-Kacheln plus Z12-Z14"
