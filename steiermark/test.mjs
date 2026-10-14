import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverSteiermarkServices, normalizeSteiermarkService, buildSteiermarkCatalog } from "./catalog.mjs";

const directory = {
	services: [
		{ name: "OGD/Geologie_Steiermark", type: "MapServer" },
		{ name: "OGD/als_schummerung", type: "MapServer" },
		{ name: "Services/Internal", type: "MapServer" },
		{ name: "OGD/Raster", type: "ImageServer" }
	]
};

test("Steiermark discovers only MapServer services in the OGD folder", () => {
	const found = discoverSteiermarkServices(directory);
	assert.deepEqual(found.map(entry => entry.id), ["als_schummerung", "geologie_steiermark"]);
	assert.match(found[1].url, /^https:\/\/gis\.stmk\.gv\.at\/arcgis\/rest\/services\/OGD\//);
	assert.throws(() => discoverSteiermarkServices({ services: [] }), /keine öffentlichen/);
	assert.throws(() => discoverSteiermarkServices({ error: { message: "failure" } }), /ungültig/);
});

test("Steiermark keeps only individually renderable leaf layers and parent labels", () => {
	const descriptor = discoverSteiermarkServices(directory)[1];
	const normalized = normalizeSteiermarkService(descriptor, {
		capabilities: "Map,Query,Data",
		layers: [
			{ id: 0, name: "Geologie", parentLayerId: -1, subLayerIds: [1], type: "Group Layer" },
			{ id: 1, name: "Tektonik", parentLayerId: 0, subLayerIds: null, type: "Feature Layer", minScale: 250000 }
		]
	});
	assert.equal(normalized.layers.length, 1);
	assert.deepEqual(normalized.layers[0].path, ["Geologie"]);
	assert.equal(normalized.layers[0].minScale, 250000);
	assert.throws(() => normalizeSteiermarkService({ ...descriptor, url: "https://example.com/MapServer" }, { layers: [] }), /unzulässige/);
});

test("Steiermark rejects incomplete catalogs and includes attribution", () => {
	const descriptors = discoverSteiermarkServices(directory);
	const result = normalizeSteiermarkService(descriptors[0], { layers: [{ id: 0, name: "Relief" }] });
	assert.throws(() => buildSteiermarkCatalog(descriptors, [result]), /unvollständige/);
	const empty = normalizeSteiermarkService(descriptors[1], { layers: [] });
	const catalog = buildSteiermarkCatalog(descriptors, [result, empty]);
	assert.equal(Object.keys(catalog.services).length, 1);
	assert.match(catalog.attribution, /CC BY 4\.0/);
});
