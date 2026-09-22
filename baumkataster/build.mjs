#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const WFS_BASE = "https://data.wien.gv.at/daten/geo";
const WFS_TYPE_NAME = "ogdwien:BAUMKATOGD";
const WFS_PAGE_SIZE = 25_000;
const OVERPASS_ENDPOINTS = Object.freeze([
	"https://overpass.kumi.systems/api/interpreter",
	"https://overpass-api.de/api/interpreter"
]);
const OVERPASS_QUERY = `[out:json][timeout:300];
area["boundary"="administrative"]["ISO3166-2"="AT-9"]->.vienna;
(
	node["natural"="tree"](area.vienna);
	way["natural"="tree_row"](area.vienna);
);
out body geom qt;`;

const DEFAULT_OUTPUT = path.resolve("baumkataster/build/tmp/baumkataster.geojsonseq");
const DEFAULT_RELEASE = path.resolve("baumkataster/build/Baumkataster/release.json");

const WFS_PROPERTY_NAMES = Object.freeze([
	"OBJECTID",
	"BAUM_ID",
	"BEZIRK",
	"OBJEKT_STRASSE",
	"GEBIETSGRUPPE",
	"GATTUNG_ART",
	"PFLANZJAHR",
	"PFLANZJAHR_TXT",
	"STAMMUMFANG",
	"STAMMUMFANG_TXT",
	"BAUMHOEHE",
	"BAUMHOEHE_TXT",
	"KRONENDURCHMESSER",
	"KRONENDURCHMESSER_TXT",
	"BAUMNUMMER"
]);

const EXTRA_PROPERTY_NAMES = Object.freeze([
	"KS_SOURCE",
	"KS_ID",
	"OSM_TYPE",
	"OSM_ID",
	"OSM_TREE_ROW_ID",
	"OSM_TREE_ROW_INDEX",
	"OSM_TREE_COUNT",
	"LEAF_TYPE",
	"LEAF_CYCLE"
]);

const OUTPUT_PROPERTY_NAMES = Object.freeze([
	...WFS_PROPERTY_NAMES,
	...EXTRA_PROPERTY_NAMES
]);

const WFS_OSM_DEDUP_RADIUS_M = 4;
const ROW_EXPLICIT_TREE_DEDUP_RADIUS_M = 4;
const ROW_ROW_DEDUP_RADIUS_M = 3;
const OSM_NODE_DUPLICATE_RADIUS_M = 0.75;
const DEFAULT_TREE_ROW_SPACING_M = 8;
const MAX_TREE_ROW_SAMPLES = 500;
const GRID_CELL_SIZE_M = 4;
const VIENNA_REFERENCE_LAT = 48.2;
const METERS_PER_DEG_LAT = 111_320;
const METERS_PER_DEG_LON =
	METERS_PER_DEG_LAT * Math.cos(VIENNA_REFERENCE_LAT * Math.PI / 180);

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
		startIndex: String(startIndex)
	})) {
		url.searchParams.set(key, value);
	}
	return url.href;
}

async function fetchJson(url, {
	attempts = 4,
	timeoutMs = 120_000,
	options = {}
} = {}) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				...options,
				headers: {
					Accept: "application/json",
					"User-Agent": "kartensammlung-overlay-builds/baumkataster",
					...(options.headers || {})
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
				log(
					`Download failed (attempt ${attempt}/${attempts}); retry in ${waitMs / 1000}s: ${error.message}`
				);
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

async function fetchOverpass() {
	let lastError = null;
	for (const endpoint of OVERPASS_ENDPOINTS) {
		try {
			log(`Lade OSM-Bäume und Baumreihen via Overpass: ${endpoint}`);
			const body = new URLSearchParams({ data: OVERPASS_QUERY }).toString();
			const payload = await fetchJson(endpoint, {
				attempts: 2,
				timeoutMs: 360_000,
				options: {
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
					},
					body
				}
			});
			if (!Array.isArray(payload?.elements)) {
				throw new Error("Overpass response has no elements array.");
			}
			if (payload.elements.length < 1_000) {
				throw new Error(
					`Overpass response is suspiciously small: ${payload.elements.length} elements.`
				);
			}
			return {
				endpoint,
				payload
			};
		} catch (error) {
			lastError = error;
			log(`Overpass endpoint failed: ${error.message || error}`);
		}
	}
	throw new Error(
		`All Overpass endpoints failed: ${lastError?.message || lastError}`
	);
}

function finiteNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function normalizePointGeometry(geometry) {
	if (geometry?.type !== "Point" || !Array.isArray(geometry.coordinates)) return null;
	const lng = finiteNumber(geometry.coordinates[0]);
	const lat = finiteNumber(geometry.coordinates[1]);
	if (lng === null || lat === null) return null;
	if (lng < 15.5 || lng > 17.0 || lat < 47.7 || lat > 48.6) return null;
	return {
		type: "Point",
		coordinates: [lng, lat]
	};
}

function selectWfsProperties(properties = {}) {
	const selected = {};
	for (const name of WFS_PROPERTY_NAMES) {
		const value = properties[name];
		if (value !== null && value !== undefined && value !== "") {
			selected[name] = value;
		}
	}

	const id = selected.BAUM_ID ?? selected.OBJECTID ?? "";
	selected.KS_SOURCE = "wien_baumkataster";
	selected.KS_ID = `wien:${id}`;
	return selected;
}

function pageSignature(features) {
	if (!features.length) return "empty";
	const value = (feature) => String(
		feature?.properties?.BAUM_ID
		?? feature?.properties?.OBJECTID
		?? feature?.id
		?? ""
	);
	return `${features.length}:${value(features[0])}:${value(features[features.length - 1])}`;
}

function expectedPropertyCoverage(properties) {
	return [
		"BAUM_ID",
		"GATTUNG_ART",
		"STAMMUMFANG",
		"BAUMHOEHE",
		"BAUMHOEHE_TXT",
		"KRONENDURCHMESSER",
		"KRONENDURCHMESSER_TXT"
	].filter((name) => properties[name] !== null && properties[name] !== undefined);
}

function projectLocal(lng, lat) {
	return {
		x: Number(lng) * METERS_PER_DEG_LON,
		y: Number(lat) * METERS_PER_DEG_LAT
	};
}

function localDistanceM(a, b) {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return Math.hypot(dx, dy);
}

class PointGridIndex {
	constructor(cellSizeM = GRID_CELL_SIZE_M) {
		this.cellSizeM = cellSizeM;
		this.cells = new Map();
		this.size = 0;
	}

	cellKey(x, y) {
		return `${Math.floor(x / this.cellSizeM)}:${Math.floor(y / this.cellSizeM)}`;
	}

	add(lng, lat, data = null) {
		const projected = projectLocal(lng, lat);
		const key = this.cellKey(projected.x, projected.y);
		const items = this.cells.get(key) || [];
		items.push({
			...projected,
			lng: Number(lng),
			lat: Number(lat),
			data
		});
		this.cells.set(key, items);
		this.size += 1;
	}

	hasWithin(lng, lat, radiusM) {
		const projected = projectLocal(lng, lat);
		const radius = Math.max(0, Number(radiusM) || 0);
		const span = Math.ceil(radius / this.cellSizeM);
		const cx = Math.floor(projected.x / this.cellSizeM);
		const cy = Math.floor(projected.y / this.cellSizeM);

		for (let dx = -span; dx <= span; dx += 1) {
			for (let dy = -span; dy <= span; dy += 1) {
				const items = this.cells.get(`${cx + dx}:${cy + dy}`) || [];
				for (const item of items) {
					if (localDistanceM(projected, item) <= radius) return true;
				}
			}
		}
		return false;
	}
}

function parseOsmMeasureMeters(value) {
	if (value === null || value === undefined) return null;
	const text = String(value).trim().toLowerCase().replaceAll(",", ".");
	if (!text) return null;

	const match = text.match(/\d+(?:\.\d+)?/);
	if (!match) return null;
	let number = Number(match[0]);
	if (!Number.isFinite(number)) return null;

	if (/\bcm\b/.test(text)) number /= 100;
	else if (/\bmm\b/.test(text)) number /= 1_000;
	else if (/\b(ft|feet|foot)\b/.test(text)) number *= 0.3048;

	return number;
}

function parseOsmYear(value) {
	const match = String(value ?? "").match(/(?:^|\D)((?:18|19|20)\d{2})(?:\D|$)/);
	if (!match) return null;
	const year = Number(match[1]);
	return year >= 1800 && year <= 2100 ? year : null;
}

function osmSpeciesLabel(tags = {}) {
	const latin = String(tags.species || tags.genus || tags.taxon || "").trim();
	const local = String(
		tags["species:de"]
		|| tags["genus:de"]
		|| tags["species:en"]
		|| tags["genus:en"]
		|| ""
	).trim();

	if (latin && local && latin.toLowerCase() !== local.toLowerCase()) {
		return `${latin} (${local})`;
	}
	return latin || local || "";
}

function normalizeOsmTreeProperties(tags = {}, {
	source,
	osmType,
	osmId,
	rowId = null,
	rowIndex = null,
	rowCount = null
} = {}) {
	const properties = {
		KS_SOURCE: source,
		KS_ID: `osm:${osmType[0]}${osmId}${rowIndex === null ? "" : `:${rowIndex}`}`,
		OSM_TYPE: osmType,
		OSM_ID: String(osmId)
	};

	if (rowId !== null) properties.OSM_TREE_ROW_ID = String(rowId);
	if (rowIndex !== null) properties.OSM_TREE_ROW_INDEX = Number(rowIndex);
	if (rowCount !== null) properties.OSM_TREE_COUNT = Number(rowCount);

	const species = osmSpeciesLabel(tags);
	if (species) properties.GATTUNG_ART = species;

	const heightM = parseOsmMeasureMeters(tags.height);
	if (heightM !== null && heightM > 0 && heightM <= 80) {
		properties.BAUMHOEHE_TXT = `${heightM} m`;
	}

	const crownDiameterM = parseOsmMeasureMeters(
		tags.diameter_crown
		?? tags["crown:diameter"]
	);
	if (crownDiameterM !== null && crownDiameterM > 0 && crownDiameterM <= 50) {
		properties.KRONENDURCHMESSER_TXT = `${crownDiameterM} m`;
	}

	let circumferenceM = parseOsmMeasureMeters(tags.circumference);
	if (circumferenceM === null) {
		const diameterM = parseOsmMeasureMeters(tags.diameter);
		if (diameterM !== null) circumferenceM = diameterM * Math.PI;
	}
	if (circumferenceM !== null && circumferenceM > 0 && circumferenceM <= 20) {
		properties.STAMMUMFANG = Math.round(circumferenceM * 100);
		properties.STAMMUMFANG_TXT = `${Math.round(circumferenceM * 100)} cm`;
	}

	const plantingYear = parseOsmYear(tags.start_date);
	if (plantingYear !== null) properties.PFLANZJAHR = plantingYear;

	const leafType = String(tags.leaf_type || "").trim();
	const leafCycle = String(tags.leaf_cycle || "").trim();
	if (leafType) properties.LEAF_TYPE = leafType;
	if (leafCycle) properties.LEAF_CYCLE = leafCycle;

	return properties;
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

function lineCoordinatesFromWay(element) {
	if (!Array.isArray(element?.geometry)) return [];
	return element.geometry
		.map((point) => ({
			lng: finiteNumber(point?.lon),
			lat: finiteNumber(point?.lat)
		}))
		.filter((point) => point.lng !== null && point.lat !== null);
}

function lineMetrics(coordinates) {
	const projected = coordinates.map((point) => ({
		...point,
		...projectLocal(point.lng, point.lat)
	}));
	const segments = [];
	let totalLengthM = 0;

	for (let index = 1; index < projected.length; index += 1) {
		const a = projected[index - 1];
		const b = projected[index];
		const lengthM = localDistanceM(a, b);
		if (!(lengthM > 0)) continue;
		segments.push({
			a,
			b,
			startM: totalLengthM,
			endM: totalLengthM + lengthM,
			lengthM
		});
		totalLengthM += lengthM;
	}

	return {
		segments,
		totalLengthM
	};
}

function pointAlongLine(metrics, distanceM) {
	if (!metrics.segments.length) return null;
	const target = Math.max(0, Math.min(metrics.totalLengthM, distanceM));
	let segment = metrics.segments[metrics.segments.length - 1];

	for (const candidate of metrics.segments) {
		if (target <= candidate.endM) {
			segment = candidate;
			break;
		}
	}

	const fraction = segment.lengthM > 0
		? (target - segment.startM) / segment.lengthM
		: 0;
	return {
		lng: segment.a.lng + ((segment.b.lng - segment.a.lng) * fraction),
		lat: segment.a.lat + ((segment.b.lat - segment.a.lat) * fraction)
	};
}

function parseTreeCount(tags = {}) {
	const value = Number.parseInt(
		String(tags.tree_count ?? tags.trees ?? "").trim(),
		10
	);
	if (!Number.isFinite(value) || value <= 0) return null;
	return Math.min(MAX_TREE_ROW_SAMPLES, value);
}

function sampleTreeRow(element) {
	const coordinates = lineCoordinatesFromWay(element);
	if (coordinates.length < 2) return [];
	const metrics = lineMetrics(coordinates);
	if (!(metrics.totalLengthM > 0)) return [];

	const taggedCount = parseTreeCount(element.tags || {});
	const count = taggedCount ?? Math.max(
		1,
		Math.min(
			MAX_TREE_ROW_SAMPLES,
			Math.round(metrics.totalLengthM / DEFAULT_TREE_ROW_SPACING_M)
		)
	);

	if (count === 1) {
		const point = pointAlongLine(metrics, metrics.totalLengthM / 2);
		return point ? [point] : [];
	}

	const points = [];
	if (taggedCount !== null) {
		for (let index = 0; index < count; index += 1) {
			const distanceM = metrics.totalLengthM * index / (count - 1);
			const point = pointAlongLine(metrics, distanceM);
			if (point) points.push(point);
		}
	} else {
		for (let index = 0; index < count; index += 1) {
			const distanceM = metrics.totalLengthM * (index + 0.5) / count;
			const point = pointAlongLine(metrics, distanceM);
			if (point) points.push(point);
		}
	}

	return points;
}

async function main() {
	const args = parseArgs(process.argv);
	await fsp.mkdir(path.dirname(args.output), { recursive: true });
	await fsp.mkdir(path.dirname(args.release), { recursive: true });

	const stream = fs.createWriteStream(args.output, {
		encoding: "utf8",
		flags: "w"
	});

	const wfsIndex = new PointGridIndex();
	const osmExplicitIndex = new PointGridIndex();
	const osmRowIndex = new PointGridIndex();
	const outputBounds = {
		west: Infinity,
		south: Infinity,
		east: -Infinity,
		north: -Infinity
	};

	const recordOutputPoint = (lng, lat) => {
		outputBounds.west = Math.min(outputBounds.west, lng);
		outputBounds.south = Math.min(outputBounds.south, lat);
		outputBounds.east = Math.max(outputBounds.east, lng);
		outputBounds.north = Math.max(outputBounds.north, lat);
	};

	let startIndex = 0;
	let wfsPageCount = 0;
	let wfsSourceCount = 0;
	let wfsOutputCount = 0;
	let wfsSkippedGeometry = 0;
	let repeatedSignature = "";
	let wfsReportedTotal = null;
	let firstCoverage = [];
	const observedWfsProperties = new Set();

	const osmStats = {
		elements: 0,
		treeNodes: 0,
		treeNodesOutput: 0,
		treeNodesSkippedWfsOverlap: 0,
		treeNodesSkippedDuplicate: 0,
		treeRows: 0,
		treeRowsInvalidGeometry: 0,
		treeRowGeneratedPoints: 0,
		treeRowOutput: 0,
		treeRowSkippedWfsOverlap: 0,
		treeRowSkippedExplicitTree: 0,
		treeRowSkippedRowOverlap: 0
	};

	let overpassEndpoint = null;

	try {
		while (true) {
			const url = buildWfsUrl(startIndex, args.pageSize);
			log(`Download WFS page ${wfsPageCount + 1}: startIndex=${startIndex}`);
			const payload = await fetchJson(url);
			if (!payload || !Array.isArray(payload.features)) {
				throw new Error("WFS response is not a GeoJSON FeatureCollection.");
			}

			const features = payload.features;
			const signature = pageSignature(features);
			if (wfsPageCount > 0 && signature === repeatedSignature && features.length) {
				throw new Error(
					"WFS pagination appears to be ignored: consecutive pages are identical."
				);
			}
			repeatedSignature = signature;

			if (wfsReportedTotal === null) {
				const candidate = Number(
					payload.totalFeatures
					?? payload.numberMatched
					?? payload.total
				);
				if (Number.isFinite(candidate) && candidate >= 0) {
					wfsReportedTotal = candidate;
				}
			}

			if (!wfsPageCount && features.length) {
				firstCoverage = expectedPropertyCoverage(features[0].properties || {});
			}

			for (const feature of features) {
				wfsSourceCount += 1;
				for (const key of Object.keys(feature?.properties || {})) {
					observedWfsProperties.add(key);
				}
				const geometry = normalizePointGeometry(feature?.geometry);
				if (!geometry) {
					wfsSkippedGeometry += 1;
					continue;
				}
				const properties = selectWfsProperties(feature.properties || {});
				const [lng, lat] = geometry.coordinates;
				wfsIndex.add(lng, lat, properties.KS_ID);
				recordOutputPoint(lng, lat);
				await writeFeature(stream, {
					type: "Feature",
					properties,
					geometry
				});
				wfsOutputCount += 1;
			}

			wfsPageCount += 1;
			log(
				`WFS page ${wfsPageCount}: ${features.length} features; total written ${wfsOutputCount}`
			);

			if (!features.length || features.length < args.pageSize) break;
			startIndex += features.length;

			if (wfsReportedTotal !== null && startIndex >= wfsReportedTotal) break;
			if (wfsPageCount > 100) {
				throw new Error("WFS pagination safety limit exceeded.");
			}
		}

		if (wfsOutputCount < 100_000) {
			throw new Error(
				`Unexpectedly small Baumkataster export: only ${wfsOutputCount} point features.`
			);
		}

		const required = [
			"BAUM_ID",
			"GATTUNG_ART",
			"STAMMUMFANG",
			"BAUMHOEHE",
			"KRONENDURCHMESSER"
		];
		const missingRequired = required.filter(
			(name) => !observedWfsProperties.has(name)
		);
		if (missingRequired.length) {
			throw new Error(
				`WFS schema no longer contains required attributes: ${missingRequired.join(", ")}`
			);
		}

		const overpass = await fetchOverpass();
		overpassEndpoint = overpass.endpoint;
		const elements = overpass.payload.elements;
		osmStats.elements = elements.length;

		const treeNodes = elements.filter(
			(element) => element?.type === "node" && element?.tags?.natural === "tree"
		);
		const treeRows = elements.filter(
			(element) => element?.type === "way" && element?.tags?.natural === "tree_row"
		);
		osmStats.treeNodes = treeNodes.length;
		osmStats.treeRows = treeRows.length;

		log(
			`Overpass: ${treeNodes.length} Einzelbäume, ${treeRows.length} Baumreihen.`
		);

		for (const element of treeNodes) {
			const lng = finiteNumber(element.lon);
			const lat = finiteNumber(element.lat);
			if (lng === null || lat === null) continue;

			if (wfsIndex.hasWithin(lng, lat, WFS_OSM_DEDUP_RADIUS_M)) {
				osmStats.treeNodesSkippedWfsOverlap += 1;
				continue;
			}
			if (osmExplicitIndex.hasWithin(lng, lat, OSM_NODE_DUPLICATE_RADIUS_M)) {
				osmStats.treeNodesSkippedDuplicate += 1;
				continue;
			}

			const properties = normalizeOsmTreeProperties(element.tags || {}, {
				source: "osm_tree",
				osmType: "node",
				osmId: element.id
			});
			osmExplicitIndex.add(lng, lat, properties.KS_ID);
			recordOutputPoint(lng, lat);
			await writeFeature(stream, {
				type: "Feature",
				properties,
				geometry: {
					type: "Point",
					coordinates: [lng, lat]
				}
			});
			osmStats.treeNodesOutput += 1;
		}

		for (const element of treeRows) {
			const sampled = sampleTreeRow(element);
			if (!sampled.length) {
				osmStats.treeRowsInvalidGeometry += 1;
				continue;
			}
			osmStats.treeRowGeneratedPoints += sampled.length;

			for (let index = 0; index < sampled.length; index += 1) {
				const { lng, lat } = sampled[index];

				if (wfsIndex.hasWithin(lng, lat, WFS_OSM_DEDUP_RADIUS_M)) {
					osmStats.treeRowSkippedWfsOverlap += 1;
					continue;
				}
				if (osmExplicitIndex.hasWithin(
					lng,
					lat,
					ROW_EXPLICIT_TREE_DEDUP_RADIUS_M
				)) {
					osmStats.treeRowSkippedExplicitTree += 1;
					continue;
				}
				if (osmRowIndex.hasWithin(lng, lat, ROW_ROW_DEDUP_RADIUS_M)) {
					osmStats.treeRowSkippedRowOverlap += 1;
					continue;
				}

				const properties = normalizeOsmTreeProperties(element.tags || {}, {
					source: "osm_tree_row",
					osmType: "way",
					osmId: element.id,
					rowId: element.id,
					rowIndex: index,
					rowCount: sampled.length
				});
				osmRowIndex.add(lng, lat, properties.KS_ID);
				recordOutputPoint(lng, lat);
				await writeFeature(stream, {
					type: "Feature",
					properties,
					geometry: {
						type: "Point",
						coordinates: [lng, lat]
					}
				});
				osmStats.treeRowOutput += 1;
			}
		}
	} finally {
		stream.end();
		await new Promise((resolve, reject) => {
			stream.once("finish", resolve);
			stream.once("error", reject);
		});
	}

	const totalOutput =
		wfsOutputCount
		+ osmStats.treeNodesOutput
		+ osmStats.treeRowOutput;

	if (totalOutput < wfsOutputCount) {
		throw new Error("Combined tree output count is inconsistent.");
	}

	const generatedAt = new Date().toISOString();
	const bounds = [
		outputBounds.west,
		outputBounds.south,
		outputBounds.east,
		outputBounds.north
	];
	if (!bounds.every(Number.isFinite)) {
		throw new Error("Combined tree bounds are invalid.");
	}

	const release = {
		schemaVersion: 3,
		generatedAt,
		sources: {
			wienBaumkataster: {
				url: WFS_BASE,
				typeName: WFS_TYPE_NAME,
				version: "1.1.0",
				attribution: "Stadt Wien – data.wien.gv.at, CC BY 4.0"
			},
			openStreetMap: {
				overpassEndpoint,
				query: OVERPASS_QUERY,
				attribution: "© OpenStreetMap contributors, ODbL"
			}
		},
		merge: {
			priority: [
				"wien_baumkataster",
				"osm_tree",
				"osm_tree_row"
			],
			wfsOsmDedupRadiusM: WFS_OSM_DEDUP_RADIUS_M,
			rowExplicitTreeDedupRadiusM: ROW_EXPLICIT_TREE_DEDUP_RADIUS_M,
			rowRowDedupRadiusM: ROW_ROW_DEDUP_RADIUS_M,
			defaultTreeRowSpacingM: DEFAULT_TREE_ROW_SPACING_M
		},
		vectorTiles: {
			layer: "baumkataster",
			minzoom: 12,
			maxzoom: 15,
			extent: 4096,
			compression: "none",
			bounds,
			urlTemplate: "tiles/{z}/{x}/{y}.pbf",
			tilejson: "tilejson.json"
		},
		counts: {
			totalOutput,
			wfs: {
				source: wfsSourceCount,
				output: wfsOutputCount,
				skippedGeometry: wfsSkippedGeometry,
				pages: wfsPageCount,
				sourceReportedTotal: wfsReportedTotal
			},
			osm: osmStats
		},
		properties: OUTPUT_PROPERTY_NAMES,
		firstFeatureExpectedPropertyCoverage: firstCoverage,
		observedWfsPropertyCount: observedWfsProperties.size
	};

	await fsp.writeFile(
		args.release,
		JSON.stringify(release, null, "\t") + "\n",
		"utf8"
	);

	log(
		`Combined tree extraction complete: ${totalOutput} trees = `
		+ `${wfsOutputCount} Wien + ${osmStats.treeNodesOutput} OSM Einzelbäume + `
		+ `${osmStats.treeRowOutput} Baumreihen-Samples.`
	);
	log(`GeoJSONSeq: ${args.output}`);
	log(`Release metadata: ${args.release}`);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
