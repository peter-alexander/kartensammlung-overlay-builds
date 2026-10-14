import test from "node:test";
import assert from "node:assert/strict";
import { buildNoeAtlasCatalog, NOE_ATLAS_ELIGIBLE_IDS } from "./noe-atlas-catalog.mjs";

const entries = [
	...Array.from({ length: 31 }, (_, i) => ({
		id: "service_" + i, name: "Other " + i, type: "image", isbasemap: false
	})),
	...NOE_ATLAS_ELIGIBLE_IDS.map(id => ({
		id, name: id, type: "tile", isbasemap: false, supportedCrs: [3857]
	}))
];
const details = Object.fromEntries(NOE_ATLAS_ELIGIBLE_IDS.map(id => {
	const path = id.slice(3);
	return [id, {
		services: [{
			id, type: "tile", supportedCrs: [3857],
			layers: [{ id: "0", name: path }],
			properties: { tileurl: "https://maps.noe.gv.at/tilecache/bmap/epsg3857/"
				+ path + "/L{z_}/R{y_}/C{x_}.png" }
		}]
	}];
}));

test("Atlas catalog permits only two OGD hazard tiles and records the complete source inventory", () => {
	const catalog = buildNoeAtlasCatalog({ services: entries }, details, "2026-10-14T00:00:00Z");
	assert.equal(catalog.version, 1);
	assert.equal(catalog.counts.total, 33);
	assert.equal(catalog.counts.integrated, 2);
	assert.equal(catalog.inventory.length, 33);
	assert.deepEqual(catalog.tiles.map(t => t.id), NOE_ATLAS_ELIGIBLE_IDS);
	assert.ok(catalog.tiles.every(t => t.tileTemplate.startsWith("https://maps.noe.gv.at/")));
});

test("Atlas catalog rejects changed services, invalid tiling paths and missing details", () => {
	assert.throws(() => buildNoeAtlasCatalog({ services: entries.slice(0, 5) }, details), /unplausibel/);
	assert.throws(() => buildNoeAtlasCatalog({ services: entries }, {}), /fehlender/);
	const forged = structuredClone(details);
	forged[NOE_ATLAS_ELIGIBLE_IDS[0]].services[0].properties.tileurl = "https://evil.example/L{z_}";
	assert.throws(() => buildNoeAtlasCatalog({ services: entries }, forged), /Kachelschema/);
});
