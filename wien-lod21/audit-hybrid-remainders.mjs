#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
	const result = { report: "", targets: "", output: "" };
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--report") result.report = path.resolve(argv[++index]);
		else if (arg === "--targets") result.targets = path.resolve(argv[++index]);
		else if (arg === "--output") result.output = path.resolve(argv[++index]);
		else throw new Error("Unknown argument: " + arg);
	}
	if (!result.report || !result.targets || !result.output) {
		throw new Error("--report, --targets and --output are required.");
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
		p50: Number(at(0.50).toFixed(4)),
		p90: Number(at(0.90).toFixed(4)),
		p95: Number(at(0.95).toFixed(4)),
		p99: Number(at(0.99).toFixed(4)),
		max: Number(sorted[sorted.length - 1].toFixed(4))
	};
}

async function main() {
	const args = parseArgs(process.argv);
	const report = JSON.parse(await fs.readFile(args.report, "utf8"));
	const targets = JSON.parse(await fs.readFile(args.targets, "utf8"));

	const candidateByCode = new Map(
		(report.hybridCandidates || []).map((item) => [
			String(item.historicalCode),
			item
		])
	);

	const rows = [];
	for (const target of targets.targets || []) {
		if (
			target.rolloutMode !== "hybrid-a"
			&& target.rolloutMode !== "manual-pilot-hybrid"
		) continue;

		const code = String(target.historicalCode);
		const candidate = candidateByCode.get(code)
			|| (report.results || []).find(
				(item) => String(item.historicalCode) === code
			);
		if (!candidate?.metrics) {
			throw new Error("No citywide metrics for hybrid target " + code);
		}
		const currentArea = Number(candidate.metrics.currentArea);
		const intersectionArea = Number(candidate.metrics.intersectionArea);
		const expected = Math.max(0, currentArea - intersectionArea);
		const actual = Number(target.hybridRemainder?.remainderAreaM2);
		if (!Number.isFinite(actual)) {
			throw new Error("No actual remainder area for hybrid target " + code);
		}
		const delta = actual - expected;
		const absDelta = Math.abs(delta);
		const relative = expected > 0 ? absDelta / expected : 0;
		rows.push({
			historicalCode: code,
			rolloutMode: target.rolloutMode,
			currentAreaM2: currentArea,
			intersectionAreaM2: intersectionArea,
			expectedRemainderM2: Number(expected.toFixed(3)),
			actualRemainderM2: Number(actual.toFixed(3)),
			deltaM2: Number(delta.toFixed(3)),
			absDeltaM2: Number(absDelta.toFixed(3)),
			relativeDelta: Number(relative.toFixed(6)),
			remainderParts: Number(target.hybridRemainder?.remainderParts || 0),
			syntheticObjects: Number(target.hybridRemainder?.syntheticObjects || 0)
		});
	}

	const output = {
		generatedAt: new Date().toISOString(),
		count: rows.length,
		distribution: {
			absDeltaM2: quantiles(rows.map((row) => row.absDeltaM2)),
			relativeDelta: quantiles(rows.map((row) => row.relativeDelta)),
			remainderParts: quantiles(rows.map((row) => row.remainderParts)),
			syntheticObjects: quantiles(rows.map((row) => row.syntheticObjects))
		},
		outliers: {
			absOver1m2: rows.filter((row) => row.absDeltaM2 > 1).length,
			absOver2m2: rows.filter((row) => row.absDeltaM2 > 2).length,
			absOver5m2: rows.filter((row) => row.absDeltaM2 > 5).length,
			relativeOver1pct: rows.filter((row) => row.relativeDelta > 0.01).length,
			relativeOver2pct: rows.filter((row) => row.relativeDelta > 0.02).length,
			relativeOver5pct: rows.filter((row) => row.relativeDelta > 0.05).length
		},
		worstAbsolute: [...rows]
			.sort((a, b) => b.absDeltaM2 - a.absDeltaM2)
			.slice(0, 30),
		worstRelative: [...rows]
			.sort((a, b) => b.relativeDelta - a.relativeDelta)
			.slice(0, 30),
		rows
	};

	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(args.output, JSON.stringify(output, null, "\t") + "\n");
	console.log("HYBRID REMAINDER AUDIT");
	console.log(JSON.stringify({
		count: output.count,
		distribution: output.distribution,
		outliers: output.outliers,
		worstAbsolute: output.worstAbsolute.slice(0, 10),
		worstRelative: output.worstRelative.slice(0, 10)
	}, null, 2));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
