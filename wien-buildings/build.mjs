#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const WFS_BASE = "https://data.wien.gv.at/daten/geo";
const WFS_TYPE_NAME = "ogdwien:FMZKBKMOGD";
const WFS_PAGE_SIZE = 20_000;
const BUILDING_CLASSES = Object.freeze([11, 12, 13, 14, 19]);
const DEFAULT_OUTPUT = path.resolve("wien-buildings/build/tmp/wien-buildings.geojsonseq");
const DEFAULT_RELEASE = path.resolve("wien-buildings/build/WienBuildings/release.json");

const OUTPUT_PROPERTIES = Object.freeze([
	"FMZK_ID",
	"BW_GEB_ID",
	"BEZUG",
	"BW_BRK_ID",
	"BW_SON_ID",
	"F_KLASSE",
	"KLASSE_SUB",
	"LM",
	"O_KOTE",
	"U_KOTE",
	"T_KOTE",
	"HOEHE_DGM",
	"render_height",
	"render_min_height",
	"KS_SOURCE",
	"KS_ID"
]);

function parseArgs(argv) {
	const result = {
		output: DEFAULT_OUTPUT,
		release: DEFAULT_RELEASE,
		pageSize: WFS_PAGE_SIZE
	};

	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		const value = argv[index + 1];
		if (arg === "--output") {
			result.output = path.resolve(value);
			index += 1;
		} else if (arg === "--release") {
			result.release = path.resolve(value);
			index += 1;
		} else if (arg === "--page-size") {
			result.pageSize = Math.max(1_000, Number(value) || WFS_PAGE_SIZE);
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return result;
}

function log(message) {
	console.log(`[${new Date().toISOString()}] ${message}`);
}

function buildWfsUrl(startIndex, pageSize) {
	const url = new URL(WFS_BASE);
	for (const [key, value] of Object.entries({
		service: "WFS",
		request: "GetFeature",
		version: "1.1.0",
		typeName: WFS_TYPE_NAME,
		srsName: "EPSG:4326",
		outputFormat: "json",
		maxFeatures: String(pageSize),
		startIndex: String(startIndex),
		cql_filter: `F_KLASSE IN (${BUILDING_CLASSES.join(",")})`
	})) {
		url.searchParams.set(key, value);
	}
	return url.href;
}

async function fetchJson(url, {
	attempts = 4,
	timeoutMs = 180_000
} = {}) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				headers: {
					Accept: "application/json",
					"User-Agent": "kartensammlung-overlay-builds/wien-buildings"
				},
				signal: controller.signal
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`);
			}
			return await response.json();
		} catch (error) {
			lastError = error;
			if (attempt < attempts) {
				const waitMs = attempt * 5_000;
				log(`Download failed (attempt ${attempt}/${attempts}); retry in ${waitMs / 1000}s: ${error.message}`);
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}
		} finally {
			clearTimeout(timer);
		}
	}

	throw new Error(
		`Download failed after ${attempts} attempts: ${lastError?.message || lastError}`
	);
}

function finiteNumber(value) {
	if (value === null || value === undefined || value === "") return null;
	const normalized = typeof value === "string" ? value.replace(",", ".").trim() : value;
	const number = Number(normalized);
	return Number.isFinite(number) ? number : null;
}

function normalizeGeometry(geometry) {
	if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
	if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) return null;

	let validPointCount = 0;
	const visit = (value) => {
		if (!Array.isArray(value)) return;
		if (
			value.length >= 2
			&& typeof value[0] !== "object"
			&& typeof value[1] !== "object"
		) {
			const lng = finiteNumber(value[0]);
			const lat = finiteNumber(value[1]);
			if (
				lng !== null
				&& lat !== null
				&& lng >= 15.5
				&& lng <= 17.0
				&& lat >= 47.7
				&& lat <= 48.6
			) validPointCount += 1;
			return;
		}
		for (const child of value) visit(child);
	};
	visit(geometry.coordinates);
	if (validPointCount < 3) return null;

	return geometry;
}

function updateBounds(bounds, geometry) {
	const visit = (value) => {
		if (!Array.isArray(value)) return;
		if (
			value.length >= 2
			&& typeof value[0] !== "object"
			&& typeof value[1] !== "object"
		) {
			const lng = finiteNumber(value[0]);
			const lat = finiteNumber(value[1]);
			if (lng === null || lat === null) return;
			bounds.west = Math.min(bounds.west, lng);
			bounds.south = Math.min(bounds.south, lat);
			bounds.east = Math.max(bounds.east, lng);
			bounds.north = Math.max(bounds.north, lat);
			return;
		}
		for (const child of value) visit(child);
	};
	visit(geometry?.coordinates);
}

function deriveHeights(properties = {}) {
	const roof = finiteNumber(properties.O_KOTE);
	const terrain = finiteNumber(properties.T_KOTE) ?? finiteNumber(properties.HOEHE_DGM);
	const underside = finiteNumber(properties.U_KOTE);

	if (roof === null || terrain === null) return null;
	const height = roof - terrain;
	if (!(height > 0.1) || height > 350) return null;

	let base = 0;
	if (underside !== null && underside > terrain && underside < roof) {
		base = underside - terrain;
	}
	return {
		height: Number(height.toFixed(3)),
		base: Number(Math.max(0, base).toFixed(3))
	};
}

function selectProperties(properties = {}) {
	const classCode = Number.parseInt(String(properties.F_KLASSE ?? ""), 10);
	if (!BUILDING_CLASSES.includes(classCode)) return null;

	const heights = deriveHeights(properties);
	if (!heights) return null;

	const selected = {};
	for (const name of OUTPUT_PROPERTIES) {
		if (["render_height", "render_min_height", "KS_SOURCE", "KS_ID"].includes(name)) continue;
		const value = properties[name];
		if (value !== null && value !== undefined && value !== "") selected[name] = value;
	}

	selected.F_KLASSE = classCode;
	selected.render_height = heights.height;
	selected.render_min_height = heights.base;
	selected.KS_SOURCE = "wien_fmzk_baukoerper";

	const stableId = properties.FMZK_ID
		?? properties.BW_GEB_ID
		?? properties.BW_BRK_ID
		?? properties.BW_SON_ID
		?? "";
	selected.KS_ID = `wien-fmzk:${stableId}`;
	return selected;
}

function pageSignature(features) {
	if (!features.length) return "empty";
	const value = (feature) => String(
		feature?.properties?.FMZK_ID
		?? feature?.properties?.BW_GEB_ID
		?? feature?.id
		?? ""
	);
	return `${features.length}:${value(features[0])}:${value(features[features.length - 1])}`;
}

function writeFeature(stream, feature) {
	return new Promise((resolve) => {
		if (stream.write(JSON.stringify(feature) + "\n")) {
			resolve();
			return;
		}
		stream.once("drain", resolve);
	});
}

async function main() {
	const args = parseArgs(process.argv);
	await fsp.mkdir(path.dirname(args.output), { recursive: true });
	await fsp.mkdir(path.dirname(args.release), { recursive: true });

	const stream = fs.createWriteStream(args.output, {
		encoding: "utf8",
		flags: "w"
	});

	const bounds = {
		west: Infinity,
		south: Infinity,
		east: -Infinity,
		north: -Infinity
	};
	const classCounts = Object.fromEntries(BUILDING_CLASSES.map((value) => [value, 0]));
	const observedProperties = new Set();

	let startIndex = 0;
	let pageCount = 0;
	let sourceCount = 0;
	let outputCount = 0;
	let skippedGeometry = 0;
	let skippedHeight = 0;
	let withHistoricalAddressCode = 0;
	let repeatedSignature = "";
	let reportedTotal = null;

	try {
		while (true) {
			const url = buildWfsUrl(startIndex, args.pageSize);
			log(`Download WFS page ${pageCount + 1}: startIndex=${startIndex}`);
			const payload = await fetchJson(url);
			if (!payload || !Array.isArray(payload.features)) {
				throw new Error("WFS response is not a GeoJSON FeatureCollection.");
			}

			const features = payload.features;
			const signature = pageSignature(features);
			if (pageCount > 0 && signature === repeatedSignature && features.length) {
				throw new Error("WFS pagination appears to be ignored: consecutive pages are identical.");
			}
			repeatedSignature = signature;

			if (reportedTotal === null) {
				const candidate = Number(
					payload.totalFeatures
					?? payload.numberMatched
					?? payload.total
				);
				if (Number.isFinite(candidate) && candidate >= 0) reportedTotal = candidate;
			}

			for (const feature of features) {
				sourceCount += 1;
				for (const key of Object.keys(feature?.properties || {})) observedProperties.add(key);

				const geometry = normalizeGeometry(feature?.geometry);
				if (!geometry) {
					skippedGeometry += 1;
					continue;
				}

				const properties = selectProperties(feature?.properties || {});
				if (!properties) {
					skippedHeight += 1;
					continue;
				}

				classCounts[properties.F_KLASSE] = (classCounts[properties.F_KLASSE] || 0) + 1;
				if (String(properties.BEZUG || "").trim()) withHistoricalAddressCode += 1;
				updateBounds(bounds, geometry);
				await writeFeature(stream, {
					type: "Feature",
					properties,
					geometry
				});
				outputCount += 1;
			}

			pageCount += 1;
			log(`WFS page ${pageCount}: ${features.length} features; total written ${outputCount}`);

			if (!features.length || features.length < args.pageSize) break;
			startIndex += features.length;
			if (reportedTotal !== null && startIndex >= reportedTotal) break;
			if (pageCount > 100) throw new Error("WFS pagination safety limit exceeded.");
		}
	} finally {
		stream.end();
		await new Promise((resolve, reject) => {
			stream.once("finish", resolve);
			stream.once("error", reject);
		});
	}

	if (outputCount < 100_000) {
		throw new Error(`Unexpectedly small Wiener building export: only ${outputCount} polygons.`);
	}

	for (const required of ["F_KLASSE", "O_KOTE", "T_KOTE", "FMZK_ID", "BEZUG"]) {
		if (!observedProperties.has(required)) {
			throw new Error(`WFS schema no longer contains required attribute: ${required}`);
		}
	}

	const outputBounds = [bounds.west, bounds.south, bounds.east, bounds.north];
	if (!outputBounds.every(Number.isFinite)) {
		throw new Error("Wiener building bounds are invalid.");
	}

	const release = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			url: WFS_BASE,
			typeName: WFS_TYPE_NAME,
			version: "1.1.0",
			cqlFilter: `F_KLASSE IN (${BUILDING_CLASSES.join(",")})`,
			attribution: "Stadt Wien – data.wien.gv.at, CC BY 4.0"
		},
		heightModel: {
			height: "O_KOTE - (T_KOTE ?? HOEHE_DGM)",
			minHeight: "max(0, U_KOTE - (T_KOTE ?? HOEHE_DGM))",
			units: "m"
		},
		vectorTiles: {
			layer: "wien_buildings",
			minzoom: 12,
			maxzoom: 15,
			extent: 4096,
			compression: "none",
			bounds: outputBounds,
			urlTemplate: "tiles/{z}/{x}/{y}.pbf",
			tilejson: "tilejson.json"
		},
		counts: {
			source: sourceCount,
			output: outputCount,
			skippedGeometry,
			skippedHeight,
			withHistoricalAddressCode,
			pages: pageCount,
			sourceReportedTotal: reportedTotal,
			byClass: classCounts
		},
		buildingClasses: {
			11: "Gebäude",
			12: "Überbauung / Verbindungsgang",
			13: "Flugdach",
			14: "Glashaus",
			19: "Sonstige Gebäudefläche"
		},
		properties: OUTPUT_PROPERTIES,
		observedWfsPropertyCount: observedProperties.size
	};

	await fsp.writeFile(
		args.release,
		JSON.stringify(release, null, "\t") + "\n",
		"utf8"
	);

	log(`Wiener building extraction complete: ${outputCount} polygons from ${sourceCount} WFS features.`);
	log(`GeoJSONSeq: ${args.output}`);
	log(`Release metadata: ${args.release}`);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
