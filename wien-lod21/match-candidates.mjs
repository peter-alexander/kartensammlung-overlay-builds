#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DOMParser } from "@xmldom/xmldom";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import UnionOp from "jsts/org/locationtech/jts/operation/union/UnionOp.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import Centroid from "jsts/org/locationtech/jts/algorithm/Centroid.js";

const execFileAsync = promisify(execFile);

const GML_NS = "http://www.opengis.net/gml";
const BLDG_NS = "http://www.opengis.net/citygml/building/1.0";
const DOWNLOAD_BASE = "https://www.wien.gv.at/MA41datenviewer/downloads/geodaten/lod2_gml";
const WFS_URL = "https://data.wien.gv.at/daten/geo";
const PILOT_SHEETS = new Set(["104078", "105080"]);
const PILOT_CODES = new Set(["212535", "009238", "113842", "006973"]);
const DEFAULT_MAX_SHEETS = 24;
const SHEET_SIZE_M = 500;
const SPATIAL_SEARCH_M = 40;

function parseArgs(argv) {
	const result = {
		input: "",
		output: "",
		maxSheets: DEFAULT_MAX_SHEETS,
		all: false
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--input") {
			result.input = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else if (arg === "--max-sheets") {
			result.maxSheets = Math.max(1, Number(argv[++index]) || DEFAULT_MAX_SHEETS);
		} else if (arg === "--all") {
			result.all = true;
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.input || !result.output) {
		throw new Error("--input and --output are required.");
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

function closeRing2D(points) {
	const ring = points.map((point) => [point[0], point[1]]);
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
		const ring = parseLinearRing(descendantByName(interiors[index], GML_NS, "LinearRing"));
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

function normalUpFraction(ring) {
	if (!ring || ring.length < 3) return 1;
	let nx = 0;
	let ny = 0;
	let nz = 0;
	for (let index = 0; index < ring.length; index += 1) {
		const current = ring[index];
		const next = ring[(index + 1) % ring.length];
		nx += (current[1] - next[1]) * (current[2] + next[2]);
		ny += (current[2] - next[2]) * (current[0] + next[0]);
		nz += (current[0] - next[0]) * (current[1] + next[1]);
	}
	const length = Math.hypot(nx, ny, nz);
	return length > 1e-9 ? Math.abs(nz) / length : 1;
}

function sheetBounds(sheet) {
	const value = String(sheet);
	if (!/^\d{6}$/.test(value)) throw new Error("Invalid LOD2.1 sheet: " + value);
	const column = Number(value.slice(0, 3));
	const row = Number(value.slice(3));
	const minX = (column - 100) * SHEET_SIZE_M;
	const minY = 300_000 + row * SHEET_SIZE_M;
	return {
		minX,
		minY,
		maxX: minX + SHEET_SIZE_M,
		maxY: minY + SHEET_SIZE_M
	};
}

function selectSheets(allSheets, maxSheets, all) {
	const sorted = [...new Set(allSheets.map(String))].sort();
	if (all || sorted.length <= maxSheets) return sorted;

	const selected = new Set(
		sorted.filter((sheet) => PILOT_SHEETS.has(sheet))
	);
	const remaining = Math.max(0, maxSheets - selected.size);
	if (remaining > 0) {
		for (let index = 0; index < remaining; index += 1) {
			const position = remaining === 1
				? Math.floor((sorted.length - 1) / 2)
				: Math.round(index * (sorted.length - 1) / (remaining - 1));
			selected.add(sorted[position]);
		}
	}
	return [...selected].sort();
}

async function fetchWithRetry(url, options = {}, attempts = 5) {
	let lastError = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 90_000);
		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
				headers: {
					"User-Agent": "kartensammlung-overlay-builds/wien-lod21-matcher",
					...(options.headers || {})
				}
			});
			if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
			return response;
		} catch (error) {
			lastError = error;
			if (attempt >= attempts) break;
			await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
		} finally {
			clearTimeout(timer);
		}
	}
	throw new Error("Fetch failed after " + attempts + " attempts: " + (lastError?.message || lastError));
}

async function downloadSheet(sheet, root) {
	const zipPath = path.join(root, sheet + ".zip");
	const extractDir = path.join(root, sheet);
	await fs.mkdir(extractDir, { recursive: true });
	const response = await fetchWithRetry(DOWNLOAD_BASE + "/" + sheet + "_lod2_gml.zip");
	const buffer = Buffer.from(await response.arrayBuffer());
	await fs.writeFile(zipPath, buffer);
	await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", extractDir]);
	const entries = await fs.readdir(extractDir, { recursive: true });
	const gmlName = entries.find((entry) => /\.gml$/i.test(String(entry)));
	if (!gmlName) throw new Error("No GML in LOD2.1 sheet " + sheet);
	return {
		path: path.join(extractDir, String(gmlName)),
		zipBytes: buffer.length
	};
}

function chunks(values, size = 20) {
	const result = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

async function fetchCurrentFeaturesByCql(cql) {
	const url = new URL(WFS_URL);
	url.searchParams.set("service", "WFS");
	url.searchParams.set("request", "GetFeature");
	url.searchParams.set("version", "1.1.0");
	url.searchParams.set("typeName", "ogdwien:FMZKBKMOGD");
	url.searchParams.set("outputFormat", "json");
	url.searchParams.set("srsName", "EPSG:31256");
	url.searchParams.set("CQL_FILTER", cql);
	const response = await fetchWithRetry(url.toString(), {
		headers: { accept: "application/json" }
	});
	const text = await response.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error(
			"Unexpected WFS response for CQL " + cql + ": "
			+ text.slice(0, 240).replace(/\s+/g, " ")
		);
	}
	if (!Array.isArray(json?.features)) {
		throw new Error("Unexpected WFS FeatureCollection for CQL: " + cql);
	}
	return json.features;
}

async function fetchCurrentCandidateFeatures(codeCandidates, spatialCandidates) {
	const codes = [...new Set(
		(codeCandidates || [])
			.map((candidate) => String(candidate.historicalCode || "").trim())
			.filter((code) => /^\d{6}$/.test(code))
	)].sort();
	const buildingIds = [...new Set(
		(spatialCandidates || [])
			.map((candidate) => String(candidate.BW_GEB_ID || "").trim())
			.filter((id) => /^\d+$/.test(id))
	)].sort();

	const requests = [];
	for (const batch of chunks(codes)) {
		requests.push(fetchCurrentFeaturesByCql(
			"F_KLASSE=11 AND BEZUG IN ("
			+ batch.map((code) => "'" + code + "'").join(",")
			+ ")"
		));
	}
	for (const batch of chunks(buildingIds)) {
		requests.push(fetchCurrentFeaturesByCql(
			"F_KLASSE=11 AND BW_GEB_ID IN (" + batch.join(",") + ")"
		));
	}
	if (!requests.length) return [];

	const groups = await Promise.all(requests);
	const unique = new Map();
	for (const feature of groups.flat()) {
		const key = String(
			feature?.id
			?? feature?.properties?.SE_SDO_ROWID
			?? feature?.properties?.FMZK_ID
			?? ""
		);
		if (!key) continue;
		unique.set(key, feature);
	}
	return [...unique.values()];
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
	for (const geometry of geometries) {
		if (!geometry || geometry.isEmpty()) continue;
		const repaired = repairGeometry(geometry);
		if (!repaired || repaired.isEmpty()) continue;
		try {
			result = result ? UnionOp.union(result, repaired) : repaired;
		} catch {
			const repairedResult = repairGeometry(result);
			result = repairedResult ? UnionOp.union(repairedResult, repaired) : repaired;
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
			return OverlayOp.overlayOp(repairedA, repairedB, OverlayOp.INTERSECTION);
		} catch {
			return null;
		}
	}
}

function geometryMetrics(currentGeometry, oldGeometry, currentHeight, oldHeight) {
	const currentArea = Number(currentGeometry?.getArea?.() || 0);
	const oldArea = Number(oldGeometry?.getArea?.() || 0);
	if (!(currentArea > 0) || !(oldArea > 0)) return null;
	const intersection = safeIntersection(currentGeometry, oldGeometry);
	const intersectionArea = Number(intersection?.getArea?.() || 0);
	const unionArea = currentArea + oldArea - intersectionArea;
	const currentCoverage = intersectionArea / currentArea;
	const oldCoverage = intersectionArea / oldArea;
	const iou = unionArea > 0 ? intersectionArea / unionArea : 0;
	const currentCentroid = Centroid.getCentroid(currentGeometry);
	const oldCentroid = Centroid.getCentroid(oldGeometry);
	const centroidDistance = Math.hypot(
		currentCentroid.x - oldCentroid.x,
		currentCentroid.y - oldCentroid.y
	);
	const heightDifference = (
		Number.isFinite(currentHeight)
		&& Number.isFinite(oldHeight)
	)
		? Math.abs(currentHeight - oldHeight)
		: null;
	const heightTolerance = Number.isFinite(currentHeight)
		? Math.max(5, currentHeight * 0.35)
		: null;
	return {
		currentArea: Number(currentArea.toFixed(2)),
		oldArea: Number(oldArea.toFixed(2)),
		intersectionArea: Number(intersectionArea.toFixed(2)),
		iou: Number(iou.toFixed(4)),
		currentCoverage: Number(currentCoverage.toFixed(4)),
		oldCoverage: Number(oldCoverage.toFixed(4)),
		centroidDistanceM: Number(centroidDistance.toFixed(2)),
		currentHeightM: Number.isFinite(currentHeight) ? Number(currentHeight.toFixed(2)) : null,
		oldHeightM: Number.isFinite(oldHeight) ? Number(oldHeight.toFixed(2)) : null,
		heightDifferenceM: Number.isFinite(heightDifference) ? Number(heightDifference.toFixed(2)) : null,
		heightToleranceM: Number.isFinite(heightTolerance) ? Number(heightTolerance.toFixed(2)) : null
	};
}

function provisionalBand(metrics, method) {
	if (!metrics) return "reject";
	const heightOk = (
		metrics.heightDifferenceM === null
		|| metrics.heightToleranceM === null
		|| metrics.heightDifferenceM <= metrics.heightToleranceM
	);
	if (method === "historical-code") {
		if (
			metrics.iou >= 0.72
			&& metrics.currentCoverage >= 0.82
			&& metrics.oldCoverage >= 0.72
			&& metrics.centroidDistanceM <= 8
			&& heightOk
		) return "strong";
		if (
			metrics.iou >= 0.45
			&& metrics.currentCoverage >= 0.60
			&& metrics.centroidDistanceM <= 15
		) return "plausible";
		return "reject";
	}
	if (
		metrics.iou >= 0.88
		&& metrics.currentCoverage >= 0.92
		&& metrics.oldCoverage >= 0.90
		&& metrics.centroidDistanceM <= 3
		&& heightOk
	) return "strong";
	if (
		metrics.iou >= 0.70
		&& metrics.currentCoverage >= 0.80
		&& metrics.oldCoverage >= 0.80
		&& metrics.centroidDistanceM <= 6
	) return "plausible";
	return "reject";
}

function oldFootprintGeoJson(surfaces) {
	const polygons = surfaces
		.filter((surface) => surface.semantic === "ground")
		.map((surface) => surface.rings)
		.filter((rings) => rings.length)
		.map((rings) => rings.map(closeRing2D));
	if (!polygons.length) return null;
	return polygons.length === 1
		? { type: "Polygon", coordinates: polygons[0] }
		: { type: "MultiPolygon", coordinates: polygons };
}

function parseOldBuildingRecords(xml, reader) {
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
	const byCode = new Map();

	for (let index = 0; index < buildings.length; index += 1) {
		const building = buildings[index];
		const code = buildingName(building);
		if (!code) continue;
		const surfaces = parseBuildingSurfaces(building);
		const footprint = oldFootprintGeoJson(surfaces);
		if (!footprint) continue;
		let geometry;
		try {
			geometry = repairGeometry(reader.read(footprint));
		} catch {
			continue;
		}
		if (!geometry || geometry.isEmpty()) continue;

		const groundPoints = surfaces
			.filter((surface) => surface.semantic === "ground")
			.flatMap((surface) => surface.rings.flat());
		const roofPoints = surfaces
			.filter((surface) => surface.semantic === "roof")
			.flatMap((surface) => surface.rings.flat());
		const allPoints = surfaces.flatMap((surface) => surface.rings.flat());
		const groundZ = (
			groundPoints.length ? groundPoints : allPoints
		).map((point) => point[2]).filter(Number.isFinite);
		const roofZ = (
			roofPoints.length ? roofPoints : allPoints
		).map((point) => point[2]).filter(Number.isFinite);
		const oldHeight = groundZ.length && roofZ.length
			? Math.max(...roofZ) - Math.min(...groundZ)
			: null;
		const roofSurfaces = surfaces.filter((surface) => surface.semantic === "roof");
		const pitchedRoofSurfaces = roofSurfaces.filter((surface) => (
			normalUpFraction(surface.rings[0]) < 0.985
		)).length;

		let group = byCode.get(code);
		if (!group) {
			group = {
				code,
				geometries: [],
				heights: [],
				roofTypes: new Set(),
				roofSurfaces: 0,
				pitchedRoofSurfaces: 0,
				objectCount: 0
			};
			byCode.set(code, group);
		}
		group.geometries.push(geometry);
		if (Number.isFinite(oldHeight)) group.heights.push(oldHeight);
		const roofType = buildingRoofType(building);
		if (roofType) group.roofTypes.add(roofType);
		group.roofSurfaces += roofSurfaces.length;
		group.pitchedRoofSurfaces += pitchedRoofSurfaces;
		group.objectCount += 1;
	}

	for (const group of byCode.values()) {
		group.geometry = unionGeometries(group.geometries);
		group.height = group.heights.length ? Math.max(...group.heights) : null;
		group.centroid = group.geometry ? Centroid.getCentroid(group.geometry) : null;
	}
	return byCode;
}

function currentFeatureHeight(feature) {
	const properties = feature?.properties || {};
	const top = Number(properties.O_KOTE);
	const base = Number(properties.T_KOTE ?? properties.HOEHE_DGM);
	return Number.isFinite(top) && Number.isFinite(base)
		? Math.max(0, top - base)
		: null;
}

function addCurrentFeatureToGroup(map, key, feature, geometry) {
	if (!key) return;
	let group = map.get(key);
	if (!group) {
		group = { geometries: [], features: [], heights: [] };
		map.set(key, group);
	}
	group.geometries.push(geometry);
	group.features.push(feature);
	const height = currentFeatureHeight(feature);
	if (Number.isFinite(height)) group.heights.push(height);
}

function finalizeCurrentGroups(map) {
	for (const group of map.values()) {
		group.geometry = unionGeometries(group.geometries);
		group.height = group.heights.length ? Math.max(...group.heights) : null;
		group.ksIds = [...new Set(
			group.features
				.map((feature) => String(feature?.properties?.FMZK_ID ?? "").trim())
				.filter(Boolean)
				.map((id) => "wien-fmzk:" + id)
		)].sort();
		group.ownerBwGebIds = [...new Set(
			group.features
				.map((feature) => String(feature?.properties?.BW_GEB_ID ?? "").trim())
				.filter(Boolean)
		)].sort();
	}
}

function groupCurrentFeatures(features, reader) {
	const byHistoricalCode = new Map();
	const byBuildingId = new Map();
	for (const feature of features) {
		if (!feature?.geometry) continue;
		let geometry;
		try {
			geometry = repairGeometry(reader.read(feature.geometry));
		} catch {
			continue;
		}
		if (!geometry || geometry.isEmpty()) continue;

		const historicalCode = String(feature?.properties?.BEZUG ?? "").trim();
		if (/^\d{6}$/.test(historicalCode)) {
			addCurrentFeatureToGroup(byHistoricalCode, historicalCode, feature, geometry);
		}
		const buildingId = String(feature?.properties?.BW_GEB_ID ?? "").trim();
		if (buildingId) {
			addCurrentFeatureToGroup(byBuildingId, buildingId, feature, geometry);
		}
	}
	finalizeCurrentGroups(byHistoricalCode);
	finalizeCurrentGroups(byBuildingId);
	return { byHistoricalCode, byBuildingId };
}

function combineOldGroups(groups) {
	const present = groups.filter((group) => group?.geometry && !group.geometry.isEmpty());
	if (!present.length) return null;
	return {
		code: present.map((group) => group.code).sort().join("+"),
		geometry: unionGeometries(present.map((group) => group.geometry)),
		height: present.map((group) => group.height).filter(Number.isFinite).reduce(
			(max, value) => Math.max(max, value),
			-Infinity
		),
		roofTypes: [...new Set(present.flatMap((group) => [...group.roofTypes]))].sort(),
		roofSurfaces: present.reduce((sum, group) => sum + group.roofSurfaces, 0),
		pitchedRoofSurfaces: present.reduce((sum, group) => sum + group.pitchedRoofSurfaces, 0),
		objectCount: present.reduce((sum, group) => sum + group.objectCount, 0)
	};
}

function findBestSpatialMatch(currentGeometry, oldByCode, currentHeight) {
	const centroid = Centroid.getCentroid(currentGeometry);
	let best = null;
	for (const old of oldByCode.values()) {
		if (!old?.geometry || !old.centroid) continue;
		const distance = Math.hypot(centroid.x - old.centroid.x, centroid.y - old.centroid.y);
		if (distance > SPATIAL_SEARCH_M) continue;
		const metrics = geometryMetrics(currentGeometry, old.geometry, currentHeight, old.height);
		if (!metrics) continue;
		const score = metrics.iou * 4
			+ metrics.currentCoverage * 2
			+ metrics.oldCoverage
			- Math.min(1, metrics.centroidDistanceM / SPATIAL_SEARCH_M);
		if (!best || score > best.score) {
			best = { old, metrics, score };
		}
	}
	return best;
}

function quantiles(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return null;
	const at = (q) => {
		const position = (sorted.length - 1) * q;
		const low = Math.floor(position);
		const high = Math.ceil(position);
		const weight = position - low;
		return sorted[low] * (1 - weight) + sorted[high] * weight;
	};
	return {
		min: Number(sorted[0].toFixed(4)),
		p10: Number(at(0.10).toFixed(4)),
		p25: Number(at(0.25).toFixed(4)),
		median: Number(at(0.50).toFixed(4)),
		p75: Number(at(0.75).toFixed(4)),
		p90: Number(at(0.90).toFixed(4)),
		max: Number(sorted[sorted.length - 1].toFixed(4))
	};
}

function matchResultPayload({
	candidate,
	sheet,
	method,
	old,
	current,
	metrics
}) {
	const band = provisionalBand(metrics, method);
	return {
		...candidate,
		sheet,
		method,
		matchedHistoricalCodes: old?.code ? old.code.split("+") : [],
		band,
		reason: band === "reject" ? "plausibility-threshold" : "",
		current: {
			ksIds: current?.ksIds || [],
			ownerBwGebIds: current?.ownerBwGebIds || []
		},
		metrics,
		lod21: {
			objectCount: old?.objectCount || 0,
			roofTypes: old?.roofTypes || [],
			roofSurfaces: old?.roofSurfaces || 0,
			pitchedRoofSurfaces: old?.pitchedRoofSurfaces || 0,
			hasPitchedRoof: (old?.pitchedRoofSurfaces || 0) > 0
		}
	};
}

async function processSheet(
	sheet,
	codeCandidates,
	spatialCandidates,
	tmpRoot,
	reader
) {
	const downloaded = await downloadSheet(sheet, tmpRoot);
	const [xml, currentFeatures] = await Promise.all([
		fs.readFile(downloaded.path, "utf8"),
		fetchCurrentCandidateFeatures(codeCandidates, spatialCandidates)
	]);
	const oldByCode = parseOldBuildingRecords(xml, reader);
	const currentGroups = groupCurrentFeatures(currentFeatures, reader);
	const results = [];

	for (const candidate of codeCandidates) {
		const code = String(candidate.historicalCode || "");
		const current = currentGroups.byHistoricalCode.get(code);
		if (!current?.geometry) {
			results.push({
				...candidate,
				sheet,
				candidateType: "historical-code",
				band: "reject",
				reason: "current-wfs-code-not-found"
			});
			continue;
		}

		const exact = oldByCode.get(code);
		if (exact?.geometry) {
			const metrics = geometryMetrics(
				current.geometry,
				exact.geometry,
				current.height,
				exact.height
			);
			if (metrics) {
				results.push(matchResultPayload({
					candidate: {
						...candidate,
						candidateType: "historical-code"
					},
					sheet,
					method: "historical-code",
					old: exact,
					current,
					metrics
				}));
				continue;
			}
		}

		// Ein historischer Code kann in der alten Kachel fehlen (z.B. Blatt-
		// Zuordnung an einer 500-m-Grenze). Dann darf nur ein geometrisch sehr
		// guter Treffer als raeumlicher Fallback weiter betrachtet werden.
		const spatial = findBestSpatialMatch(
			current.geometry,
			oldByCode,
			current.height
		);
		if (spatial) {
			results.push(matchResultPayload({
				candidate: {
					...candidate,
					candidateType: "historical-code"
				},
				sheet,
				method: "spatial",
				old: spatial.old,
				current,
				metrics: spatial.metrics
			}));
			continue;
		}

		results.push({
			...candidate,
			sheet,
			candidateType: "historical-code",
			band: "reject",
			reason: exact ? "geometry-metrics-unavailable" : "no-lod21-match"
		});
	}

	for (const candidate of spatialCandidates) {
		const current = currentGroups.byBuildingId.get(String(candidate.BW_GEB_ID));
		if (!current?.geometry) {
			results.push({
				...candidate,
				sheet,
				candidateType: "spatial",
				band: "reject",
				reason: "current-wfs-building-not-found"
			});
			continue;
		}
		const spatial = findBestSpatialMatch(
			current.geometry,
			oldByCode,
			current.height
		);
		if (!spatial) {
			results.push({
				...candidate,
				sheet,
				candidateType: "spatial",
				band: "reject",
				reason: "no-lod21-match"
			});
			continue;
		}
		results.push(matchResultPayload({
			candidate: {
				...candidate,
				candidateType: "spatial"
			},
			sheet,
			method: "spatial",
			old: spatial.old,
			current,
			metrics: spatial.metrics
		}));
	}

	return {
		sheet,
		zipBytes: downloaded.zipBytes,
		codeCandidateCount: codeCandidates.length,
		spatialCandidateCount: spatialCandidates.length,
		oldCodeGroups: oldByCode.size,
		currentClass11Features: currentFeatures.length,
		results
	};
}

async function main() {
	const args = parseArgs(process.argv);
	const report = JSON.parse(await fs.readFile(args.input, "utf8"));
	const codeCandidates = Array.isArray(report?.lod21CodeCandidates)
		? report.lod21CodeCandidates
		: [];
	const spatialCandidates = Array.isArray(report?.lod21SpatialCandidates)
		? report.lod21SpatialCandidates
		: [];
	if (!codeCandidates.length && !spatialCandidates.length) {
		throw new Error("Gap report contains no LOD2.1 candidates.");
	}

	const selectedSheets = selectSheets(
		report.candidateSheets || [
			...codeCandidates.flatMap((candidate) => candidate.lod21Sheets || [candidate.lod21Sheet]),
			...spatialCandidates.map((candidate) => candidate.lod21Sheet)
		],
		args.maxSheets,
		args.all
	);
	const selectedSet = new Set(selectedSheets);
	const codeCandidatesBySheet = new Map();
	const spatialCandidatesBySheet = new Map();

	for (const candidate of codeCandidates) {
		const sheets = Array.isArray(candidate.lod21Sheets) && candidate.lod21Sheets.length
			? candidate.lod21Sheets
			: [candidate.lod21Sheet];
		for (const rawSheet of sheets) {
			const sheet = String(rawSheet || "");
			if (!selectedSet.has(sheet)) continue;
			if (!codeCandidatesBySheet.has(sheet)) codeCandidatesBySheet.set(sheet, []);
			codeCandidatesBySheet.get(sheet).push(candidate);
		}
	}
	for (const candidate of spatialCandidates) {
		const sheet = String(candidate.lod21Sheet || "");
		if (!selectedSet.has(sheet)) continue;
		if (!spatialCandidatesBySheet.has(sheet)) spatialCandidatesBySheet.set(sheet, []);
		spatialCandidatesBySheet.get(sheet).push(candidate);
	}

	const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wien-lod21-match-"));
	const reader = new GeoJSONReader();
	const sheetReports = [];
	try {
		for (let index = 0; index < selectedSheets.length; index += 1) {
			const sheet = selectedSheets[index];
			const codeForSheet = codeCandidatesBySheet.get(sheet) || [];
			const spatialForSheet = spatialCandidatesBySheet.get(sheet) || [];
			console.log(
				"[" + (index + 1) + "/" + selectedSheets.length + "] "
				+ sheet + " – "
				+ codeForSheet.length + " code + "
				+ spatialForSheet.length + " spatial candidates"
			);
			sheetReports.push(await processSheet(
				sheet,
				codeForSheet,
				spatialForSheet,
				tmpRoot,
				reader
			));
		}
	} finally {
		await fs.rm(tmpRoot, { recursive: true, force: true });
	}

	const rawResults = sheetReports.flatMap((sheet) => sheet.results);

	// Derselbe historische Code kann an einer Blattgrenze in mehreren
	// ausgewaehlten Blaettern geprueft werden. Behalte pro Kandidat den besten
	// Treffer, statt ihn mehrfach in die Statistik zu zaehlen.
	const bandRank = { strong: 3, plausible: 2, reject: 1 };
	const methodRank = { "historical-code": 2, spatial: 1 };
	const resultKey = (item) => item.candidateType === "historical-code"
		? "code:" + item.historicalCode
		: "spatial:" + item.BW_GEB_ID;
	const bestByCandidate = new Map();
	for (const item of rawResults) {
		const key = resultKey(item);
		const previous = bestByCandidate.get(key);
		const itemScore = (bandRank[item.band] || 0) * 100
			+ (methodRank[item.method] || 0) * 10
			+ Number(item.metrics?.iou || 0);
		const previousScore = previous
			? (bandRank[previous.band] || 0) * 100
				+ (methodRank[previous.method] || 0) * 10
				+ Number(previous.metrics?.iou || 0)
			: -Infinity;
		if (!previous || itemScore > previousScore) bestByCandidate.set(key, item);
	}
	const results = [...bestByCandidate.values()];

	const counts = {
		sheets: selectedSheets.length,
		candidates: results.length,
		codeCandidates: results.filter((item) => item.candidateType === "historical-code").length,
		spatialCandidates: results.filter((item) => item.candidateType === "spatial").length,
		historicalCodeMatches: results.filter((item) => item.method === "historical-code").length,
		spatialMatches: results.filter((item) => item.method === "spatial").length,
		strong: results.filter((item) => item.band === "strong").length,
		plausible: results.filter((item) => item.band === "plausible").length,
		reject: results.filter((item) => item.band === "reject").length,
		strongWithPitchedRoof: results.filter(
			(item) => item.band === "strong" && item.lod21?.hasPitchedRoof
		).length,
		downloadBytes: sheetReports.reduce((sum, sheet) => sum + sheet.zipBytes, 0)
	};

	const exactMatches = results.filter(
		(item) => item.method === "historical-code" && item.metrics
	);
	const metricDistribution = {
		iou: quantiles(exactMatches.map((item) => item.metrics.iou)),
		currentCoverage: quantiles(exactMatches.map((item) => item.metrics.currentCoverage)),
		oldCoverage: quantiles(exactMatches.map((item) => item.metrics.oldCoverage)),
		centroidDistanceM: quantiles(exactMatches.map((item) => item.metrics.centroidDistanceM)),
		heightDifferenceM: quantiles(exactMatches.map((item) => item.metrics.heightDifferenceM))
	};

	const pilot = results.filter((item) => (
		item.candidateType === "historical-code"
		&& PILOT_CODES.has(String(item.historicalCode || ""))
	));
	const output = {
		generatedAt: new Date().toISOString(),
		inputGeneratedAt: report.generatedAt || null,
		mode: args.all ? "all" : "sample",
		selectedSheets,
		provisionalThresholds: {
			note: "Exploratory confidence bands only; inspect distributions before production acceptance.",
			historicalCode: {
				strong: "IoU>=0.72, currentCoverage>=0.82, oldCoverage>=0.72, centroid<=8m, height within max(5m,35%)",
				plausible: "IoU>=0.45, currentCoverage>=0.60, centroid<=15m"
			},
			spatial: {
				strong: "IoU>=0.88, currentCoverage>=0.92, oldCoverage>=0.90, centroid<=3m, height within max(5m,35%)",
				plausible: "IoU>=0.70, both coverages>=0.80, centroid<=6m"
			}
		},
		counts,
		metricDistribution,
		pilot,
		sheets: sheetReports.map((sheet) => ({
			sheet: sheet.sheet,
			zipBytes: sheet.zipBytes,
			codeCandidateCount: sheet.codeCandidateCount,
			spatialCandidateCount: sheet.spatialCandidateCount,
			oldCodeGroups: sheet.oldCodeGroups,
			currentClass11Features: sheet.currentClass11Features
		})),
		results
	};

	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(args.output, JSON.stringify(output, null, "\t") + "\n", "utf8");

	console.log("");
	console.log("SUMMARY");
	console.log(JSON.stringify(counts, null, 2));
	console.log("");
	console.log("HISTORICAL-CODE METRIC DISTRIBUTION");
	console.log(JSON.stringify(metricDistribution, null, 2));
	console.log("");
	console.log("PILOT");
	for (const item of pilot) {
		console.log(JSON.stringify({
			historicalCode: item.historicalCode,
			ownerBwGebIds: item.ownerBwGebIds,
			method: item.method,
			band: item.band,
			metrics: item.metrics,
			lod21: item.lod21
		}));
	}
	console.log("Wrote " + args.output);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
