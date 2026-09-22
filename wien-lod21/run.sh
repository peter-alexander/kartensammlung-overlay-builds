#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
SOURCE_DIR="$BUILD_DIR/source"
OUTPUT_DIR="$BUILD_DIR/WienBuildingsLOD21"
TARGETS_FILE="$SCRIPT_DIR/targets.pilot.json"
DOWNLOAD_BASE="https://www.wien.gv.at/MA41datenviewer/downloads/geodaten/lod2_gml"

rm -rf "$BUILD_DIR"
mkdir -p "$SOURCE_DIR" "$OUTPUT_DIR"

mapfile -t SHEETS < <(
	node --input-type=module - "$TARGETS_FILE" <<'NODE'
import fs from "node:fs";
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const sheet of [...new Set((input.buildings || []).map((item) => String(item.sheet)))].sort()) {
	console.log(sheet);
}
NODE
)

if [ "${#SHEETS[@]}" -eq 0 ]; then
	echo "No Vienna LOD2.1 source sheets configured." >&2
	exit 1
fi

for sheet in "${SHEETS[@]}"; do
	zip_path="$BUILD_DIR/${sheet}_lod2_gml.zip"
	url="$DOWNLOAD_BASE/${sheet}_lod2_gml.zip"
	echo "Download LOD2.1 sheet $sheet"
	curl 		--fail 		--location 		--retry 4 		--retry-all-errors 		--connect-timeout 30 		--max-time 300 		--user-agent "kartensammlung-overlay-builds/wien-lod21" 		"$url" 		-o "$zip_path"
	unzip -q "$zip_path" -d "$SOURCE_DIR"
done

node "$SCRIPT_DIR/build.mjs" 	--input "$SOURCE_DIR" 	--output "$OUTPUT_DIR" 	--targets "$TARGETS_FILE"

echo "Vienna LOD2.1 pilot build complete:"
find "$OUTPUT_DIR" -type f -printf '%P %s bytes\n' | sort
