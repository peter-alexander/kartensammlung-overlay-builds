#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const MANUAL_HYBRID_CODES = new Set(["009238", "113842", "212535"]);

function parseArgs(argv) {
	const result = {
		report: "",
		pilot: "",
		output: ""
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--report") {
			result.report = path.resolve(argv[++index]);
		} else if (arg === "--pilot") {
			result.pilot = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.report || !result.pilot || !result.output) {
		throw new Error("--report, --pilot and --output are required.");
	}
	return result;
}

function singleOwner(candidate) {
	const owners = candidate?.ownerBwGebIds || [];
	if (owners.length !== 1) {
		throw new Error(
			"Expected exactly one BW_GEB_ID for "
			+ String(candidate?.historicalCode || "?")
		);
	}
	return Number(owners[0]);
}

function targetFromCandidate(candidate, {
	name = "",
	rolloutMode
} = {}) {
	const code = String(candidate.historicalCode || "");
	if (!/^\d{6}$/.test(code)) {
		throw new Error("Invalid historical code: " + code);
	}
	const sheet = String(candidate.sheet || candidate.lod21Sheet || "");
	if (!/^\d{6}$/.test(sheet)) {
		throw new Error("Invalid LOD2.1 sheet for " + code + ": " + sheet);
	}
	const bwGebId = singleOwner(candidate);
	if (!Number.isFinite(bwGebId)) {
		throw new Error("Invalid BW_GEB_ID for " + code);
	}
	return {
		name: name || ("Wien LOD2.1 " + code),
		historicalCode: code,
		bwGebId,
		sheet,
		lng: Number(candidate.lng),
		lat: Number(candidate.lat),
		rolloutMode
	};
}

async function main() {
	const args = parseArgs(process.argv);
	const report = JSON.parse(await fs.readFile(args.report, "utf8"));
	const pilot = JSON.parse(await fs.readFile(args.pilot, "utf8"));
	const pilotByCode = new Map(
		(pilot.buildings || []).map((item) => [String(item.historicalCode), item])
	);

	const direct = Array.isArray(report.directCandidates)
		? report.directCandidates
		: [];
	if (direct.length !== Number(report?.counts?.directProductionEligible || 0)) {
		throw new Error(
			"Direct candidate count mismatch: "
			+ direct.length + " vs " + report?.counts?.directProductionEligible
		);
	}

	const targets = direct.map((candidate) => {
		const pilotTarget = pilotByCode.get(String(candidate.historicalCode));
		return targetFromCandidate(candidate, {
			name: pilotTarget?.name || "",
			rolloutMode: "direct-strong"
		});
	});

	const resultsByCode = new Map(
		(report.results || [])
			.filter((item) => item.candidateType === "historical-code")
			.map((item) => [String(item.historicalCode), item])
	);
	for (const code of MANUAL_HYBRID_CODES) {
		if (targets.some((target) => target.historicalCode === code)) continue;
		const candidate = resultsByCode.get(code);
		const pilotTarget = pilotByCode.get(code);
		if (!candidate || !pilotTarget) {
			throw new Error("Missing manual hybrid pilot " + code);
		}
		if (
			candidate.method !== "historical-code"
			|| candidate.band !== "legacy-subset"
			|| !candidate.lod21?.hasPitchedRoof
		) {
			throw new Error("Manual hybrid pilot is no longer valid: " + code);
		}
		targets.push(targetFromCandidate(candidate, {
			name: pilotTarget.name,
			rolloutMode: "manual-pilot-hybrid"
		}));
	}

	targets.sort((a, b) => a.historicalCode.localeCompare(b.historicalCode));

	const codes = new Set();
	for (const target of targets) {
		if (codes.has(target.historicalCode)) {
			throw new Error("Duplicate historical code " + target.historicalCode);
		}
		codes.add(target.historicalCode);
	}

	const directCount = targets.filter(
		(target) => target.rolloutMode === "direct-strong"
	).length;
	const manualHybridCount = targets.filter(
		(target) => target.rolloutMode === "manual-pilot-hybrid"
	).length;

	const output = {
		schemaVersion: 1,
		status: "production",
		zoom: 15,
		extent: 8192,
		sourceAnalysis: {
			generatedAt: report.generatedAt || null,
			sheets: Number(report?.counts?.sheets || 0),
			candidates: Number(report?.counts?.candidates || 0),
			directProductionEligible: Number(report?.counts?.directProductionEligible || 0),
			hybridCandidatesDeferred: Number(report?.counts?.hybridCandidates || 0)
		},
		counts: {
			total: targets.length,
			directStrong: directCount,
			manualPilotHybrid: manualHybridCount,
			sourceSheets: new Set(targets.map((target) => target.sheet)).size
		},
		buildings: targets
	};

	if (directCount !== 1209) {
		throw new Error("Expected 1209 direct production targets, got " + directCount);
	}
	if (manualHybridCount !== 3) {
		throw new Error("Expected 3 manual hybrid pilot targets, got " + manualHybridCount);
	}
	if (targets.length !== 1212) {
		throw new Error("Expected 1212 production targets, got " + targets.length);
	}

	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(args.output, JSON.stringify(output, null, "\t") + "\n", "utf8");
	console.log(JSON.stringify(output.counts, null, 2));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
