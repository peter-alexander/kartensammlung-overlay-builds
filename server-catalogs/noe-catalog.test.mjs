import test from "node:test";
import assert from "node:assert/strict";
import { buildNoeCatalog } from "./noe-catalog.mjs";

const regularLayers = Array.from({ length: 21 }, (_, i) =>
	`<Layer><Name>OGD:TEST_${i}</Name><Title>Test ${i}</Title></Layer>`
).join("");

const wmsXml = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities><Capability>
<Request><GetFeatureInfo><Format>application/json</Format></GetFeatureInfo></Request>
<Layer queryable="0">
	<Layer queryable="1"><Name>OGD:RRU_RBN</Name><Title>Rad-Basisnetz</Title></Layer>
	<Layer><Name>OGD:FEK_ALS_META</Name><Title>Flugmetadaten</Title></Layer>
	${regularLayers}
</Layer>
</Capability></WMS_Capabilities>`;
const wfsXml = `<WFS_Capabilities><FeatureTypeList><FeatureType>
<Name>OGD:RRU_RBN</Name></FeatureType></FeatureTypeList></WFS_Capabilities>`;
const wmtsXml = `<Capabilities xmlns:ows="http://www.opengis.net/ows/1.1">
<Contents><Layer><ows:Identifier>OGD:RRU_RBN</ows:Identifier>
<Format>image/png</Format><TileMatrixSetLink><TileMatrixSet>EPSG:900913</TileMatrixSet></TileMatrixSetLink>
</Layer></Contents></Capabilities>`;

test("NÖ catalog joins WMS, WFS and WMTS and excludes metadata layers", () => {
	const catalog = buildNoeCatalog({ wmsXml, wfsXml, wmtsXml });
	assert.equal(catalog.version, 2);
	const rbn = catalog.layers.find((layer) => layer.name === "OGD:RRU_RBN");
	assert.equal(rbn.title, "Rad-Basisnetz");
	assert.equal(rbn.queryable, true);
	assert.equal(rbn.infoFormat, "application/json");
	assert.equal(rbn.wfs, true);
	assert.deepEqual(rbn.cache, { format: "png" });
	assert.equal(catalog.layers.some((layer) => layer.name === "OGD:FEK_ALS_META"), false);
	assert.equal(catalog.counts.cached, 1);
	assert.equal(catalog.counts.wms, 22);
});

test("Unavailable auxiliary capabilities do not accidentally enable TMS", () => {
	const catalog = buildNoeCatalog({ wmsXml, wfsXml: null, wmtsXml: null });
	assert.equal(catalog.counts.wfs, 0);
	assert.equal(catalog.counts.cached, 0);
});
