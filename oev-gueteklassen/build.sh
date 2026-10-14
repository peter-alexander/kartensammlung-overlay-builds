#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${1:-/tmp/noe-oev-build}"
mkdir -p "$WORK"/{wt,wk,output}
ZIP="$WORK/oev.zip"
AT_ZIP='https://files.austriatech.at/d/33971b2d51a348a5958d/files/?dl=1&p=%2FOeV_Gueteklassen_2025_nap_revised.zip'
BOUNDARY='https://sdi.noe.gv.at/at.gv.noe.geoserver/OGD/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=OGD:LAND&srsName=EPSG:4326&outputFormat=application/json&maxFeatures=10'

if [[ ! -s "$ZIP" ]]; then
	curl --fail --location --retry 2 --max-time 240 "$AT_ZIP" -o "$ZIP"
fi
unzip -tq "$ZIP" >/dev/null
for entry in '20251022' '20251029'; do
	if [[ "$entry" == '20251022' ]]; then day="wt"; else day="wk"; fi
	unzip -qo -j "$ZIP" "*Haltestellenkategorien_${entry}_revised.*" -d "$WORK/$day"
	unzip -qo -j "$ZIP" "*OeV_Gueteklassen_Polygone_${entry}_revised.*" -d "$WORK/$day"
done

curl --fail --location --retry 2 --max-time 40 "$BOUNDARY" -o "$WORK/noe-boundary.geojson"
python3 - "$WORK/noe-boundary.geojson" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
assert data.get('type') == 'FeatureCollection'
assert data.get('features'), 'NÖ Landesgrenze is empty'
assert all(f.get('geometry',{}).get('type') in ('Polygon','MultiPolygon') for f in data['features']), 'NÖ Landesgrenze must be a polygon'
print('NOE_BOUNDARY',len(data['features']), 'features')
PY

ogr2ogr -f GPKG "$WORK/border.gpkg" "$WORK/noe-boundary.geojson" -t_srs EPSG:3035 -nln border

for day in wt wk; do
	case "$day" in
		wt) stamp='20251022';;
		wk) stamp='20251029';;
	esac
	POLY="$WORK/$day/OeV_Gueteklassen_Polygone_${stamp}_revised.shp"
	STOP="$WORK/$day/Haltestellenkategorien_${stamp}_revised.shp"
	ogrinfo -ro -so -al "$POLY" | head -28
	ogrinfo -ro -so -al "$STOP" | head -28
	ogr2ogr -f GeoJSONSeq "$WORK/output/$day-polygons.geojsonl" "$POLY" \
		-clipsrc "$WORK/border.gpkg" -clipsrclayer border \
		-t_srs EPSG:4326 -select gueteklass -lco RS=NO -dim XY
	ogr2ogr -f GeoJSONSeq "$WORK/output/$day-stops.geojsonl" "$STOP" \
		-clipsrc "$WORK/border.gpkg" -clipsrclayer border \
		-t_srs EPSG:4326 \
		-select 'St_Nummer,St_Name,VKAT_Hst,Anz_Abf,Abf_p_Ri,Intervall,IntKlasse,HstKat,Linien' \
		-lco RS=NO -dim XY
done
for item in "$WORK"/output/*.geojsonl; do
	printf 'NOE_OEV_GEOJSON %s ' "$(basename "$item")"
	du -h "$item"
	head -c 260 "$item" || true
	echo
done

if ! command -v tippecanoe >/dev/null; then
	echo 'tippecanoe required to make PMTiles' >&2
	exit 2
fi
tippecanoe -o "$WORK/output/noe-oev-gueteklassen.mbtiles" -Z5 -z14 --force \
	--no-feature-limit --no-tile-size-limit \
	-L "oev_wt_flaechen:$WORK/output/wt-polygons.geojsonl" \
	-L "oev_wk_flaechen:$WORK/output/wk-polygons.geojsonl" \
	-L "oev_wt_haltestellen:$WORK/output/wt-stops.geojsonl" \
	-L "oev_wk_haltestellen:$WORK/output/wk-stops.geojsonl"

pmtiles convert "$WORK/output/noe-oev-gueteklassen.mbtiles" \
	"$WORK/output/noe-oev-gueteklassen.pmtiles"
pmtiles show "$WORK/output/noe-oev-gueteklassen.pmtiles"
du -h "$WORK/output/noe-oev-gueteklassen.pmtiles"
