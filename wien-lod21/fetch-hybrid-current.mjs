#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const WFS_URL = "https://data.wien.gv.at/daten/geo";

function parseArgs(argv) {
	const result = {
		targets: "",
		output: ""
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--targets") {
			result.targets = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.targets || !result.output) {
		throw new Error("--targets and --output are required.");
	}
	return result;
}

async function fetchWithRetry(url, attempts = 5) {
	let lastError = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 90_000);
		try {
			const response = await fetch(url, {
				signal: controller.signal,
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
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastError;
}

async function fetchFeatures(ids) {
	const result = [];
	for (let start = 0; start < ids.length; start += 40) {
		const batch = ids.slice(start, start + 40);
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

async function main() {
	const args = parseArgs(process.argv);
	const targetsJson = JSON.parse(await fs.readFile(args.targets, "utf8"));
	const hybridTargets = (targetsJson.buildings || []).filter((target) => (
		String(target.rolloutMode || "").includes("hybrid")
	));
	const requested = new Map();
	for (const target of hybridTargets) {
		for (const ksId of target.ksIds || []) {
			const value = String(ksId || "").trim();
			const match = value.match(/^wien-fmzk:(\d+)$/);
			if (!match) throw new Error("Invalid hybrid KS_ID: " + value);
			requested.set(match[1], {
				ksId: value,
				historicalCode: String(target.historicalCode),
				bwGebId: Number(target.bwGebId)
			});
		}
	}

	if (!requested.size) {
		await fs.mkdir(path.dirname(args.output), { recursive: true });
		await fs.writeFile(args.output, JSON.stringify({
			type: "FeatureCollection",
			features: []
		}, null, "\t") + "\n");
		console.log("No hybrid targets configured.");
		return;
	}

	const features = await fetchFeatures([...requested.keys()].sort());
	const returned = new Set();
	for (const feature of features) {
		const id = String(feature?.properties?.FMZK_ID ?? "").trim();
		if (!requested.has(id)) continue;
		returned.add(id);
		const target = requested.get(id);
		feature.properties = {
			...(feature.properties || {}),
			KS_ID: target.ksId,
			KS_HISTORICAL_CODE: target.historicalCode,
			KS_BW_GEB_ID: target.bwGebId
		};
	}
	const missing = [...requested.keys()].filter((id) => !returned.has(id));
	if (missing.length) {
		throw new Error(
			"Vienna WFS did not return " + missing.length
			+ " requested hybrid FMZK_IDs: " + missing.slice(0, 20).join(", ")
		);
	}

	const output = {
		type: "FeatureCollection",
		features: features.filter((feature) => (
			requested.has(String(feature?.properties?.FMZK_ID ?? "").trim())
		))
	};
	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(args.output, JSON.stringify(output, null, "\t") + "\n", "utf8");
	console.log(JSON.stringify({
		hybridTargets: hybridTargets.length,
		requestedFeatures: requested.size,
		returnedFeatures: output.features.length
	}));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
