import assert from "node:assert/strict";
import {
	isAllowedMtkUrl,
	resolveUrl,
	isValidStyleJson,
	isValidTileJson,
	normalizeTileJsonUrls,
	isValidSpriteJson,
	isValidPng,
	safeFileName,
	makeReleaseId
} from "./lib.mjs";

assert.equal(isAllowedMtkUrl("https://mtk.wien.gv.at/a.json"), true);
assert.equal(isAllowedMtkUrl("http://mtk.wien.gv.at/a.json"), false);
assert.equal(isAllowedMtkUrl("https://evil.example/a.json"), false);

assert.equal(
	resolveUrl("https://mtk.wien.gv.at/styles/wien/stadtplan.json", "../../tiles/root.json"),
	"https://mtk.wien.gv.at/tiles/root.json"
);

const style = {
	version: 8,
	sources: {
		wien: {
			type: "vector",
			url: "../../sources/wien.json"
		}
	},
	layers: [
		{
			id: "water",
			type: "fill",
			source: "wien",
			paint: {}
		}
	]
};

assert.equal(isValidStyleJson(style), true);
assert.equal(
	isValidStyleJson({
		...style,
		layers: [
			{
				id: "broken",
				type: "fill",
				paint: []
			}
		]
	}),
	false
);

const tileJson = {
	tiles: ["../tiles/{z}/{x}/{y}.pbf"],
	grids: ["../grids/{z}/{x}/{y}.grid.json"]
};

assert.equal(isValidTileJson(tileJson), true);
assert.deepEqual(
	normalizeTileJsonUrls(tileJson, "https://mtk.wien.gv.at/data/source.json"),
	{
		tiles: ["https://mtk.wien.gv.at/tiles/{z}/{x}/{y}.pbf"],
		grids: ["https://mtk.wien.gv.at/grids/{z}/{x}/{y}.grid.json"]
	}
);

assert.equal(isValidSpriteJson({ icon: {} }), true);
assert.equal(isValidSpriteJson([]), false);

const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	Buffer.alloc(24)
]);

assert.equal(isValidPng(png), true);
assert.equal(isValidPng(Buffer.from("not png")), false);

assert.equal(safeFileName("Wien Haupt-Source"), "wien-haupt-source");

const releaseA = makeReleaseId([
	["a", Buffer.from("1")],
	["b", Buffer.from("2")]
]);
const releaseB = makeReleaseId([
	["a", Buffer.from("1")],
	["b", Buffer.from("2")]
]);

assert.equal(releaseA, releaseB);

console.log("Stadtplan-Wien snapshot tests: OK");
