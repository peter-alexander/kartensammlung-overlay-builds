import test from "node:test";
import assert from "node:assert/strict";
import { parseVogisWms, buildVogisCatalog, VOGIS_SERVICES } from "./wms-lib.mjs";

const xml = `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0"><Capability><Request><GetMap>
<Format>image/png</Format></GetMap></Request><Layer>
<Title>GeoServer</Title><CRS>EPSG:3857</CRS>
<Layer><Title>Wasser</Title><Layer queryable="1"><Name>vogis:fluesse</Name><Title>Fließgewässer</Title></Layer></Layer>
<Layer><Name>vogis:see</Name><Title>See</Title></Layer></Layer></Capability>
</WMS_Capabilities>`;
test("read WMS Layer tree with inherited Web Mercator, preserve nested titles", () => {
	const result = parseVogisWms(xml, VOGIS_SERVICES[0]);
	assert.equal(result.layers.length, 2);
	assert.deepEqual(result.layers.find(x => x.id === "vogis:fluesse").path, ["GeoServer", "Wasser"]);
	assert.equal(result.layers.find(x => x.id === "vogis:fluesse").queryable, true);
});
test("reject unsupported projections and error pages", () => {
	assert.throws(() => parseVogisWms(xml.replaceAll("EPSG:3857", "EPSG:31254"), VOGIS_SERVICES[0]), /keine EPSG/);
	assert.throws(() => parseVogisWms("<html>error</html>", VOGIS_SERVICES[0]), /ungültige/);
});
test("validate all registered services before replacing live catalog", () => {
	assert.throws(() => buildVogisCatalog({themen: xml}), /fehlende/);
	assert.equal(buildVogisCatalog(Object.fromEntries(VOGIS_SERVICES.map(s => [s.id,xml]))).version, 1);
});

test("new topographic service URLs are pinned to the official Vorarlberg host", () => {
	for (const id of ["gelaende", "relief", "flaechenwidmung", "holzvorrat", "solarpotential", "waldflaeche", "umgebung"]) {
		const entry = VOGIS_SERVICES.find(x => x.id === id);
		assert.ok(entry);
		assert.match(entry.url, /^https:\/\/vogis\.cnv\.at\/mapserver\/mapserv\?map=i_[a-z0-9_]+\.map$/);
	}
});
