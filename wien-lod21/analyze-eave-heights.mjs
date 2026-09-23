#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";

const GML_NS = "http://www.opengis.net/gml";
const BLDG_NS = "http://www.opengis.net/citygml/building/1.0";

function parseArgs(argv) {
	const result = {
		report: "",
		source: "",
		output: ""
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--report") {
			result.report = path.resolve(argv[++index]);
		} else if (arg === "--source") {
			result.source = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.report || !result.source || !result.output) {
		throw new Error("--report, --source and --output are required.");
	}
	return result;
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

function directChildByName(node, name) {
	return elementChildren(node).find((child) => localName(child) === name) || null;
}

function descendantByName(node, namespace, name) {
	return node?.getElementsByTagNameNS?.(namespace, name)?.[0] || null;
}

function textContent(node) {
	return String(node?.textContent || "").trim();
}

function openRing(points) {
	const result = [];
	for (const point of points || []) {
		if (
			!result.length
			|| result[result.length - 1][0] !== point[0]
			|| result[result.length - 1][1] !== point[1]
			|| result[result.length - 1][2] !== point[2]
		) {
			result.push(point);
		}
	}
	if (
		result.length > 1
		&& result[0][0] === result[result.length - 1][0]
		&& result[0][1] === result[result.length - 1][1]
		&& result[0][2] === result[result.length - 1][2]
	) {
		result.pop();
	}
	return result;
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
		return openRing(points);
	}
	const positions = linearRing.getElementsByTagNameNS(GML_NS, "pos") || [];
	const points = [];
	for (let index = 0; index < positions.length; index += 1) {
		const values = textContent(positions[index])
			.split(/\s+/)
			.map(Number)
			.filter(Number.isFinite);
		if (values.length >= 3) points.push([values[0], values[1], values[2]]);
	}
	return openRing(points);
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
		case "GroundSurface":
			return "ground";
		case "WallSurface":
			return "wall";
		default:
			return "other";
	}
}

function parseBuildingSurfaces(building) {
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

function buildingName(building) {
	const direct = directChildByName(building, "name");
	if (direct) return textContent(direct);
	return textContent(descendantByName(building, GML_NS, "name"));
}

function buildingRoofType(building) {
	return textContent(descendantByName(building, BLDG_NS, "roofType"));
}

function median(values) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values, q) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = (sorted.length - 1) * q;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower];
	const fraction = index - lower;
	return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

function modeQuantized(values, step = 0.1) {
	if (!values.length) return null;
	const counts = new Map();
	for (const value of values) {
		const rounded = Math.round(value / step) * step;
		const key = rounded.toFixed(3);
		counts.set(key, (counts.get(key) || 0) + 1);
	}
	let bestValue = null;
	let bestCount = -1;
	for (const [key, count] of counts) {
		const value = Number(key);
		if (
			count > bestCount
			|| (count === bestCount && (bestValue === null || value < bestValue))
		) {
			bestValue = value;
			bestCount = count;
		}
	}
	return bestValue;
}

function objectHeightMetrics(surfaces) {
	const groundPoints = surfaces
		.filter((surface) => surface.semantic === "ground")
		.flatMap((surface) => surface.rings.flat());
	const roofSurfaces = surfaces.filter((surface) => surface.semantic === "roof");
	const roofPoints = roofSurfaces.flatMap((surface) => surface.rings.flat());
	const wallPoints = surfaces
		.filter((surface) => surface.semantic === "wall")
		.flatMap((surface) => surface.rings.flat());
	if (!groundPoints.length || !roofPoints.length) return null;

	const groundZ = groundPoints.map((point) => Number(point[2])).filter(Number.isFinite);
	const roofZ = roofPoints.map((point) => Number(point[2])).filter(Number.isFinite);
	if (!groundZ.length || !roofZ.length) return null;

	const baseZ = Math.min(...groundZ);
	const peakZ = Math.max(...roofZ);
	const minRoofZ = Math.min(...roofZ);
	const surfaceMinZ = roofSurfaces
		.map((surface) => {
			const values = surface.rings
				.flat()
				.map((point) => Number(point[2]))
				.filter(Number.isFinite);
			return values.length ? Math.min(...values) : null;
		})
		.filter(Number.isFinite);

	const wallUpperZ = wallPoints
		.map((point) => Number(point[2]))
		.filter((z) => Number.isFinite(z) && z > baseZ + 1);

	return {
		baseZ,
		peakZ,
		minRoofZ,
		peakHeightM: peakZ - baseZ,
		minRoofHeightM: minRoofZ - baseZ,
		roofRiseM: peakZ - minRoofZ,
		surfaceMinMedianHeightM: surfaceMinZ.length
			? median(surfaceMinZ) - baseZ
			: null,
		roofVertexP10HeightM: quantile(roofZ, 0.10) - baseZ,
		roofVertexModeHeightM: modeQuantized(roofZ, 0.1) - baseZ,
		wallUpperModeHeightM: wallUpperZ.length
			? modeQuantized(wallUpperZ, 0.1) - baseZ
			: null,
		roofSurfaces: roofSurfaces.length,
		roofVertices: roofZ.length
	};
}

async function listFilesRecursive(root) {
	const result = [];
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...await listFilesRecursive(full));
		} else if (entry.isFile() && /\.gml$/i.test(entry.name)) {
			result.push(full);
		}
	}
	return result.sort();
}

function heightTolerance(currentHeightM) {
	return Number.isFinite(currentHeightM)
		? Math.max(6, currentHeightM * 0.30)
		: 6;
}

function summarizeEstimator(rows, key) {
	const usable = rows.filter((row) => Number.isFinite(row[key]));
	const differences = usable.map((row) => Math.abs(row.currentHeightM - row[key]));
	const passed = usable.filter((row) => (
		Math.abs(row.currentHeightM - row[key]) <= row.productionToleranceM
	));
	return {
		usable: usable.length,
		passed: passed.length,
		failed: usable.length - passed.length,
		medianDifferenceM: differences.length
			? Number(median(differences).toFixed(3))
			: null,
		maxDifferenceM: differences.length
			? Number(Math.max(...differences).toFixed(3))
			: null
	};
}

async function main() {
	const args = parseArgs(process.argv);
	const report = JSON.parse(await fs.readFile(args.report, "utf8"));
	const candidates = (report.hybridCandidates || []).filter((candidate) => {
		const metrics = candidate.metrics || {};
		const currentHeightM = metrics.currentHeightM === null
			? null
			: Number(metrics.currentHeightM);
		const heightDifferenceM = metrics.heightDifferenceM === null
			? null
			: Number(metrics.heightDifferenceM);
		if (!Number.isFinite(heightDifferenceM)) return false;
		return heightDifferenceM > heightTolerance(currentHeightM);
	});

	if (candidates.length !== 29) {
		throw new Error("Expected 29 height-deferred candidates, got " + candidates.length);
	}
	const wanted = new Set(candidates.map((candidate) => String(candidate.historicalCode)));
	const grouped = new Map();

	for (const file of await listFilesRecursive(args.source)) {
		const xml = await fs.readFile(file, "utf8");
		const document = new DOMParser({
			errorHandler: {
				warning: () => {},
				error: () => {},
				fatalError: (message) => {
					throw new Error("CityGML parse error: " + message);
				}
			}
		}).parseFromString(xml, "application/xml");
		const buildings = document.getElementsByTagNameNS(BLDG_NS, "Building");
		for (let index = 0; index < buildings.length; index += 1) {
			const building = buildings[index];
			const code = buildingName(building);
			if (!wanted.has(code)) continue;
			const surfaces = parseBuildingSurfaces(building);
			const metrics = objectHeightMetrics(surfaces);
			if (!metrics) continue;
			let group = grouped.get(code);
			if (!group) {
				group = {
					code,
					objects: []
				};
				grouped.set(code, group);
			}
			group.objects.push({
				...metrics,
				roofType: buildingRoofType(building)
			});
		}
	}

	const rows = candidates.map((candidate) => {
		const code = String(candidate.historicalCode);
		const group = grouped.get(code);
		const objects = group?.objects || [];
		const currentHeightM = Number(candidate.metrics?.currentHeightM);
		const maxMetric = (key) => {
			const values = objects.map((object) => object[key]).filter(Number.isFinite);
			return values.length ? Math.max(...values) : null;
		};
		const row = {
			historicalCode: code,
			sheet: String(candidate.sheet || candidate.lod21Sheet),
			currentHeightM,
			productionToleranceM: heightTolerance(currentHeightM),
			reportedPeakHeightM: Number(candidate.metrics?.oldHeightM),
			reportedPeakDifferenceM: Number(candidate.metrics?.heightDifferenceM),
			oldCoverage: Number(candidate.metrics?.oldCoverage),
			currentCoverage: Number(candidate.metrics?.currentCoverage),
			centroidDistanceM: Number(candidate.metrics?.centroidDistanceM),
			objectCount: objects.length,
			roofTypes: [...new Set(objects.map((object) => object.roofType).filter(Boolean))],
			peakHeightM: maxMetric("peakHeightM"),
			minRoofHeightM: maxMetric("minRoofHeightM"),
			surfaceMinMedianHeightM: maxMetric("surfaceMinMedianHeightM"),
			roofVertexP10HeightM: maxMetric("roofVertexP10HeightM"),
			roofVertexModeHeightM: maxMetric("roofVertexModeHeightM"),
			wallUpperModeHeightM: maxMetric("wallUpperModeHeightM"),
			maxRoofRiseM: maxMetric("roofRiseM"),
			objects
		};
		for (const key of [
			"peakHeightM",
			"minRoofHeightM",
			"surfaceMinMedianHeightM",
			"roofVertexP10HeightM",
			"roofVertexModeHeightM",
			"wallUpperModeHeightM"
		]) {
			row[key + "DifferenceM"] = Number.isFinite(row[key])
				? Number(Math.abs(currentHeightM - row[key]).toFixed(3))
				: null;
			row[key + "Pass"] = Number.isFinite(row[key])
				? row[key + "DifferenceM"] <= row.productionToleranceM
				: false;
		}
		return row;
	}).sort((a, b) => a.historicalCode.localeCompare(b.historicalCode));

	const estimators = {};
	for (const key of [
		"peakHeightM",
		"minRoofHeightM",
		"surfaceMinMedianHeightM",
		"roofVertexP10HeightM",
		"roofVertexModeHeightM",
		"wallUpperModeHeightM"
	]) {
		estimators[key] = summarizeEstimator(rows, key);
	}

	const output = {
		generatedAt: new Date().toISOString(),
		count: rows.length,
		estimators,
		rows
	};
	await fs.writeFile(args.output, JSON.stringify(output, null, "\t") + "\n");
	console.log(JSON.stringify({
		count: rows.length,
		estimators
	}, null, 2));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
