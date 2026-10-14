import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTirisWmtsCatalog } from "./wmts-lib.mjs";

const xml = `<?xml version="1.0"?>
<Capabilities xmlns="http://www.opengis.net/wmts/1.0">
	<Contents>
		<Layer>
			<Identifier>gdi_base_summer</Identifier>
			<Style isDefault="true"><Identifier>default</Identifier></Style>
			<Format>image/png</Format>
			<TileMatrixSetLink><TileMatrixSet>WebMercator</TileMatrixSet></TileMatrixSetLink>
			<ResourceURL resourceType="tile" format="image/png" template="https://example.org/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/>
		</Layer>
		<TileMatrixSet>
			<Identifier>WebMercator</Identifier>
			<SupportedCRS>urn:ogc:def:crs:EPSG::3857</SupportedCRS>
			<TileMatrix><Identifier>0</Identifier><MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight><TileWidth>256</TileWidth><TileHeight>256</TileHeight></TileMatrix>
			<TileMatrix><Identifier>1</Identifier><MatrixWidth>2</MatrixWidth><MatrixHeight>2</MatrixHeight><TileWidth>256</TileWidth><TileHeight>256</TileHeight></TileMatrix>
		</TileMatrixSet>
	</Contents>
</Capabilities>`;

test("WMTS catalog converts only suitable WebMercator tile matrices", () => {
	const catalog = buildTirisWmtsCatalog(xml);
	assert.equal(catalog.layers[0].id, "gdi_base_summer");
	assert.equal(catalog.layers[0].url, "https://example.org/WebMercator/{z}/{y}/{x}.png");
	assert.equal(catalog.layers[0].maxzoom, 1);
});

test("WMTS catalog refuses incompatible CRS without fallback guessing", () => {
	assert.throws(() => buildTirisWmtsCatalog(xml.replace("3857", "31254")), /keine kompatible/);
});
