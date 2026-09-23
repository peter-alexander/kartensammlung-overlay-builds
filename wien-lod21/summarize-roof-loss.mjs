#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
	const result = { input: "", output: "" };
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--input") {
			result.input = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.input || !result.output) {
		throw new Error("--input and --output are required.");
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

function unambiguousRoofLossIdentity(item) {
	return (
		Array.isArray(item.ownerBwGebIds)
		&& item.ownerBwGebIds.length === 1
		&& Array.isArray(item.sameCodeOwnerBwGebIds)
		&& item.sameCodeOwnerBwGebIds.length === 1
	);
}

async function main() {
	const args = parseArgs(process.argv);
	const report = JSON.parse(await fs.readFile(args.input, "utf8"));
	const results = (report.results || []).filter(
		(item) => item.candidateType === "historical-code"
	);
	const exact = results.filter(
		(item) => item.method === "historical-code" && item.metrics
	);
	const pitched = exact.filter((item) => item.lod21?.hasPitchedRoof === true);
	const unambiguous = pitched.filter(unambiguousRoofLossIdentity);
	const strong = unambiguous.filter((item) => item.band === "strong");
	const legacySubset = unambiguous.filter(
		(item) => item.band === "legacy-subset"
	);
	const plausible = unambiguous.filter((item) => item.band === "plausible");
	const reject = unambiguous.filter((item) => item.band === "reject");

	const roofTypeCounts = {};
	for (const item of pitched) {
		for (const roofType of item.lod21?.roofTypes || []) {
			const key = String(roofType || "").trim() || "(unknown)";
			roofTypeCounts[key] = (roofTypeCounts[key] || 0) + 1;
		}
	}

	const metricsFor = (items) => ({
		iou: quantiles(items.map((item) => Number(item.metrics?.iou))),
		currentCoverage: quantiles(
			items.map((item) => Number(item.metrics?.currentCoverage))
		),
		oldCoverage: quantiles(
			items.map((item) => Number(item.metrics?.oldCoverage))
		),
		centroidDistanceM: quantiles(
			items.map((item) => Number(item.metrics?.centroidDistanceM))
		),
		heightDifferenceM: quantiles(
			items.map((item) => Number(item.metrics?.heightDifferenceM))
		)
	});

	const compact = (item) => ({
		historicalCode: String(item.historicalCode || ""),
		ownerBwGebIds: item.ownerBwGebIds || [],
		ksIds: item.ksIds || item.current?.ksIds || [],
		sheet: String(item.sheet || ""),
		band: item.band,
		metrics: item.metrics,
		lod21: item.lod21,
		sameCodeTotalParts: Number(item.sameCodeTotalParts || 0),
		sameCodeMatchedParts: Number(item.sameCodeMatchedParts || 0),
		sameCodeOwnerBwGebIds: item.sameCodeOwnerBwGebIds || [],
		lng: Number(item.lng),
		lat: Number(item.lat)
	});

	const output = {
		generatedAt: new Date().toISOString(),
		sourceGeneratedAt: report.generatedAt || null,
		counts: {
			candidates: results.length,
			exactHistoricalCodeMatches: exact.length,
			exactWithPitchedLod21: pitched.length,
			pitchedUnambiguousIdentity: unambiguous.length,
			strongPitchedUnambiguous: strong.length,
			legacySubsetPitchedUnambiguous: legacySubset.length,
			plausiblePitchedUnambiguous: plausible.length,
			rejectPitchedUnambiguous: reject.length,
			ambiguousPitchedIdentity: pitched.length - unambiguous.length
		},
		roofTypeCounts: Object.fromEntries(
			Object.entries(roofTypeCounts).sort((a, b) => (
				b[1] - a[1] || a[0].localeCompare(b[0])
			))
		),
		metrics: {
			exactWithPitchedLod21: metricsFor(pitched),
			strongPitchedUnambiguous: metricsFor(strong),
			legacySubsetPitchedUnambiguous: metricsFor(legacySubset)
		},
		strongCandidates: strong.map(compact),
		legacySubsetCandidates: legacySubset.map(compact),
		plausibleCandidates: plausible.map(compact),
		ambiguousPitchedCandidates: pitched
			.filter((item) => !unambiguousRoofLossIdentity(item))
			.map(compact)
	};

	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(
		args.output,
		JSON.stringify(output, null, "\t") + "\n",
		"utf8"
	);

	console.log(JSON.stringify({
		counts: output.counts,
		metrics: output.metrics
	}, null, 2));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
