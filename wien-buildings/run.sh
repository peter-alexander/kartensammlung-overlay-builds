#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PUBLISH_DIR="$BUILD_DIR/WienBuildings"
WORK_DIR="$BUILD_DIR/tmp"
GEOJSONSEQ_FILE="$WORK_DIR/wien-buildings.geojsonseq"
PBF_DIR="$PUBLISH_DIR/tiles"
RELEASE_FILE="$PUBLISH_DIR/release.json"
TILEJSON_FILE="$PUBLISH_DIR/tilejson.json"
TIPPECANOE_BIN="${TIPPECANOE_BIN:-tippecanoe}"
MIN_ZOOM=12
MAX_ZOOM=15
LOW_ZOOM_SIMPLIFICATION=4

log() {
	printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

rm -rf "$BUILD_DIR"
mkdir -p "$PUBLISH_DIR" "$WORK_DIR"

command -v node >/dev/null 2>&1
command -v "$TIPPECANOE_BIN" >/dev/null 2>&1
command -v gzip >/dev/null 2>&1

log "Lade und normalisiere Wiener Baukörpermodell-WFS"
node "$SCRIPT_DIR/build.mjs" \
	--output "$GEOJSONSEQ_FILE" \
	--release "$RELEASE_FILE"

test -s "$GEOJSONSEQ_FILE"
test -s "$RELEASE_FILE"

log "Erzeuge gzip-komprimierte Z${MIN_ZOOM}-Z${MAX_ZOOM}-PBF-Vektorkacheln"
log "Z${MAX_ZOOM} bleibt geometrisch vollständig; Z${MIN_ZOOM}-Z$((MAX_ZOOM - 1)) werden nur geometrisch vereinfacht (Faktor ${LOW_ZOOM_SIMPLIFICATION}), ohne Gebäude wegen Tile-Limits zu verwerfen."
mkdir -p "$PBF_DIR"
"$TIPPECANOE_BIN" \
	--minimum-zoom="$MIN_ZOOM" \
	--maximum-zoom="$MAX_ZOOM" \
	--layer=wien_buildings \
	--force \
	--no-feature-limit \
	--no-tile-size-limit \
	--no-tiny-polygon-reduction \
	--simplification="$LOW_ZOOM_SIMPLIFICATION" \
	--simplify-only-low-zooms \
	--include=render_height \
	--include=render_min_height \
	--include=KS_ID \
	--include=BW_GEB_ID \
	--include=FMZK_ID \
	--include=BEZUG \
	--include=F_KLASSE \
	--output-to-directory="$PBF_DIR" \
	"$GEOJSONSEQ_FILE"

log "Finalisiere TileJSON und Z${MAX_ZOOM}-Kachelindex"
node "$SCRIPT_DIR/finalize.mjs" --publish-dir "$PUBLISH_DIR"

test -s "$TILEJSON_FILE"

z15_tile_count="$(find "$PBF_DIR/$MAX_ZOOM" -type f -name '*.pbf' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$z15_tile_count" -lt 200 ]; then
	log "Zu wenige Z${MAX_ZOOM}-PBF-Kacheln erzeugt: $z15_tile_count"
	exit 1
fi

expected_z15_tile_count="$(node -e '
	const release = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
	process.stdout.write(String(release.vectorTiles.presentTilesZ15.length));
' "$RELEASE_FILE")"
if [ "$z15_tile_count" -ne "$expected_z15_tile_count" ]; then
	log "Z${MAX_ZOOM}-Kachelindex stimmt nicht: Dateien=$z15_tile_count, Index=$expected_z15_tile_count"
	exit 1
fi

for zoom in $(seq "$MIN_ZOOM" "$MAX_ZOOM"); do
	tile_count="$(find "$PBF_DIR/$zoom" -type f -name '*.pbf' 2>/dev/null | wc -l | tr -d ' ')"
	if [ "$tile_count" -lt 1 ]; then
		log "Keine PBF-Kacheln für Z$zoom erzeugt"
		exit 1
	fi

	sample_tile="$(find "$PBF_DIR/$zoom" -type f -name '*.pbf' | head -n 1)"
	gzip -t "$sample_tile"

	largest_tile="$(find "$PBF_DIR/$zoom" -type f -name '*.pbf' -printf '%s %p\n' | sort -nr | head -n 1 || true)"
	log "Z$zoom: $tile_count PBF-Kacheln; größte komprimierte Kachel: ${largest_tile:-unbekannt}"
done

known_z13_tile="$PBF_DIR/13/4469/2838.pbf"
if [ -f "$known_z13_tile" ]; then
	known_z13_bytes="$(wc -c < "$known_z13_tile" | tr -d ' ')"
	log "Referenzkachel Z13/4469/2838: ${known_z13_bytes} Byte komprimiert"
fi

log "Wiener Gebäudedatensatz-Build fertig: $z15_tile_count vollständige Z${MAX_ZOOM}-Kacheln plus im Feature-Bestand vollständige, geometrisch vereinfachte Z${MIN_ZOOM}-Z$((MAX_ZOOM - 1))"
