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

if command -v pmtiles >/dev/null 2>&1; then
	PMTILES=pmtiles
elif command -v go-pmtiles >/dev/null 2>&1; then
	PMTILES=go-pmtiles
else
	echo 'PMTiles CLI executable not found' >&2
	exit 2
fi
"$PMTILES" convert "$WORK/output/noe-oev-gueteklassen.mbtiles" \
	"$WORK/output/noe-oev-gueteklassen.pmtiles"
"$PMTILES" show "$WORK/output/noe-oev-gueteklassen.pmtiles"
du -h "$WORK/output/noe-oev-gueteklassen.pmtiles"

python3 - "$WORK/output/noe-oev-gueteklassen.pmtiles" "$WORK/output/catalog.json" <<'PY'
import datetime, hashlib, json, os, sys
archive, destination = sys.argv[1:]
size = os.path.getsize(archive)
assert 1000 < size < 250000000, f'Unexpected PMTiles size: {size}'
with open(archive, 'rb') as source:
	assert source.read(7) == b'PMTiles', 'PMTiles header missing'
catalog = {
	'version': 1,
	'year': 2025,
	'ready': True,
	'dataset': 'OeVGueteklassen/noe-oev-gueteklassen.pmtiles',
	'source': 'https://www.mobilitydata.gv.at/daten/%C3%B6v-g%C3%BCteklassen',
	'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
	'sizeBytes': size,
	'stichtage': {'werktag': '2025-10-22', 'ohneSchultag': '2025-10-29'},
	'vectorLayers': ['oev_wt_flaechen', 'oev_wk_flaechen', 'oev_wt_haltestellen', 'oev_wk_haltestellen']
}
with open(destination, 'w', encoding='utf-8') as stream:
	json.dump(catalog,stream,ensure_ascii=False)
	stream.write('\\n')
print('NOE_OEV_CATALOG',json.dumps(catalog,ensure_ascii=False))
PY
