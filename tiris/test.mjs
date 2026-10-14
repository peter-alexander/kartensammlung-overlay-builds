import assert from "node:assert/strict";
import { test } from "node:test";
import { TIRIS_SERVICES, normalizeTirisService, buildTirisCatalog } from "./catalog.mjs";

test("tiris baut nur einzelne Blattebenen und erhält Elternnamen", () => {
	const descriptor = TIRIS_SERVICES[0];
	const result = normalizeTirisService(descriptor, {
		capabilities: "Map,Query,Data",
		layers: [
			{ id: 0, name: "Gruppe", parentLayerId: -1, subLayerIds: [3] },
			{ id: 3, name: "Radweg", parentLayerId: 0, subLayerIds: null, type: "Feature Layer", minScale: 10000 }
		]
	});
	assert.equal(result.layers.length, 1);
	assert.deepEqual(result.layers[0].path, ["Gruppe"]);
	assert.equal(result.layers[0].id, 3);
	assert.equal(result.layers[0].minScale, 10000);
});

test("tiris verweigert unvollständigen Produktionskatalog", () => {
	assert.throws(() => buildTirisCatalog([]), /unvollständige/);
	assert.throws(() => normalizeTirisService(TIRIS_SERVICES[0], { error: { code: 403 } }), /fehlerhafte/);
});
