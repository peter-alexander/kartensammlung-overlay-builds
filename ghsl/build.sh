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
HEIGHT_RESOLUTION="${GHSL_HEIGHT_RESOLUTION:-100}"

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

extract_archive_raster() {
	local archive="$1"
	local tif_output="$2"
	local tif_name

	tif_name="$(find_archive_entry "$archive" ".tif" "GeoTIFF")"
	log "Extrahiere Raster: $tif_name"
	unzip -p "$archive" "$tif_name" > "$tif_output"
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

make_height_cog() {
	local input="$1"
	local output="$2"

	mkdir -p "$(dirname -- "$output")"

	log "Erzeuge verlustfreies ANBH-COG ohne Reprojektion: $output"
	gdal_translate \
		-of COG \
		-co COMPRESS=DEFLATE \
		-co LEVEL=9 \
		-co PREDICTOR=FLOATING_POINT \
		-co BLOCKSIZE=512 \
		-co BIGTIFF=IF_SAFER \
		-co NUM_THREADS=ALL_CPUS \
		-co OVERVIEWS=AUTO \
		-co RESAMPLING=AVERAGE \
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

validate_height() {
	local source="$1"
	local cog="$2"
	local archive="$3"
	local source_url="$4"
	local report="$5"

	mkdir -p "$(dirname -- "$report")"
	python3 - "$source" "$cog" "$archive" "$source_url" "$report" <<'PY'
import hashlib
import json
import math
import pathlib
import sys

import numpy as np
from osgeo import gdal, osr

gdal.UseExceptions()

source_path = pathlib.Path(sys.argv[1])
cog_path = pathlib.Path(sys.argv[2])
archive_path = pathlib.Path(sys.argv[3])
source_url = sys.argv[4]
report_path = pathlib.Path(sys.argv[5])

source = gdal.Open(str(source_path), gdal.GA_ReadOnly)
cog = gdal.Open(str(cog_path), gdal.GA_ReadOnly)
if source is None or cog is None:
	raise SystemExit("HEIGHT: source or COG cannot be opened")

if source.RasterCount != 1 or cog.RasterCount != 1:
	raise SystemExit("HEIGHT: expected exactly one raster band")
if (source.RasterXSize, source.RasterYSize) != (cog.RasterXSize, cog.RasterYSize):
	raise SystemExit("HEIGHT: raster dimensions changed")

source_band = source.GetRasterBand(1)
cog_band = cog.GetRasterBand(1)
source_type = gdal.GetDataTypeName(source_band.DataType)
cog_type = gdal.GetDataTypeName(cog_band.DataType)
if source_type != cog_type:
	raise SystemExit(f"HEIGHT: data type changed from {source_type} to {cog_type}")

source_nodata = source_band.GetNoDataValue()
cog_nodata = cog_band.GetNoDataValue()
if source_nodata is None or cog_nodata is None:
	if source_nodata is not cog_nodata:
		raise SystemExit(f"HEIGHT: NoData changed from {source_nodata} to {cog_nodata}")
elif not math.isclose(float(source_nodata), float(cog_nodata), rel_tol=0, abs_tol=0):
	raise SystemExit(f"HEIGHT: NoData changed from {source_nodata} to {cog_nodata}")

source_transform = source.GetGeoTransform()
cog_transform = cog.GetGeoTransform()
if source_transform != cog_transform:
	raise SystemExit("HEIGHT: geotransform changed")
if not math.isclose(abs(source_transform[1]), 100.0, rel_tol=0, abs_tol=0.01):
	raise SystemExit(f"HEIGHT: unexpected x resolution {source_transform[1]}")
if not math.isclose(abs(source_transform[5]), 100.0, rel_tol=0, abs_tol=0.01):
	raise SystemExit(f"HEIGHT: unexpected y resolution {source_transform[5]}")

source_srs = osr.SpatialReference(wkt=source.GetProjectionRef())
cog_srs = osr.SpatialReference(wkt=cog.GetProjectionRef())
if not source_srs.IsSame(cog_srs):
	raise SystemExit("HEIGHT: projection changed")
if "MOLLWEIDE" not in source_srs.ExportToWkt().upper():
	raise SystemExit("HEIGHT: expected World Mollweide source projection")

image_structure = cog.GetMetadata("IMAGE_STRUCTURE")
if image_structure.get("LAYOUT") != "COG":
	raise SystemExit(f"HEIGHT: COG layout marker missing: {image_structure}")
if image_structure.get("COMPRESSION") != "DEFLATE":
	raise SystemExit(f"HEIGHT: expected DEFLATE compression: {image_structure}")

overview_sizes = [
	[cog_band.GetOverview(index).XSize, cog_band.GetOverview(index).YSize]
	for index in range(cog_band.GetOverviewCount())
]
if len(overview_sizes) < 4:
	raise SystemExit(f"HEIGHT: too few internal overviews: {overview_sizes}")

wgs84 = osr.SpatialReference()
wgs84.ImportFromEPSG(4326)
wgs84.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
source_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
to_source = osr.CoordinateTransformation(wgs84, source_srs)
inverse = gdal.InvGeoTransform(source_transform)
if isinstance(inverse, tuple) and len(inverse) == 2 and isinstance(inverse[0], (bool, int)):
	inverse = inverse[1]

locations = [
	("Wien", "Europa", 16.3738, 48.2082),
	("New York", "Nordamerika", -74.0060, 40.7128),
	("São Paulo", "Südamerika", -46.6333, -23.5505),
	("Lagos", "Afrika", 3.3792, 6.5244),
	("Delhi", "Asien", 77.1025, 28.7041),
	("Sydney", "Australien/Ozeanien", 151.2093, -33.8688),
]

samples = []
for name, continent, lon, lat in locations:
	x, y, _ = to_source.TransformPoint(lon, lat)
	pixel_x, pixel_y = gdal.ApplyGeoTransform(inverse, x, y)
	center_x = int(math.floor(pixel_x))
	center_y = int(math.floor(pixel_y))
	radius = 8
	xoff = max(0, min(source.RasterXSize - (radius * 2 + 1), center_x - radius))
	yoff = max(0, min(source.RasterYSize - (radius * 2 + 1), center_y - radius))
	width = min(radius * 2 + 1, source.RasterXSize - xoff)
	height = min(radius * 2 + 1, source.RasterYSize - yoff)

	source_values = source_band.ReadAsArray(xoff, yoff, width, height)
	cog_values = cog_band.ReadAsArray(xoff, yoff, width, height)
	if source_values is None or cog_values is None:
		raise SystemExit(f"HEIGHT: sample could not be read for {name}")
	if not np.array_equal(source_values, cog_values, equal_nan=True):
		raise SystemExit(f"HEIGHT: numeric values changed around {name}")

	valid = np.isfinite(source_values)
	if source_nodata is not None:
		valid &= source_values != source_nodata
	valid &= source_values > 0
	positive = source_values[valid]
	if positive.size == 0:
		raise SystemExit(f"HEIGHT: no positive ANBH sample near {name}")

	samples.append({
		"name": name,
		"continent": continent,
		"lon": lon,
		"lat": lat,
		"pixel": [center_x, center_y],
		"window": [xoff, yoff, width, height],
		"positive_pixels": int(positive.size),
		"min_m": float(positive.min()),
		"max_m": float(positive.max()),
		"mean_m": float(positive.mean()),
		"source_equals_cog": True,
	})

archive_hash = hashlib.sha256()
with archive_path.open("rb") as stream:
	for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
		archive_hash.update(chunk)

projection_wkt = source_srs.ExportToWkt()
report = {
	"product": "GHS-BUILT-H R2023A / ANBH 2018",
	"source": {
		"url": source_url,
		"archive_bytes": archive_path.stat().st_size,
		"archive_sha256": archive_hash.hexdigest(),
		"raster_bytes": source_path.stat().st_size,
	},
	"cog": {
		"path": cog_path.name,
		"bytes": cog_path.stat().st_size,
		"driver": cog.GetDriver().ShortName,
		"size": [cog.RasterXSize, cog.RasterYSize],
		"band_type": cog_type,
		"nodata": cog_nodata,
		"geotransform": list(cog_transform),
		"projection_name": cog_srs.GetAttrValue("PROJCS"),
		"projection_wkt_sha256": hashlib.sha256(projection_wkt.encode("utf-8")).hexdigest(),
		"image_structure": image_structure,
		"block_size": list(cog_band.GetBlockSize()),
		"overviews": overview_sizes,
	},
	"checks": {
		"original_resolution_preserved": True,
		"original_projection_preserved": True,
		"original_nodata_preserved": True,
		"original_data_type_preserved": True,
		"lossless_sample_values": True,
		"layout_is_cog": True,
	},
	"samples": samples,
}

report_path.write_text(json.dumps(report, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
PY
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

build_height() {
	if [ "$HEIGHT_RESOLUTION" != "100" ]; then
		die "GHSL_HEIGHT_RESOLUTION muss 100 sein."
	fi

	local base="GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_${HEIGHT_RESOLUTION}"
	local archive_name="${base}_V1_0.zip"
	local url="${JRC_BASE}/GHS_BUILT_H_GLOBE_R2023A/${base}/V1-0/${archive_name}"
	local archive="$WORK_DIR/$archive_name"
	local tif="$WORK_DIR/${base}_V1_0.tif"
	local output="$OUTPUT_DIR/height/ghs-built-h-anbh-2018-${HEIGHT_RESOLUTION}m.tif"
	local report="$OUTPUT_DIR/validation/ghs-built-h-anbh-2018-${HEIGHT_RESOLUTION}m.json"

	download "$url" "$archive"
	extract_archive_raster "$archive" "$tif"
	make_height_cog "$tif" "$output"
	validate_height "$tif" "$output" "$archive" "$url" "$report"
	rm -f "$archive" "$tif"
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
		height)
			build_height
			;;
		all)
			build_smod
			build_age
			build_height
			;;
		*)
			die "Unbekanntes Ziel '$TARGET'. Erlaubt: all, smod, age, height"
			;;
	esac

	write_release_manifest
	log "GHSL-COG-Build fertig: $OUTPUT_DIR"
}

main "$@"
