#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import UnionOp from "jsts/org/locationtech/jts/operation/union/UnionOp.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";

const GML_NS = "http://www.opengis.net/gml";
const BLDG_NS = "http://www.opengis.net/citygml/building/1.0";

function parseArgs(argv) {
	const result = {
		input: "",
		current: "",
		targets: "",
		output: ""
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--input") {
			result.input = path.resolve(argv[++index]);
		} else if (arg === "--current") {
			result.current = path.resolve(argv[++index]);
		} else if (arg === "--targets") {
			result.targets = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.input || !result.current || !result.targets || !result.output) {
		throw new Error("--input, --current, --targets and --output are required.");
	}
	return result;
}

function finiteNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function localName(node) {
	return String(node?.localName || node?.nodeName || "").replace(/^.*:/, "");
}

function elementChildren(node) {
	const result = [];
	for (let child = node?.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === 1) result.push(child);
	}
	return result;
}

function descendantByName(node, namespace, name) {
	return node?.getElementsByTagNameNS?.(namespace, name)?.[0] || null;
}

function textContent(node) {
	return String(node?.textContent || "").trim();
}

function nodeAttribute(node, namespace, name) {
	return String(
		node?.getAttributeNS?.(namespace, name)
		|| node?.getAttribute?.("gml:" + name)
		|| ""
	);
}

function parseLinearRing(linearRing) {
	if (!linearRing) return [];
	const posList = descendantByName(linearRing, GML_NS, "posList");
	if (posList) {
		const values = textContent(posList)
			.split(/\s+/)
			.map(Number)
			.filter(Number.isFinite);
		if (values.length < 9 || values.length % 3 !== 0) return [];
		const points = [];
		for (let index = 0; index < values.length; index += 3) {
			points.push([values[index], values[index + 1], values[index + 2]]);
		}
		return points;
	}
	const positions = linearRing.getElementsByTagNameNS(GML_NS, "pos");
	const points = [];
	for (let index = 0; index < positions.length; index += 1) {
		const values = textContent(positions[index])
			.split(/\s+/)
			.map(Number)
			.filter(Number.isFinite);
		if (values.length >= 3) points.push(values.slice(0, 3));
	}
	return points;
}

function closeRing2D(points) {
	const ring = [];
	for (const point of points || []) {
		if (
			!ring.length
			|| ring[ring.length - 1][0] !== point[0]
			|| ring[ring.length - 1][1] !== point[1]
		) {
			ring.push([point[0], point[1]]);
		}
	}
	if (
		ring.length
		&& (
			ring[0][0] !== ring[ring.length - 1][0]
			|| ring[0][1] !== ring[ring.length - 1][1]
		)
	) {
		ring.push([...ring[0]]);
	}
	return ring;
}

function parsePolygon(polygon) {
	const rings = [];
	const exterior = descendantByName(
		descendantByName(polygon, GML_NS, "exterior"),
		GML_NS,
		"LinearRing"
	);
	const outer = parseLinearRing(exterior);
	if (outer.length >= 3) rings.push(outer);

	const interiors = polygon?.getElementsByTagNameNS?.(GML_NS, "interior") || [];
	for (let index = 0; index < interiors.length; index += 1) {
		const ring = parseLinearRing(
			descendantByName(interiors[index], GML_NS, "LinearRing")
		);
		if (ring.length >= 3) rings.push(ring);
	}
	return rings;
}

function semanticSurfaceKind(surfaceNode) {
	switch (localName(surfaceNode)) {
		case "RoofSurface":
			return "roof";
		case "WallSurface":
			return "wall";
		case "GroundSurface":
			return "ground";
		default:
			return "other";
	}
}

function parseSemanticSurfaces(building) {
	const surfaces = [];
	const boundedBy = building.getElementsByTagNameNS(BLDG_NS, "boundedBy");
	for (let index = 0; index < boundedBy.length; index += 1) {
		const surfaceNode = elementChildren(boundedBy[index])[0];
		if (!surfaceNode) continue;
		const semantic = semanticSurfaceKind(surfaceNode);
		const polygons = surfaceNode.getElementsByTagNameNS(GML_NS, "Polygon");
		for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
			const rings = parsePolygon(polygons[polygonIndex]);
			if (rings.length) surfaces.push({ semantic, rings });
		}
	}
	return surfaces;
}

function repairGeometry(geometry) {
	if (!geometry || geometry.isEmpty()) return null;
	try {
		return BufferOp.bufferOp(geometry, 0);
	} catch {
		return geometry;
	}
}

function unionGeometries(geometries) {
	let result = null;
	for (const geometry of geometries || []) {
		const repaired = repairGeometry(geometry);
		if (!repaired || repaired.isEmpty()) continue;
		try {
			result = result ? UnionOp.union(result, repaired) : repaired;
		} catch {
			const repairedResult = repairGeometry(result);
			result = repairedResult
				? UnionOp.union(repairedResult, repaired)
				: repaired;
		}
	}
	return result;
}

function safeIntersection(a, b) {
	try {
		return OverlayOp.overlayOp(a, b, OverlayOp.INTERSECTION);
	} catch {
		const repairedA = repairGeometry(a);
		const repairedB = repairGeometry(b);
		if (!repairedA || !repairedB) return null;
		try {
			return OverlayOp.overlayOp(
				repairedA,
				repairedB,
				OverlayOp.INTERSECTION
			);
		} catch {
			return null;
		}
	}
}

function surfaceGeometry(surface, reader) {
	if (!surface?.rings?.length) return null;
	const coordinates = surface.rings
		.map((ring) => closeRing2D(ring))
		.filter((ring) => ring.length >= 4);
	if (!coordinates.length) return null;
	try {
		return repairGeometry(reader.read({
			type: "Polygon",
			coordinates
		}));
	} catch {
		return null;
	}
}

function groundGeometry(surfaces, reader) {
	return unionGeometries(
		(surfaces || [])
			.filter((surface) => surface.semantic === "ground")
			.map((surface) => surfaceGeometry(surface, reader))
			.filter(Boolean)
	);
}

function buildingName(building) {
	const direct = elementChildren(building).find(
		(child) => localName(child) === "name"
	);
	return direct
		? textContent(direct)
		: textContent(descendantByName(building, GML_NS, "name"));
}

function buildingRoofType(building) {
	return textContent(descendantByName(building, BLDG_NS, "roofType"));
}

function *buildingXmlMatches(xml) {
	const expression = /<(?:[A-Za-z_][\w.-]*:)?Building\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?Building>/g;
	let match;
	while ((match = expression.exec(String(xml)))) yield match[0];
}

function parseBuildingFragment(buildingXml, filePath) {
	const wrapped = [
		'<ks:root xmlns:ks="urn:kartensammlung:wien-lod21"',
		' xmlns:gml="http://www.opengis.net/gml"',
		' xmlns:bldg="http://www.opengis.net/citygml/building/1.0"',
		' xmlns:core="http://www.opengis.net/citygml/1.0"',
		' xmlns:xlink="http://www.w3.org/1999/xlink">',
		buildingXml,
		"</ks:root>"
	].join("");
	const document = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: (message) => {
				throw new Error(
					"CityGML building parse error in "
					+ filePath + ": " + message
				);
			},
			fatalError: (message) => {
				throw new Error(
					"CityGML building fatal parse error in "
					+ filePath + ": " + message
				);
			}
		}
	}).parseFromString(wrapped, "application/xml");
	return document.getElementsByTagNameNS(BLDG_NS, "Building")[0] || null;
}

async function listFilesRecursive(root) {
	const result = [];
	async function visit(directory) {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(fullPath);
			} else if (/\.gml$/i.test(entry.name)) {
				result.push(fullPath);
			}
		}
	}
	await visit(root);
	return result.sort();
}

function round(value, digits = 3) {
	return Number.isFinite(value)
		? Number(value.toFixed(digits))
		: null;
}

function historicalObject(building, surfaces, reader, sourceSheet) {
	const ground = groundGeometry(surfaces, reader);
	if (!ground || ground.isEmpty()) return null;
	const groundPoints = surfaces
		.filter((surface) => surface.semantic === "ground")
		.flatMap((surface) => surface.rings.flat());
	const roofPoints = surfaces
		.filter((surface) => surface.semantic === "roof")
		.flatMap((surface) => surface.rings.flat());
	const groundZ = groundPoints.map((point) => point[2]).filter(Number.isFinite);
	const roofZ = roofPoints.map((point) => point[2]).filter(Number.isFinite);
	if (!groundZ.length || !roofZ.length) return null;

	const groundMinZ = Math.min(...groundZ);
	const groundMaxZ = Math.max(...groundZ);
	const roofMinZ = Math.min(...roofZ);
	const roofMaxZ = Math.max(...roofZ);
	const roofSurfaces = (surfaces || [])
		.filter((surface) => surface.semantic === "roof")
		.map((surface, index) => {
			const geometry = surfaceGeometry(surface, reader);
			const values = surface.rings
				.flat()
				.map((point) => Number(point[2]))
				.filter(Number.isFinite);
			if (!geometry || geometry.isEmpty() || !values.length) return null;
			return {
				index,
				geometry,
				projectedAreaM2: Number(geometry.getArea?.() || 0),
				minZ: Math.min(...values),
				maxZ: Math.max(...values)
			};
		})
		.filter(Boolean);
	return {
		cityGmlId: nodeAttribute(building, GML_NS, "id"),
		sourceSheet,
		roofType: buildingRoofType(building),
		geometry: ground,
		roofSurfaces,
		groundAreaM2: Number(ground.getArea?.() || 0),
		groundMinZ,
		groundMaxZ,
		roofMinZ,
		roofMaxZ,
		eaveProxyHeightM: roofMinZ - groundMinZ,
		ridgeHeightM: roofMaxZ - groundMinZ,
		roofRiseM: roofMaxZ - roofMinZ
	};
}

function currentPart(feature, reader) {
	if (!feature?.geometry) return null;
	let geometry;
	try {
		geometry = repairGeometry(reader.read(feature.geometry));
	} catch {
		return null;
	}
	if (!geometry || geometry.isEmpty()) return null;
	const properties = feature.properties || {};
	const oKote = finiteNumber(properties.O_KOTE);
	const tKote = finiteNumber(properties.T_KOTE);
	const terrain = tKote ?? finiteNumber(properties.HOEHE_DGM);
	return {
		fmzkId: String(properties.FMZK_ID ?? ""),
		ksId: String(properties.KS_ID ?? ""),
		bwGebId: finiteNumber(properties.BW_GEB_ID),
		geometry,
		areaM2: Number(geometry.getArea?.() || 0),
		oKote,
		tKote,
		hoeheDgm: finiteNumber(properties.HOEHE_DGM),
		uKote: finiteNumber(properties.U_KOTE),
		currentHeightM: (
			oKote !== null
			&& terrain !== null
		)
			? oKote - terrain
			: null
	};
}

function overlapRow(object, part) {
	const intersection = safeIntersection(object.geometry, part.geometry);
	const areaM2 = Number(intersection?.getArea?.() || 0);
	if (!(areaM2 > 1e-6)) return null;
	const eaveDifferenceM = (
		part.oKote !== null
		? part.oKote - object.roofMinZ
		: null
	);
	const ridgeDifferenceM = (
		part.oKote !== null
		? part.oKote - object.roofMaxZ
		: null
	);
	return {
		cityGmlId: object.cityGmlId,
		fmzkId: part.fmzkId,
		ksId: part.ksId,
		intersectionAreaM2: round(areaM2),
		historicalObjectCoverage: round(
			areaM2 / object.groundAreaM2,
			6
		),
		currentPartCoverage: round(
			areaM2 / part.areaM2,
			6
		),
		currentOKote: round(part.oKote),
		historicalRoofMinZ: round(object.roofMinZ),
		historicalRoofMaxZ: round(object.roofMaxZ),
		eaveDifferenceM: round(eaveDifferenceM),
		ridgeDifferenceM: round(ridgeDifferenceM),
		currentOKoteInsideHistoricalRoofRange: (
			part.oKote !== null
			&& part.oKote >= object.roofMinZ - 0.5
			&& part.oKote <= object.roofMaxZ + 0.5
		)
	};
}

function weightedQuantile(samples, quantile, valueKey, weightKey = "areaM2") {
	const rows = (samples || [])
		.map((item) => ({
			value: Number(item?.[valueKey]),
			weight: Number(item?.[weightKey])
		}))
		.filter((item) => Number.isFinite(item.value) && item.weight > 0)
		.sort((a, b) => a.value - b.value);
	if (!rows.length) return null;
	const total = rows.reduce((sum, item) => sum + item.weight, 0);
	const threshold = total * Math.min(1, Math.max(0, quantile));
	let cumulative = 0;
	for (const item of rows) {
		cumulative += item.weight;
		if (cumulative >= threshold) return item.value;
	}
	return rows[rows.length - 1].value;
}

function localizedPartHeightAudit(objects, historicalUnion, part) {
	const historicalIntersection = safeIntersection(
		historicalUnion,
		part.geometry
	);
	const historicalAreaM2 = Number(
		historicalIntersection?.getArea?.() || 0
	);
	const roofSamples = [];
	for (const object of objects || []) {
		for (const surface of object.roofSurfaces || []) {
			const intersection = safeIntersection(
				surface.geometry,
				part.geometry
			);
			const areaM2 = Number(intersection?.getArea?.() || 0);
			if (!(areaM2 > 1e-6)) continue;
			roofSamples.push({
				cityGmlId: object.cityGmlId,
				surfaceIndex: surface.index,
				areaM2,
				minZ: surface.minZ,
				maxZ: surface.maxZ
			});
		}
	}
	const largestSurface = [...roofSamples].sort(
		(a, b) => b.areaM2 - a.areaM2
	)[0] || null;
	const eaveZP25 = weightedQuantile(roofSamples, 0.25, "minZ");
	const eaveZP50 = weightedQuantile(roofSamples, 0.50, "minZ");
	const eaveZP75 = weightedQuantile(roofSamples, 0.75, "minZ");
	const eaveZP90 = weightedQuantile(roofSamples, 0.90, "minZ");
	const difference = (z) => (
		part.oKote !== null && Number.isFinite(z)
			? part.oKote - z
			: null
	);
	return {
		fmzkId: part.fmzkId,
		ksId: part.ksId,
		areaM2: round(part.areaM2),
		historicalCoverage: round(
			part.areaM2 > 0 ? historicalAreaM2 / part.areaM2 : 0,
			6
		),
		currentOKote: round(part.oKote),
		currentHeightM: round(part.currentHeightM),
		roofSampleCount: roofSamples.length,
		roofProjectedOverlapAreaM2: round(
			roofSamples.reduce((sum, item) => sum + item.areaM2, 0)
		),
		eaveZP25: round(eaveZP25),
		eaveZP50: round(eaveZP50),
		eaveZP75: round(eaveZP75),
		eaveZP90: round(eaveZP90),
		largestSurfaceMinZ: round(largestSurface?.minZ),
		eaveDifferenceP25M: round(difference(eaveZP25)),
		eaveDifferenceP50M: round(difference(eaveZP50)),
		eaveDifferenceP75M: round(difference(eaveZP75)),
		eaveDifferenceP90M: round(difference(eaveZP90)),
		eaveDifferenceLargestSurfaceM:
			round(difference(largestSurface?.minZ)),
		roofSamples: roofSamples.map((item) => ({
			cityGmlId: item.cityGmlId,
			surfaceIndex: item.surfaceIndex,
			areaM2: round(item.areaM2),
			minZ: round(item.minZ),
			maxZ: round(item.maxZ)
		}))
	};
}

async function main() {
	const args = parseArgs(process.argv);
	const targetsJson = JSON.parse(await fs.readFile(args.targets, "utf8"));
	const currentJson = JSON.parse(await fs.readFile(args.current, "utf8"));
	const targets = targetsJson.buildings || [];
	const targetByCode = new Map(
		targets.map((target) => [String(target.historicalCode), target])
	);
	const reader = new GeoJSONReader();

	const currentByCode = new Map();
	for (const feature of currentJson.features || []) {
		const code = String(feature?.properties?.KS_HISTORICAL_CODE || "");
		if (!targetByCode.has(code)) continue;
		const part = currentPart(feature, reader);
		if (!part) continue;
		if (!currentByCode.has(code)) currentByCode.set(code, []);
		currentByCode.get(code).push(part);
	}

	const historicalByCode = new Map();
	const files = await listFilesRecursive(args.input);
	for (const filePath of files) {
		const sourceSheet = path.basename(
			filePath,
			path.extname(filePath)
		);
		const xml = await fs.readFile(filePath, "utf8");
		for (const buildingXml of buildingXmlMatches(xml)) {
			const building = parseBuildingFragment(buildingXml, filePath);
			if (!building) continue;
			const code = buildingName(building);
			const target = targetByCode.get(code);
			if (!target) continue;
			if (
				target.sheet
				&& /^\d{6}$/.test(sourceSheet)
				&& String(target.sheet) !== sourceSheet
			) continue;
			const surfaces = parseSemanticSurfaces(building);
			const object = historicalObject(
				building,
				surfaces,
				reader,
				sourceSheet
			);
			if (!object) continue;
			if (!historicalByCode.has(code)) historicalByCode.set(code, []);
			historicalByCode.get(code).push(object);
		}
	}

	const rows = [];
	for (const target of targets) {
		const code = String(target.historicalCode);
		const objects = historicalByCode.get(code) || [];
		const parts = currentByCode.get(code) || [];
		if (!objects.length) {
			throw new Error(code + ": no historical objects found.");
		}
		if (!parts.length) {
			throw new Error(code + ": no current FMZK parts found.");
		}

		const overlaps = [];
		for (const object of objects) {
			for (const part of parts) {
				const row = overlapRow(object, part);
				if (row) overlaps.push(row);
			}
		}
		const bestByObject = objects.map((object) => {
			const matches = overlaps
				.filter((item) => item.cityGmlId === object.cityGmlId)
				.sort(
					(a, b) => b.intersectionAreaM2 - a.intersectionAreaM2
				);
			return matches[0] || null;
		});
		const historicalUnion = unionGeometries(
			objects.map((object) => object.geometry)
		);
		const partHeightAudit = parts.map((part) => (
			localizedPartHeightAudit(objects, historicalUnion, part)
		));

		rows.push({
			historicalCode: code,
			knownManualProduction:
				target.knownManualProduction === true,
			sourceMetrics: target.sourceMetrics || null,
			historicalObjects: objects.map((object) => ({
				cityGmlId: object.cityGmlId,
				sourceSheet: object.sourceSheet,
				roofType: object.roofType,
				groundAreaM2: round(object.groundAreaM2),
				groundMinZ: round(object.groundMinZ),
				groundMaxZ: round(object.groundMaxZ),
				roofMinZ: round(object.roofMinZ),
				roofMaxZ: round(object.roofMaxZ),
				eaveProxyHeightM: round(object.eaveProxyHeightM),
				ridgeHeightM: round(object.ridgeHeightM),
				roofRiseM: round(object.roofRiseM),
				roofSurfaceCount: object.roofSurfaces?.length || 0
			})),
			currentParts: parts.map((part) => ({
				fmzkId: part.fmzkId,
				ksId: part.ksId,
				bwGebId: part.bwGebId,
				areaM2: round(part.areaM2),
				oKote: round(part.oKote),
				tKote: round(part.tKote),
				hoeheDgm: round(part.hoeheDgm),
				uKote: round(part.uKote),
				currentHeightM: round(part.currentHeightM)
			})),
			overlaps,
			bestOverlapByHistoricalObject: bestByObject,
			partHeightAudit
		});
	}

	rows.sort((a, b) => a.historicalCode.localeCompare(b.historicalCode));
	const best = rows.flatMap(
		(item) => item.bestOverlapByHistoricalObject.filter(Boolean)
	);
	const absEaveDiffs = best
		.map((item) => Math.abs(Number(item.eaveDifferenceM)))
		.filter(Number.isFinite)
		.sort((a, b) => a - b);
	const within = (limit) => absEaveDiffs.filter(
		(value) => value <= limit
	).length;
	const significantParts = rows
		.flatMap((item) => (item.partHeightAudit || []).map((part) => ({
			historicalCode: item.historicalCode,
			knownManualProduction: item.knownManualProduction,
			...part
		})))
		.filter((part) => (
			Number(part.historicalCoverage) >= 0.50
			&& Number.isFinite(Number(part.eaveDifferenceP50M))
		));
	const partAbsDiffs = significantParts
		.map((part) => Math.abs(Number(part.eaveDifferenceP50M)))
		.sort((a, b) => a - b);
	const partWithin = (limit) => partAbsDiffs.filter(
		(value) => value <= limit
	).length;

	const output = {
		generatedAt: new Date().toISOString(),
		targets: rows.length,
		knownManualProduction: rows.filter(
			(item) => item.knownManualProduction
		).map((item) => item.historicalCode),
		bestOverlapObjects: best.length,
		bestOverlapEaveDifference: {
			maxAbsM: round(
				absEaveDiffs.length
					? absEaveDiffs[absEaveDiffs.length - 1]
					: null
			),
			within1m: within(1),
			within2m: within(2),
			within3m: within(3)
		},
		localizedPartEaveDifferenceP50: {
			significantParts: significantParts.length,
			maxAbsM: round(
				partAbsDiffs.length
					? partAbsDiffs[partAbsDiffs.length - 1]
					: null
			),
			within1m: partWithin(1),
			within2m: partWithin(2),
			within3m: partWithin(3)
		},
		rows
	};
	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(
		args.output,
		JSON.stringify(output, null, "\t") + "\n",
		"utf8"
	);
	console.log(JSON.stringify({
		targets: output.targets,
		knownManualProduction: output.knownManualProduction,
		bestOverlapObjects: output.bestOverlapObjects,
		bestOverlapEaveDifference: output.bestOverlapEaveDifference,
		localizedPartEaveDifferenceP50:
			output.localizedPartEaveDifferenceP50
	}, null, 2));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
