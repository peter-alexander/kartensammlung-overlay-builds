import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildTirisImageryCatalog, classifyTirisImageryLayer
} from "./imagery-catalog.mjs";

test("tiris imagery catalog finds current RGB, historical RGB and terrain hillshades", () => {
	const orthofoto = {
		layers: [
			{ id: 0, name: "Aktuell_RGB", parentLayerId: -1, subLayerIds: [1, 2, 3] },
			{ id: 1, name: "Flugjahr_Aktuell_RGB", parentLayerId: 0 },
			{ id: 2, name: "Footprint_Aktuell_RGB", parentLayerId: 0 },
			{ id: 3, name: "Image_Aktuell_RGB", parentLayerId: 0 },
			{ id: 4, name: "1970_1982", parentLayerId: -1, subLayerIds: [5, 6, 7] },
			{ id: 5, name: "Flugjahr_1970_1982", parentLayerId: 4 },
			{ id: 6, name: "Footprint_1970_1982", parentLayerId: 4 },
			{ id: 7, name: "Image_1970_1982", parentLayerId: 4 }
		]
	};
	const terrain = {
		layers: [
			{ id: 1, name: "Schummerung Gelaendemodell", parentLayerId: -1, subLayerIds: [2, 3, 4] },
			{ id: 2, name: "Boundary_Schummerung_Gelaendemodell", parentLayerId: 1 },
			{ id: 3, name: "Footprint_Schummerung_Gelaendemodell", parentLayerId: 1 },
			{ id: 4, name: "Image_Schummerung_Gelaendemodell", parentLayerId: 1 },
			{ id: 5, name: "Hoehenschichtlinien_20m", parentLayerId: -1 }
		]
	};
	const cat = buildTirisImageryCatalog([orthofoto, terrain]);
	assert.deepEqual(cat.services.orthofoto.layers.map(x => x.id), [3, 7]);
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
	const result = classifyTirisImageryLayer("orthofoto", { name: "Image_1999", path: ["Historische Orthofotos 1999"] });
	assert.equal(result.usable, true);
	assert.equal(result.category, "Historisch");
});
