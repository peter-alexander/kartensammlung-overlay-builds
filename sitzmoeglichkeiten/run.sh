#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/out"
TIPPECANOE_BIN="${TIPPECANOE_BIN:-tippecanoe}"
BUILD_PMTILES="${BUILD_PMTILES:-true}"
BUILD_PBF_TILES="${BUILD_PBF_TILES:-true}"

rm -rf "$OUTPUT_DIR"/*
mkdir -p "$OUTPUT_DIR"

export TIPPECANOE_BIN
export KS_OUTPUT_DIR="$OUTPUT_DIR"
export KS_BASENAME="wien-sitzdistanz"
export KS_WRITE_GEOJSON="0"
export KS_KEEP_GEOJSON_AFTER_TIPPECANOE="0"
export KS_WRITE_MANIFEST="1"

if [ "$BUILD_PMTILES" = true ]; then
	export KS_ENABLE_TIPPECANOE="1"
	export KS_EXPORT_PMTILES="1"
else
	export KS_ENABLE_TIPPECANOE="${KS_ENABLE_TIPPECANOE:-0}"
	export KS_EXPORT_PMTILES="0"
fi

if [ "$BUILD_PBF_TILES" = true ]; then
	export KS_EXPORT_TILE_DIR="1"
else
	export KS_EXPORT_TILE_DIR="0"
fi

cd "$SCRIPT_DIR"
node --max-old-space-size=8192 src/nightly/runSingleExtent.mjs
