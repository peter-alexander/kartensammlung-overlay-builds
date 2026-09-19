#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${GHSL_WORK_DIR:-$SCRIPT_DIR/work}"
OUTPUT_DIR="${GHSL_OUTPUT_DIR:-$SCRIPT_DIR/output}"
TARGET="${1:-all}"

JRC_BASE="https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL"
DEFAULT_SMOD_YEARS="1975 1980 1985 1990 1995 2000 2005 2010 2015 2020 2025 2030"
read -r -a SMOD_YEARS <<< "${GHSL_SMOD_YEARS:-$DEFAULT_SMOD_YEARS}"
AGE_RESOLUTION="${GHSL_AGE_RESOLUTION:-100}"

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

download() {
	local url="$1"
	local output="$2"

	mkdir -p "$(dirname -- "$output")"
	log "Download: $url"
	curl \
		--fail \
		--location \
		--retry 5 \
		--retry-delay 10 \
		--retry-all-errors \
		--connect-timeout 30 \
		--output "$output.part" \
		"$url"
	mv -f "$output.part" "$output"
}

find_archive_entry() {
	local archive="$1"
	local suffix="$2"
	local label="$3"
	local candidates

	candidates="$(
		unzip -Z1 "$archive" \
			| awk -v suffix="$suffix" '
				BEGIN { IGNORECASE=1 }
				{
					name=tolower($0)
					if (length(name) >= length(suffix) && substr(name, length(name) - length(suffix) + 1) == tolower(suffix)) {
						print
					}
				}
			'
	)"

	if [ -z "$candidates" ]; then
		die "$label fehlt im Archiv: $archive"
	fi

	if [ "$(printf '%s\n' "$candidates" | wc -l)" -ne 1 ]; then
		die "Erwartet genau eine $label-Datei im Archiv: $archive"
	fi

	printf '%s' "$candidates"
}

extract_archive_files() {
	local archive="$1"
	local tif_output="$2"
	local clr_output="$3"
	local tif_name
	local clr_name

	tif_name="$(find_archive_entry "$archive" ".tif" "GeoTIFF")"
	clr_name="$(find_archive_entry "$archive" ".clr" "CLR-Farbpalette")"

	log "Extrahiere Raster: $tif_name"
	unzip -p "$archive" "$tif_name" > "$tif_output"

	log "Extrahiere Farbpalette: $clr_name"
	unzip -p "$archive" "$clr_name" > "$clr_output"
}

prepare_smod_palette_raster() {
	local input="$1"
	local palette="$2"
	local output="$3"

	log "Bereite SMOD-Klassenraster als Byte vor"
	gdal_translate \
		-of GTiff \
		-ot Byte \
		-a_nodata 0 \
		-co TILED=YES \
		-co COMPRESS=DEFLATE \
		-co PREDICTOR=1 \
		"$input" \
		"$output"

	python3 "$SCRIPT_DIR/embed_palette.py" "$output" "$palette" 0
}

prepare_age_palette_raster() {
	local input="$1"
	local palette="$2"
	local output="$3"

	log "Bereite AGE-Klassenraster vor"
	gdal_translate \
		-of GTiff \
		-ot Byte \
		-co TILED=YES \
		-co COMPRESS=DEFLATE \
		-co PREDICTOR=1 \
		"$input" \
		"$output"

	python3 "$SCRIPT_DIR/embed_palette.py" "$output" "$palette"
}

make_cog() {
	local input="$1"
	local output="$2"

	mkdir -p "$(dirname -- "$output")"

	log "Erzeuge palettiertes COG: $output"
	gdal_translate \
		-of COG \
		-co COMPRESS=DEFLATE \
		-co LEVEL=9 \
		-co BLOCKSIZE=512 \
		-co BIGTIFF=IF_SAFER \
		-co NUM_THREADS=ALL_CPUS \
		-co RESAMPLING=NEAREST \
		"$input" \
		"$output.part"

	mv -f "$output.part" "$output"
	gdalinfo "$output" >/dev/null
}

validate_palette() {
	local file="$1"
	local expected_codes="$2"

	python3 - "$file" "$expected_codes" <<'PY'
import sys

from osgeo import gdal

path = sys.argv[1]
expected_codes = [int(value) for value in sys.argv[2].split(",") if value]

dataset = gdal.Open(path, gdal.GA_ReadOnly)
if dataset is None:
	raise SystemExit(f"Raster kann nicht geöffnet werden: {path}")

band = dataset.GetRasterBand(1)
table = band.GetRasterColorTable()
if table is None:
	raise SystemExit(f"Farbpalette fehlt: {path}")

entries = {}
for code in expected_codes:
	entry = table.GetColorEntry(code)
	if entry is None:
		raise SystemExit(f"Farbwert für Klasse {code} fehlt: {path}")
	entries[code] = tuple(entry)

print(f"Palette OK: {path} ({len(expected_codes)} geprüfte Klassen)")
print("Palette entries:", entries)
PY
}

validate_smod() {
	local file="$1"
	local json

	json="$(gdalinfo -json "$file")"
	python3 - "$json" <<'PY'
import json
import math
import sys

data = json.loads(sys.argv[1])
bands = data.get("bands") or []
if len(bands) != 1:
	raise SystemExit(f"SMOD: expected one band, got {len(bands)}")

band_type = str(bands[0].get("type") or "").lower()
if band_type not in {"byte", "uint8"}:
	raise SystemExit(f"SMOD: expected UInt8/Byte, got {band_type!r}")

size = data.get("size") or []
if len(size) != 2 or min(size) <= 0:
	raise SystemExit(f"SMOD: invalid raster size {size!r}")

wkt = ((data.get("coordinateSystem") or {}).get("wkt") or "").upper()
if "WGS 84" not in wkt and 'EPSG","4326' not in wkt:
	raise SystemExit("SMOD: expected WGS84 / EPSG:4326")

geo = data.get("geoTransform") or []
if len(geo) != 6:
	raise SystemExit("SMOD: geotransform missing")

pixel_x = abs(float(geo[1]))
pixel_y = abs(float(geo[5]))
expected = 30.0 / 3600.0
if not math.isclose(pixel_x, expected, rel_tol=0, abs_tol=1e-8):
	raise SystemExit(f"SMOD: unexpected x resolution {pixel_x}")
if not math.isclose(pixel_y, expected, rel_tol=0, abs_tol=1e-8):
	raise SystemExit(f"SMOD: unexpected y resolution {pixel_y}")

print("SMOD metadata OK")
PY

	validate_palette "$file" "10,11,12,13,21,22,23,30"
}

validate_age() {
	local file="$1"
	local expected_resolution="$2"
	local json

	json="$(gdalinfo -json "$file")"
	python3 - "$json" "$expected_resolution" <<'PY'
import json
import math
import sys

data = json.loads(sys.argv[1])
expected_resolution = float(sys.argv[2])
bands = data.get("bands") or []
if len(bands) != 1:
	raise SystemExit(f"AGE: expected one band, got {len(bands)}")

band_type = str(bands[0].get("type") or "").lower()
if band_type not in {"byte", "uint8"}:
	raise SystemExit(f"AGE: expected UInt8/Byte, got {band_type!r}")

size = data.get("size") or []
if len(size) != 2 or min(size) <= 0:
	raise SystemExit(f"AGE: invalid raster size {size!r}")

wkt = ((data.get("coordinateSystem") or {}).get("wkt") or "").upper()
if "MOLLWEIDE" not in wkt:
	raise SystemExit("AGE: expected World Mollweide projection")

geo = data.get("geoTransform") or []
if len(geo) != 6:
	raise SystemExit("AGE: geotransform missing")

pixel_x = abs(float(geo[1]))
pixel_y = abs(float(geo[5]))
if not math.isclose(pixel_x, expected_resolution, rel_tol=0, abs_tol=0.01):
	raise SystemExit(f"AGE: unexpected x resolution {pixel_x}")
if not math.isclose(pixel_y, expected_resolution, rel_tol=0, abs_tol=0.01):
	raise SystemExit(f"AGE: unexpected y resolution {pixel_y}")

print("AGE metadata OK")
PY

	validate_palette "$file" "0,1,2,3,4,5,6,7,8,9,10"
}

build_smod_epoch() {
	local year="$1"
	local base="GHS_SMOD_E${year}_GLOBE_R2023A_4326_30ss"
	local archive_name="${base}_V2_0.zip"
	local url="${JRC_BASE}/GHS_SMOD_GLOBE_R2023A/${base}/V2-0/${archive_name}"
	local archive="$WORK_DIR/$archive_name"
	local tif="$WORK_DIR/${base}_V2_0.tif"
	local clr="$WORK_DIR/${base}_V2_0.clr"
	local paletted="$WORK_DIR/${base}_V2_0-paletted.tif"
	local output="$OUTPUT_DIR/smod/ghs-smod-${year}.tif"

	download "$url" "$archive"
	extract_archive_files "$archive" "$tif" "$clr"
	prepare_smod_palette_raster "$tif" "$clr" "$paletted"
	make_cog "$paletted" "$output"
	validate_smod "$output"
	rm -f "$archive" "$tif" "$clr" "$paletted"
}

build_smod() {
	for year in "${SMOD_YEARS[@]}"; do
		if ! [[ "$year" =~ ^(1975|1980|1985|1990|1995|2000|2005|2010|2015|2020|2025|2030)$ ]]; then
			die "Ungültige SMOD-Epoche: $year"
		fi
		build_smod_epoch "$year"
	done
}

build_age() {
	if [ "$AGE_RESOLUTION" != "100" ] && [ "$AGE_RESOLUTION" != "1000" ]; then
		die "GHSL_AGE_RESOLUTION muss 100 oder 1000 sein."
	fi

	local base="GHS_AGE_1975052020_GLOBE_R2025A_54009_${AGE_RESOLUTION}_V1_0"
	local archive_name="${base}.zip"
	local url="${JRC_BASE}/GHS_AGE_GLOBE_R2025A/V1-0/${archive_name}"
	local archive="$WORK_DIR/$archive_name"
	local tif="$WORK_DIR/${base}.tif"
	local clr="$WORK_DIR/${base}.clr"
	local paletted="$WORK_DIR/${base}-paletted.tif"
	local output="$OUTPUT_DIR/age/ghs-age-${AGE_RESOLUTION}m.tif"

	download "$url" "$archive"
	extract_archive_files "$archive" "$tif" "$clr"
	prepare_age_palette_raster "$tif" "$clr" "$paletted"
	make_cog "$paletted" "$output"
	validate_age "$output" "$AGE_RESOLUTION"
	rm -f "$archive" "$tif" "$clr" "$paletted"
}

write_release_manifest() {
	python3 - "$OUTPUT_DIR" <<'PY'
import datetime as dt
import hashlib
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
files = []

for path in sorted(root.rglob("*.tif")):
	h = hashlib.sha256()
	with path.open("rb") as f:
		for chunk in iter(lambda: f.read(1024 * 1024), b""):
			h.update(chunk)
	files.append({
		"path": path.relative_to(root).as_posix(),
		"bytes": path.stat().st_size,
		"sha256": h.hexdigest(),
	})

manifest = {
	"source": "European Commission Joint Research Centre / GHSL",
	"built_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
	"files": files,
}

(root / "release.json").write_text(
	json.dumps(manifest, ensure_ascii=False, indent="\t") + "\n",
	encoding="utf-8",
)
PY
}

main() {
	require_command curl
	require_command unzip
	require_command gdal_translate
	require_command gdalinfo
	require_command python3

	rm -rf "$WORK_DIR"
	mkdir -p "$WORK_DIR" "$OUTPUT_DIR"

	case "$TARGET" in
		smod)
			build_smod
			;;
		age)
			build_age
			;;
		all)
			build_smod
			build_age
			;;
		*)
			die "Unbekanntes Ziel '$TARGET'. Erlaubt: all, smod, age"
			;;
	esac

	write_release_manifest
	log "GHSL-COG-Build fertig: $OUTPUT_DIR"
}

main "$@"
