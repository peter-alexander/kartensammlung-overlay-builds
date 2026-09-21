#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PUBLISH_DIR="$BUILD_DIR/Baumkataster"
WORK_DIR="$BUILD_DIR/tmp"
GEOJSONSEQ_FILE="$WORK_DIR/baumkataster.geojsonseq"
PBF_DIR="$PUBLISH_DIR/tiles"
RELEASE_FILE="$PUBLISH_DIR/release.json"
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

log "Erzeuge ungekomprimierte Z15-PBF-Vektorkacheln"
mkdir -p "$PBF_DIR"
"$TIPPECANOE_BIN" \
	--minimum-zoom=15 \
	--maximum-zoom=15 \
	--layer=baumkataster \
	--force \
	--no-feature-limit \
	--no-tile-size-limit \
	--no-tile-compression \
	--output-to-directory="$PBF_DIR" \
	"$GEOJSONSEQ_FILE"

tile_count="$(find "$PBF_DIR/15" -type f -name '*.pbf' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$tile_count" -lt 50 ]; then
	log "Zu wenige Z15-PBF-Kacheln erzeugt: $tile_count"
	exit 1
fi

log "Baumkataster-Build fertig: $tile_count Z15-Kacheln"
