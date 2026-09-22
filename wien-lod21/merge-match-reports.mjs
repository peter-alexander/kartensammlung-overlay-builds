#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const PILOT_CODES = new Set(["212535", "009238", "113842", "006973"]);

function parseArgs(argv) {
	const result = { inputDir: "", output: "" };
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--input-dir") {
			result.inputDir = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.inputDir || !result.output) {
		throw new Error("--input-dir and --output are required.");
	}
	return result;
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

function resultKey(item) {
	return item.candidateType === "historical-code"
		? "code:" + item.historicalCode
		: "spatial:" + item.BW_GEB_ID;
}

function resultScore(item) {
	const bandRank = {
		strong: 4,
		"legacy-subset": 3,
		plausible: 2,
		reject: 1
	};
	const methodRank = { "historical-code": 2, spatial: 1 };
	return (bandRank[item.band] || 0) * 100
		+ (methodRank[item.method] || 0) * 10
		+ Number(item.metrics?.iou || 0);
}

function hasUnambiguousHistoricalIdentity(item) {
	return (
		Array.isArray(item.ownerBwGebIds)
		&& item.ownerBwGebIds.length === 1
		&& Number(item.sameCodeMatchedParts || 0) === 0
		&& Array.isArray(item.sameCodeOwnerBwGebIds)
		&& item.sameCodeOwnerBwGebIds.length === 1
	);
}

function isDirectProductionCandidate(item) {
	return (
		hasUnambiguousHistoricalIdentity(item)
		&& item.method === "historical-code"
		&& item.band === "strong"
		&& item.lod21?.hasPitchedRoof
	);
}

function isHybridCandidate(item) {
	return (
		hasUnambiguousHistoricalIdentity(item)
		&& item.method === "historical-code"
		&& item.band === "legacy-subset"
		&& item.lod21?.hasPitchedRoof
	);
}

async function collectJsonFiles(root) {
	const result = [];
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		const full = path.join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...await collectJsonFiles(full));
		} else if (
			entry.isFile()
			&& /^wien-lod21-matches(?:-batch-\d+)?\.json$/i.test(entry.name)
		) {
			result.push(full);
		}
	}
	return result.sort();
}

async function main() {
	const args = parseArgs(process.argv);
	const files = await collectJsonFiles(args.inputDir);
	if (!files.length) throw new Error("No matcher batch reports found in " + args.inputDir);

	const reports = [];
	for (const file of files) {
		reports.push(JSON.parse(await fs.readFile(file, "utf8")));
	}

	const bestByCandidate = new Map();
	for (const report of reports) {
		for (const item of report.results || []) {
			const key = resultKey(item);
			const previous = bestByCandidate.get(key);
			if (!previous || resultScore(item) > resultScore(previous)) {
				bestByCandidate.set(key, item);
			}
		}
	}
	const results = [...bestByCandidate.values()];

	const sheetById = new Map();
	for (const report of reports) {
		for (const sheet of report.sheets || []) {
			const id = String(sheet.sheet || "");
			if (!id) continue;
			const previous = sheetById.get(id);
			if (!previous || Number(sheet.zipBytes || 0) > Number(previous.zipBytes || 0)) {
				sheetById.set(id, sheet);
			}
		}
	}
	const sheets = [...sheetById.values()].sort((a, b) => String(a.sheet).localeCompare(String(b.sheet)));
	const selectedSheets = sheets.map((sheet) => String(sheet.sheet));

	const directCandidates = results.filter(isDirectProductionCandidate);
	const hybridCandidates = results.filter(isHybridCandidate);
	const exactMatches = results.filter(
		(item) => item.method === "historical-code" && item.metrics
	);

	const counts = {
		sheets: sheets.length,
		candidates: results.length,
		codeCandidates: results.filter((item) => item.candidateType === "historical-code").length,
		spatialCandidates: results.filter((item) => item.candidateType === "spatial").length,
		historicalCodeMatches: results.filter((item) => item.method === "historical-code").length,
		spatialMatches: results.filter((item) => item.method === "spatial").length,
		strong: results.filter((item) => item.band === "strong").length,
		legacySubset: results.filter((item) => item.band === "legacy-subset").length,
		plausible: results.filter((item) => item.band === "plausible").length,
		reject: results.filter((item) => item.band === "reject").length,
		strongWithPitchedRoof: results.filter(
			(item) => item.band === "strong" && item.lod21?.hasPitchedRoof
		).length,
		legacySubsetWithPitchedRoof: results.filter(
			(item) => item.band === "legacy-subset" && item.lod21?.hasPitchedRoof
		).length,
		directProductionEligible: directCandidates.length,
		hybridCandidates: hybridCandidates.length,
		unavailableSheets: sheets.filter((sheet) => sheet.available === false).length,
		downloadBytes: sheets.reduce((sum, sheet) => sum + Number(sheet.zipBytes || 0), 0)
	};

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
		mode: "citywide-batched",
		sourceReports: files.length,
		selectedSheets,
		counts,
		metricDistribution,
		pilot,
		directCandidates,
		hybridCandidates,
		sheets,
		results
	};

	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(args.output, JSON.stringify(output, null, "\t") + "\n", "utf8");

	console.log("CITYWIDE SUMMARY");
	console.log(JSON.stringify(counts, null, 2));
	console.log("");
	console.log("PILOT");
	for (const item of pilot) {
		console.log(JSON.stringify({
			historicalCode: item.historicalCode,
			band: item.band,
			method: item.method,
			hasPitchedRoof: item.lod21?.hasPitchedRoof || false
		}));
	}
	console.log("Wrote " + args.output);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
