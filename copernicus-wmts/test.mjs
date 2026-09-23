import assert from "node:assert/strict";
import { parseCopernicusCapabilities } from "./lib.mjs";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Capabilities xmlns:ows="http://www.opengis.net/ows/1.1">
	<Contents>
		<TileMatrixSet>
			<ows:Identifier>PopularWebMercator512</ows:Identifier>
			<ows:SupportedCRS>EPSG:3857</ows:SupportedCRS>
			<ows:WellKnownScaleSet>urn:test</ows:WellKnownScaleSet>
			<TileMatrix><ows:Identifier>0</ows:Identifier></TileMatrix>
			<TileMatrix><ows:Identifier>1</ows:Identifier></TileMatrix>
		</TileMatrixSet>
		<Layer>
			<ows:Title>True Color</ows:Title>
			<ows:Abstract>Example</ows:Abstract>
			<ows:Identifier>true-color</ows:Identifier>
			<Style isDefault="true">
				<ows:Title>Default</ows:Title>
				<ows:Identifier>default</ows:Identifier>
			</Style>
			<Format>image/png</Format>
			<TileMatrixSetLink>
				<TileMatrixSet>PopularWebMercator512</TileMatrixSet>
			</TileMatrixSetLink>
			<Dimension>
				<ows:Identifier>time</ows:Identifier>
			</Dimension>
			<ResourceURL
				resourceType="tile"
				format="image/png"
				template="https://example.test/{TileMatrix}/{TileRow}/{TileCol}.png"
			/>
		</Layer>
	</Contents>
</Capabilities>`;

const catalog = parseCopernicusCapabilities(xml);

assert.equal(catalog.meta.count, 1);
assert.equal(catalog.meta.tileMatrixSetCount, 1);
assert.deepEqual(
	catalog.tileMatrixSets.PopularWebMercator512.tileMatrices,
	["0", "1"]
);
assert.equal(catalog.layers.cop_true_color.name, "True Color");
assert.equal(catalog.layers.cop_true_color.wmtsLayer, "true-color");
assert.equal(catalog.layers.cop_true_color.style, "default");
assert.equal(catalog.layers.cop_true_color.format, "image/png");
assert.equal(catalog.layers.cop_true_color.defaultTileMatrixSet, "PopularWebMercator512");
assert.equal(catalog.layers.cop_true_color.hasTimeDimension, true);
assert.equal(
	catalog.layers.cop_true_color.resourceTemplate.template,
	"https://example.test/{TileMatrix}/{TileRow}/{TileCol}.png"
);

console.log("Copernicus WMTS parser tests: OK");
