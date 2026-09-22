#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
INPUT_DIR="$SCRIPT_DIR/input"
OUTPUT_DIR="$SCRIPT_DIR/build/WienLOD21"
DOWNLOAD_BASE="https://www.wien.gv.at/ma41datenviewer/downloads/geodaten/lod2_gml"

rm -rf "$INPUT_DIR" "$SCRIPT_DIR/build"
mkdir -p "$INPUT_DIR" "$OUTPUT_DIR"

for sheet in 104078 105080; do
	zip="$INPUT_DIR/$sheet_lod2_gml.zip"
	echo "Download LOD2.1 sheet $sheet"
	curl -fsSL --retry 4 --retry-delay 3 \
		-A "kartensammlung-overlay-builds/wien-lod21" \
		"$DOWNLOAD_BASE/$sheet_lod2_gml.zip" \
		-o "$zip"
	unzip -q "$zip" -d "$INPUT_DIR"
done

node "$SCRIPT_DIR/build.mjs" "$INPUT_DIR" "$OUTPUT_DIR"

test -s "$OUTPUT_DIR/release.json"
tile_count="$(find "$OUTPUT_DIR/tiles/15" -type f -name '*.bin' | wc -l | tr -d ' ')"
if [ "$tile_count" -lt 2 ]; then
	echo "Unexpectedly few LOD2.1 pilot tiles: $tile_count" >&2
	exit 1
fi

node - "$OUTPUT_DIR/release.json" <<'NODE'
const fs = require("fs");
const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const codes = new Set(release.buildings.map((building) => building.code));
for (const code of ["212535", "009238", "113842", "006973"]) {
	if (!codes.has(code)) throw new Error("Missing pilot building " + code);
}
if (release.tiles.present.length < 2) throw new Error("Pilot must span at least two Z15 tiles.");
console.log(JSON.stringify({
	buildings: release.buildings.length,
	tiles: release.tiles.present.length,
	triangles: release.tileMetadata.reduce((sum, tile) => sum + tile.triangleCount, 0),
	bytes: release.tileMetadata.reduce((sum, tile) => sum + tile.bytes, 0)
}, null, 2));
NODE
