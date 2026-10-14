import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildTirisImageryCatalog, classifyTirisImageryLayer
} from "./imagery-catalog.mjs";

test("tiris imagery catalog finds current RGB, historical RGB and terrain hillshades", () => {
	const orthofoto = {
		layers: [
			{ id: 0, name: "Aktuell_RGB", parentLayerId: -1 },
			{ id: 4, name: "Historisch 1970", parentLayerId: -1 },
			{ id: 5, name: "Befliegungszeitpunkt", parentLayerId: -1 }
		]
	};
	const terrain = {
		layers: [
			{ id: 1, name: "Schummerung Gelaendemodell", parentLayerId: -1 },
			{ id: 2, name: "Hangneigung", parentLayerId: -1 }
		]
	};
	const cat = buildTirisImageryCatalog([orthofoto, terrain]);
	assert.deepEqual(cat.services.orthofoto.layers.map(x => x.id), [0, 4]);
	assert.equal(cat.services.orthofoto.layers[0].category, "Luft- & Satellitenbilder");
	assert.equal(cat.services.orthofoto.layers[1].category, "Historisch");
	assert.equal(cat.services.terrain.layers[0].hillshade, true);
	assert.equal(cat.services.terrain.layers[1].category, "Österreich");
});

test("tiris refuses partial or unsupported service metadata", () => {
	assert.throws(() => buildTirisImageryCatalog([]), /unvollständig/);
	assert.throws(() => buildTirisImageryCatalog([{layers:[]}, {layers:[]}]), /kein darstellbarer Layer/);
});

test("tiris classification distinguishes historical layer names", () => {
	const result = classifyTirisImageryLayer("orthofoto", { name: "Historische Orthofotos 1999", path: [] });
	assert.equal(result.usable, true);
	assert.equal(result.category, "Historisch");
});
