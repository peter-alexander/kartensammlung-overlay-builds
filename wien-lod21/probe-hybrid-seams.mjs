#!/usr/bin/env node

import fs from "node:fs";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";

const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const reader = new GeoJSONReader();
const buffers = [-0.05, 0, 0.05, 0.25];

function parts(geometry) {
	if (!geometry || geometry.isEmpty()) return [];
	const count = Number(geometry.getNumGeometries?.() || 1);
	return Array.from({ length: count }, (_, index) => (
		count === 1 ? geometry : geometry.getGeometryN(index)
	)).filter((part) => part && !part.isEmpty());
}

const byCode = new Map();
for (const feature of input.geojson?.features || []) {
	const code = String(feature.properties?.historicalCode || "");
	if (!byCode.has(code)) byCode.set(code, {});
	byCode.get(code)[String(feature.properties?.kind || "")] = reader.read(feature.geometry);
}

const report = [];
for (const [code, geometries] of [...byCode].sort()) {
	if (!geometries.current || !geometries.historical) continue;
	const variants = [];
	for (const bufferM of buffers) {
		const mask = bufferM === 0
			? geometries.historical
			: BufferOp.bufferOp(geometries.historical, bufferM);
		const remainder = OverlayOp.overlayOp(
			geometries.current,
			mask,
			OverlayOp.DIFFERENCE
		);
		const remainderParts = parts(remainder)
			.map((part) => Number(part.getArea?.() || 0))
			.sort((a, b) => b - a);
		variants.push({
			bufferM,
			remainderAreaM2: Number(remainder.getArea().toFixed(3)),
			components: remainderParts.length,
			sliverComponentsLt2m2: remainderParts.filter((area) => area < 2).length,
			sliverAreaLt2m2: Number(
				remainderParts.filter((area) => area < 2)
					.reduce((sum, area) => sum + area, 0)
					.toFixed(3)
			)
		});
	}
	report.push({ historicalCode: code, variants });
}

console.log(JSON.stringify(report, null, 2));
