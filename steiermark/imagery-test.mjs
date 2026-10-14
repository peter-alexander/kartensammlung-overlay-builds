import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverSteiermarkImagery, buildSteiermarkImageryCatalog } from "./imagery-catalog.mjs";

const data = {
	services: [
		{ name: "OGD_DOP/Orthofotos_akt", type: "ImageServer" },
		{ name: "OGD_DOP/SW_1994_2001", type: "ImageServer" },
		{ name: "Services/Internal", type: "ImageServer" },
		{ name: "OGD_DOP/Map", type: "MapServer" }
	]
};

test("Steiermark imagery catalogs only public OGD image services", () => {
	const found = discoverSteiermarkImagery(data);
	assert.equal(found.length, 2);
	assert.equal(found[0].category, "Luft- & Satellitenbilder");
	assert.equal(found[1].category, "Historisch");
	assert.match(found[0].url, /\/OGD_DOP\/Orthofotos_akt\/ImageServer$/);
});

test("Steiermark imagery rejects incomplete and errored metadata", () => {
	const found = discoverSteiermarkImagery(data);
	assert.throws(() => buildSteiermarkImageryCatalog(found, [{}]), /unvollständige/);
	assert.throws(() => buildSteiermarkImageryCatalog(found, [{ extent: {}, pixelSizeX: 0.2 }, { error: {} }]), /nicht bestätigt/);
	assert.equal(buildSteiermarkImageryCatalog(found, [{ extent: {}, pixelSizeX: 0.2 }, { extent: {}, pixelSizeX: 0.5 }]).services.length, 2);
});
