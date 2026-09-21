#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const WFS_BASE = "https://data.wien.gv.at/daten/geo";
const TYPE_NAME = "ogdwien:BAUMKATOGD";
const PAGE_SIZE = 25_000;
const DEFAULT_OUTPUT = path.resolve("baumkataster/build/tmp/baumkataster.geojsonseq");
const DEFAULT_RELEASE = path.resolve("baumkataster/build/Baumkataster/release.json");

const PROPERTY_NAMES = Object.freeze([
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

function parseArgs(argv) {
	const result = {
		output: DEFAULT_OUTPUT,
		release: DEFAULT_RELEASE,
		pageSize: PAGE_SIZE
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
			result.pageSize = Math.max(1_000, Number(value) || PAGE_SIZE);
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
		typeName: TYPE_NAME,
		srsName: "EPSG:4326",
		outputFormat: "json",
		maxFeatures: String(pageSize),
		startIndex: String(startIndex)
	})) {
		url.searchParams.set(key, value);
	}
	return url.href;
}

async function fetchJson(url, { attempts = 4, timeoutMs = 120_000 } = {}) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				headers: {
					Accept: "application/json",
					"User-Agent": "kartensammlung-overlay-builds/baumkataster"
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
				log(`WFS download failed (attempt ${attempt}/${attempts}); retry in ${waitMs / 1000}s: ${error.message}`);
				await new Promise((resolve) => setTimeout(resolve, waitMs));
			}
		} finally {
			clearTimeout(timer);
		}
	}

	throw new Error(`WFS download failed after ${attempts} attempts: ${lastError?.message || lastError}`);
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

function selectProperties(properties = {}) {
	const selected = {};
	for (const name of PROPERTY_NAMES) {
		const value = properties[name];
		if (value !== null && value !== undefined && value !== "") {
			selected[name] = value;
		}
	}
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

async function main() {
	const args = parseArgs(process.argv);
	await fsp.mkdir(path.dirname(args.output), { recursive: true });
	await fsp.mkdir(path.dirname(args.release), { recursive: true });

	const stream = fs.createWriteStream(args.output, {
		encoding: "utf8",
		flags: "w"
	});

	let startIndex = 0;
	let pageCount = 0;
	let sourceCount = 0;
	let outputCount = 0;
	let skippedGeometry = 0;
	let repeatedSignature = "";
	let sourceReportedTotal = null;
	let firstCoverage = [];
	const observedProperties = new Set();

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
				throw new Error(
					"WFS pagination appears to be ignored: consecutive pages are identical."
				);
			}
			repeatedSignature = signature;

			if (sourceReportedTotal === null) {
				const candidate = Number(
					payload.totalFeatures
					?? payload.numberMatched
					?? payload.total
				);
				if (Number.isFinite(candidate) && candidate >= 0) {
					sourceReportedTotal = candidate;
				}
			}

			if (!pageCount && features.length) {
				firstCoverage = expectedPropertyCoverage(features[0].properties || {});
			}

			for (const feature of features) {
				sourceCount += 1;
				for (const key of Object.keys(feature?.properties || {})) {
					observedProperties.add(key);
				}
				const geometry = normalizePointGeometry(feature?.geometry);
				if (!geometry) {
					skippedGeometry += 1;
					continue;
				}
				const properties = selectProperties(feature.properties || {});
				const outputFeature = {
					type: "Feature",
					properties,
					geometry
				};
				if (!stream.write(JSON.stringify(outputFeature) + "\n")) {
					await new Promise((resolve) => stream.once("drain", resolve));
				}
				outputCount += 1;
			}

			pageCount += 1;
			log(`Page ${pageCount}: ${features.length} features; total written ${outputCount}`);

			if (!features.length || features.length < args.pageSize) break;
			startIndex += features.length;

			if (sourceReportedTotal !== null && startIndex >= sourceReportedTotal) break;
			if (pageCount > 100) {
				throw new Error("WFS pagination safety limit exceeded.");
			}
		}
	} finally {
		stream.end();
		await new Promise((resolve, reject) => {
			stream.once("finish", resolve);
			stream.once("error", reject);
		});
	}

	if (outputCount < 100_000) {
		throw new Error(
			`Unexpectedly small Baumkataster export: only ${outputCount} point features.`
		);
	}

	const required = [
		"BAUM_ID",
		"GATTUNG_ART",
		"STAMMUMFANG",
		"BAUMHOEHE",
		"KRONENDURCHMESSER"
	];
	const missingRequired = required.filter((name) => !observedProperties.has(name));
	if (missingRequired.length) {
		throw new Error(
			`WFS schema no longer contains required attributes: ${missingRequired.join(", ")}`
		);
	}

	const release = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			url: WFS_BASE,
			typeName: TYPE_NAME,
			version: "1.1.0",
			attribution: "Stadt Wien – data.wien.gv.at, CC BY 4.0"
		},
		vectorTiles: {
			layer: "baumkataster",
			minzoom: 15,
			maxzoom: 15,
			extent: 4096,
			compression: "none",
			urlTemplate: "tiles/{z}/{x}/{y}.pbf"
		},
		counts: {
			source: sourceCount,
			output: outputCount,
			skippedGeometry,
			pages: pageCount,
			sourceReportedTotal
		},
		properties: PROPERTY_NAMES,
		firstFeatureExpectedPropertyCoverage: firstCoverage,
		observedPropertyCount: observedProperties.size
	};

	await fsp.writeFile(
		args.release,
		JSON.stringify(release, null, "\t") + "\n",
		"utf8"
	);

	log(
		`Baumkataster extraction complete: ${outputCount} point features in ${pageCount} WFS pages.`
	);
	log(`GeoJSONSeq: ${args.output}`);
	log(`Release metadata: ${args.release}`);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
