#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DOMParser } from "@xmldom/xmldom";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import UnionOp from "jsts/org/locationtech/jts/operation/union/UnionOp.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";

const execFileAsync = promisify(execFile);

const GML_NS = "http://www.opengis.net/gml";
const BLDG_NS = "http://www.opengis.net/citygml/building/1.0";
const WFS_URL = "https://data.wien.gv.at/daten/geo";
const DOWNLOAD_BASE = "https://www.wien.gv.at/MA41datenviewer/downloads/geodaten/lod2_gml";
const PILOT_CODES = new Set(["009238", "113842", "212535"]);
const HISTORICAL_BUFFER_M = 0.25;
const SLIVER_AREA_M2 = 2;

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

function openRing(points) {
	const result = [];
	for (const point of points || []) {
		if (
			!result.length
			|| result[result.length - 1][0] !== point[0]
			|| result[result.length - 1][1] !== point[1]
		) {
			result.push(point);
		}
	}
	if (
		result.length > 1
		&& result[0][0] === result[result.length - 1][0]
		&& result[0][1] === result[result.length - 1][1]
	) {
		result.pop();
	}
	return result;
}

function closeRing(points) {
	const result = points.map((point) => [point[0], point[1]]);
	if (
		result.length
		&& (
			result[0][0] !== result[result.length - 1][0]
			|| result[0][1] !== result[result.length - 1][1]
		)
	) {
		result.push([...result[0]]);
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
			points.push([values[index], values[index + 1]]);
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
		if (values.length >= 2) points.push([values[0], values[1]]);
	}
	return openRing(points);
}

function parseGroundPolygons(building) {
	const polygons = [];
	const boundedBy = building.getElementsByTagNameNS(BLDG_NS, "boundedBy");
	for (let index = 0; index < boundedBy.length; index += 1) {
		const surface = elementChildren(boundedBy[index])[0];
		if (!surface || localName(surface) !== "GroundSurface") continue;
		const polygonNodes = surface.getElementsByTagNameNS(GML_NS, "Polygon");
		for (let polygonIndex = 0; polygonIndex < polygonNodes.length; polygonIndex += 1) {
			const polygon = polygonNodes[polygonIndex];
			const rings = [];
			const exterior = descendantByName(
				descendantByName(polygon, GML_NS, "exterior"),
				GML_NS,
				"LinearRing"
			);
			const outer = parseLinearRing(exterior);
			if (outer.length >= 3) rings.push(closeRing(outer));
			const interiors = polygon.getElementsByTagNameNS(GML_NS, "interior") || [];
			for (let innerIndex = 0; innerIndex < interiors.length; innerIndex += 1) {
				const ring = parseLinearRing(
					descendantByName(interiors[innerIndex], GML_NS, "LinearRing")
				);
				if (ring.length >= 3) rings.push(closeRing(ring));
			}
			if (rings.length) polygons.push(rings);
		}
	}
	return polygons;
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

function safeOverlay(a, b, operation) {
	try {
		return OverlayOp.overlayOp(a, b, operation);
	} catch {
		const repairedA = repairGeometry(a);
		const repairedB = repairGeometry(b);
		if (!repairedA || !repairedB) return null;
		return OverlayOp.overlayOp(repairedA, repairedB, operation);
	}
}

function geometryParts(geometry) {
	if (!geometry || geometry.isEmpty()) return [];
	const count = Number(geometry.getNumGeometries?.() || 1);
	const parts = [];
	for (let index = 0; index < count; index += 1) {
		const part = count === 1 ? geometry : geometry.getGeometryN(index);
		if (!part || part.isEmpty()) continue;
		parts.push(part);
	}
	return parts;
}

function finiteNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function deriveHeight(properties = {}) {
	const roof = finiteNumber(properties.O_KOTE);
	const terrain = finiteNumber(properties.T_KOTE) ?? finiteNumber(properties.HOEHE_DGM);
	if (roof === null || terrain === null) return null;
	return roof - terrain;
}

async function fetchWithRetry(url, attempts = 5) {
	let lastError = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetch(url, {
				headers: {
					accept: "application/json",
					"User-Agent": "kartensammlung-overlay-builds/wien-lod21-hybrid"
				}
			});
			if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
			return response;
		} catch (error) {
			lastError = error;
			if (attempt >= attempts) break;
			await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
		}
	}
	throw lastError;
}

async function fetchCurrentFeatures(ids) {
	const result = [];
	for (let start = 0; start < ids.length; start += 25) {
		const batch = ids.slice(start, start + 25);
		const cql = "FMZK_ID IN ("
			+ batch.map((id) => "'" + id.replaceAll("'", "''") + "'").join(",")
			+ ")";
		const url = new URL(WFS_URL);
		url.searchParams.set("service", "WFS");
		url.searchParams.set("request", "GetFeature");
		url.searchParams.set("version", "1.1.0");
		url.searchParams.set("typeName", "ogdwien:FMZKBKMOGD");
		url.searchParams.set("outputFormat", "json");
		url.searchParams.set("srsName", "EPSG:31256");
		url.searchParams.set("CQL_FILTER", cql);
		const response = await fetchWithRetry(url.toString());
		const json = await response.json();
		if (!Array.isArray(json?.features)) {
			throw new Error("Unexpected Vienna WFS response.");
		}
		result.push(...json.features);
	}
	return result;
}

async function loadHistoricalBuildings(sheet) {
	const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wien-lod21-hybrid-"));
	const zipPath = path.join(tempRoot, sheet + ".zip");
	const extractRoot = path.join(tempRoot, "source");
	try {
		const response = await fetch(
			DOWNLOAD_BASE + "/" + sheet + "_lod2_gml.zip",
			{ headers: { "User-Agent": "kartensammlung-overlay-builds/wien-lod21-hybrid" } }
		);
		if (!response.ok) throw new Error("HTTP " + response.status + " for LOD2.1 sheet " + sheet);
		await fs.writeFile(zipPath, Buffer.from(await response.arrayBuffer()));
		await fs.mkdir(extractRoot, { recursive: true });
		await execFileAsync("unzip", ["-q", zipPath, "-d", extractRoot]);

		const files = [];
		async function visit(directory) {
			for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
				const full = path.join(directory, entry.name);
				if (entry.isDirectory()) await visit(full);
				else if (/\.gml$/i.test(entry.name)) files.push(full);
			}
		}
		await visit(extractRoot);
		if (!files.length) throw new Error("No GML found in sheet " + sheet);

		const byCode = new Map();
		for (const file of files) {
			const xml = await fs.readFile(file, "utf8");
			const document = new DOMParser().parseFromString(xml, "application/xml");
			const buildings = document.getElementsByTagNameNS(BLDG_NS, "Building");
			for (let index = 0; index < buildings.length; index += 1) {
				const building = buildings[index];
				const name = textContent(descendantByName(building, GML_NS, "name"));
				if (!PILOT_CODES.has(name)) continue;
				const polygons = parseGroundPolygons(building);
				if (!polygons.length) continue;
				if (!byCode.has(name)) byCode.set(name, []);
				byCode.get(name).push(...polygons);
			}
		}
		return byCode;
	} finally {
		await fs.rm(tempRoot, { recursive: true, force: true });
	}
}

async function main() {
	const targetsPath = path.resolve(
		process.argv[2] || "wien-lod21/targets.production.json"
	);
	const outputPath = path.resolve(
		process.argv[3] || "wien-lod21/build/hybrid-pilot-analysis.json"
	);
	const targetsJson = JSON.parse(await fs.readFile(targetsPath, "utf8"));
	const targets = (targetsJson.buildings || []).filter(
		(target) => PILOT_CODES.has(String(target.historicalCode))
	);
	if (targets.length !== 3) {
		throw new Error("Expected exactly three Straußengasse hybrid pilot targets.");
	}
	const sheets = [...new Set(targets.map((target) => String(target.sheet)))];
	if (sheets.length !== 1) {
		throw new Error("Hybrid pilot unexpectedly spans more than one LOD2.1 sheet.");
	}

	const fmzkIds = [...new Set(
		targets.flatMap((target) => target.ksIds || [])
			.map((value) => String(value).replace(/^wien-fmzk:/, ""))
	)];
	const [features, historicalByCode] = await Promise.all([
		fetchCurrentFeatures(fmzkIds),
		loadHistoricalBuildings(sheets[0])
	]);

	const reader = new GeoJSONReader();
	const writer = new GeoJSONWriter();
	const currentById = new Map();
	for (const feature of features) {
		const id = String(feature?.properties?.FMZK_ID ?? "");
		if (!id || !feature?.geometry) continue;
		currentById.set(id, {
			feature,
			geometry: repairGeometry(reader.read(feature.geometry))
		});
	}

	const outputFeatures = [];
	const report = [];
	for (const target of targets) {
		const code = String(target.historicalCode);
		const currentParts = (target.ksIds || []).map((ksId) => {
			const id = String(ksId).replace(/^wien-fmzk:/, "");
			const entry = currentById.get(id);
			if (!entry) throw new Error(code + ": current FMZK_ID " + id + " not returned by WFS");
			return entry;
		});
		const oldPolygons = historicalByCode.get(code) || [];
		if (!oldPolygons.length) throw new Error(code + ": historical ground footprint not found");

		const current = unionGeometries(currentParts.map((entry) => entry.geometry));
		const old = unionGeometries(oldPolygons.map((coordinates) => (
			reader.read({ type: "Polygon", coordinates })
		)));
		if (!current || !old) throw new Error(code + ": invalid union geometry");

		const intersection = safeOverlay(current, old, OverlayOp.INTERSECTION);
		const bufferedOld = BufferOp.bufferOp(old, HISTORICAL_BUFFER_M);
		const remainder = safeOverlay(current, bufferedOld, OverlayOp.DIFFERENCE);
		if (!intersection || !remainder) throw new Error(code + ": overlay operation failed");

		const currentArea = current.getArea();
		const oldArea = old.getArea();
		const intersectionArea = intersection.getArea();
		const remainderParts = geometryParts(remainder)
			.map((geometry) => ({
				geometry,
				area: geometry.getArea()
			}))
			.sort((a, b) => b.area - a.area);
		const meaningful = remainderParts.filter((part) => part.area >= SLIVER_AREA_M2);

		const metrics = {
			historicalCode: code,
			name: target.name,
			bwGebId: target.bwGebId,
			ksIds: target.ksIds,
			currentParts: currentParts.length,
			currentAreaM2: Number(currentArea.toFixed(2)),
			historicalAreaM2: Number(oldArea.toFixed(2)),
			intersectionAreaM2: Number(intersectionArea.toFixed(2)),
			currentCoverage: Number((intersectionArea / currentArea).toFixed(4)),
			historicalCoverage: Number((intersectionArea / oldArea).toFixed(4)),
			bufferM: HISTORICAL_BUFFER_M,
			remainderAreaM2: Number(remainder.getArea().toFixed(2)),
			remainderRatio: Number((remainder.getArea() / currentArea).toFixed(4)),
			remainderComponents: remainderParts.length,
			meaningfulComponents: meaningful.length,
			sliverComponents: remainderParts.length - meaningful.length,
			sliverAreaM2: Number(
				remainderParts
					.filter((part) => part.area < SLIVER_AREA_M2)
					.reduce((sum, part) => sum + part.area, 0)
					.toFixed(2)
			),
			currentHeightsM: currentParts.map((entry) => ({
				fmzkId: String(entry.feature.properties.FMZK_ID),
				height: Number((deriveHeight(entry.feature.properties) ?? 0).toFixed(2))
			}))
		};
		report.push(metrics);

		for (const [kind, geometry] of [
			["current", current],
			["historical", old],
			["remainder", remainder]
		]) {
			outputFeatures.push({
				type: "Feature",
				properties: {
					historicalCode: code,
					name: target.name,
					kind
				},
				geometry: writer.write(geometry)
			});
		}
	}

	const output = {
		generatedAt: new Date().toISOString(),
		crs: "EPSG:31256",
		settings: {
			historicalBufferM: HISTORICAL_BUFFER_M,
			sliverAreaM2: SLIVER_AREA_M2
		},
		report,
		geojson: {
			type: "FeatureCollection",
			features: outputFeatures
		}
	};
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, JSON.stringify(output, null, "\t") + "\n", "utf8");

	console.log("HYBRID PILOT");
	console.log(JSON.stringify(report, null, 2));
	console.log("Wrote " + outputPath);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
