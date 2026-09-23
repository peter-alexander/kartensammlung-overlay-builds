#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
	const result = { report: "", output: "" };
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--report") {
			result.report = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.report || !result.output) {
		throw new Error("--report and --output are required.");
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
		p95: Number(at(0.95).toFixed(4)),
		p99: Number(at(0.99).toFixed(4)),
		max: Number(sorted[sorted.length - 1].toFixed(4))
	};
}

function tier(candidate) {
	const metrics = candidate.metrics || {};
	const oldCoverage = Number(metrics.oldCoverage);
	const currentCoverage = Number(metrics.currentCoverage);
	const centroidDistanceM = Number(metrics.centroidDistanceM);
	const heightDifferenceM = metrics.heightDifferenceM === null
		? null
		: Number(metrics.heightDifferenceM);
	const currentHeightM = metrics.currentHeightM === null
		? null
		: Number(metrics.currentHeightM);
	const heightTolerance = currentHeightM === null
		? 6
		: Math.max(6, currentHeightM * 0.30);
	const heightOk = heightDifferenceM === null || heightDifferenceM <= heightTolerance;

	if (
		oldCoverage >= 0.999
		&& currentCoverage >= 0.60
		&& centroidDistanceM <= 6
		&& heightOk
	) return "hybrid-a";

	if (
		oldCoverage >= 0.995
		&& currentCoverage >= 0.60
		&& centroidDistanceM <= 8
		&& heightOk
	) return "hybrid-b";

	if (
		oldCoverage >= 0.98
		&& currentCoverage >= 0.60
		&& centroidDistanceM <= 8
		&& heightOk
	) return "hybrid-c";

	return "defer";
}

async function main() {
	const args = parseArgs(process.argv);
	const report = JSON.parse(await fs.readFile(args.report, "utf8"));
	const candidates = Array.isArray(report.hybridCandidates)
		? report.hybridCandidates
		: [];

	const enriched = candidates.map((candidate) => ({
		...candidate,
		hybridTier: tier(candidate),
		ksIdCount: Array.isArray(candidate.ksIds) ? candidate.ksIds.length : 0
	}));

	const tiers = Object.fromEntries(
		["hybrid-a", "hybrid-b", "hybrid-c", "defer"].map((name) => [
			name,
			enriched.filter((item) => item.hybridTier === name).length
		])
	);

	const output = {
		generatedAt: new Date().toISOString(),
		sourceGeneratedAt: report.generatedAt || null,
		count: enriched.length,
		tiers,
		distribution: {
			oldCoverage: quantiles(enriched.map((item) => Number(item.metrics?.oldCoverage))),
			currentCoverage: quantiles(enriched.map((item) => Number(item.metrics?.currentCoverage))),
			centroidDistanceM: quantiles(enriched.map((item) => Number(item.metrics?.centroidDistanceM))),
			heightDifferenceM: quantiles(
				enriched
					.map((item) => item.metrics?.heightDifferenceM)
					.filter((value) => value !== null)
					.map(Number)
			),
			ksIdCount: quantiles(enriched.map((item) => item.ksIdCount))
		},
		pilots: enriched.filter((item) => (
			["009238", "113842", "212535"].includes(String(item.historicalCode))
		)).map((item) => ({
			historicalCode: item.historicalCode,
			tier: item.hybridTier,
			metrics: item.metrics,
			ksIdCount: item.ksIdCount
		})),
		candidates: enriched
	};

	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(args.output, JSON.stringify(output, null, "\t") + "\n", "utf8");

	console.log("HYBRID CANDIDATE SUMMARY");
	console.log(JSON.stringify({
		count: output.count,
		tiers: output.tiers,
		distribution: output.distribution,
		pilots: output.pilots
	}, null, 2));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
