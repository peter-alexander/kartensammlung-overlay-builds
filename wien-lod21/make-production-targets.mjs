#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const HYBRID_B_ABSOLUTE_MAX_OUTSIDE_M2 = 0.58;

const MANUAL_PILOT_BANDS = new Map([
	["006973", "strong"],
	["009238", "legacy-subset"],
	["113842", "legacy-subset"],
	["212535", "legacy-subset"]
]);

function parseArgs(argv) {
	const result = {
		report: "",
		pilot: "",
		output: "",
		includeHybridA: false,
		includeHybridBAbsolute: false
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--report") {
			result.report = path.resolve(argv[++index]);
		} else if (arg === "--pilot") {
			result.pilot = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else if (arg === "--include-hybrid-a") {
			result.includeHybridA = true;
		} else if (arg === "--include-hybrid-b-absolute") {
			result.includeHybridBAbsolute = true;
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.report || !result.pilot || !result.output) {
		throw new Error("--report, --pilot and --output are required.");
	}
	if (result.includeHybridBAbsolute && !result.includeHybridA) {
		throw new Error("--include-hybrid-b-absolute requires --include-hybrid-a.");
	}
	return result;
}

function hybridHeightOk(candidate) {
	const metrics = candidate?.metrics || {};
	const heightDifferenceM = metrics.heightDifferenceM === null
		? null
		: Number(metrics.heightDifferenceM);
	const currentHeightM = metrics.currentHeightM === null
		? null
		: Number(metrics.currentHeightM);
	const heightTolerance = currentHeightM === null
		? 6
		: Math.max(6, currentHeightM * 0.30);
	return (
		heightDifferenceM === null
		|| heightDifferenceM <= heightTolerance
	);
}

function historicalOutsideCurrentM2(candidate) {
	const oldArea = Number(candidate?.metrics?.oldArea);
	const intersectionArea = Number(candidate?.metrics?.intersectionArea);
	if (!Number.isFinite(oldArea) || !Number.isFinite(intersectionArea)) {
		return null;
	}
	return Math.max(0, oldArea - intersectionArea);
}

function isHybridA(candidate) {
	const metrics = candidate?.metrics || {};
	return (
		Number(metrics.oldCoverage) >= 0.999
		&& Number(metrics.currentCoverage) >= 0.60
		&& Number(metrics.centroidDistanceM) <= 6
		&& hybridHeightOk(candidate)
	);
}

function isHybridBAbsolute(candidate) {
	if (isHybridA(candidate)) return false;
	const metrics = candidate?.metrics || {};
	const outsideM2 = historicalOutsideCurrentM2(candidate);
	return (
		Number(metrics.oldCoverage) >= 0.995
		&& Number(metrics.currentCoverage) >= 0.60
		&& Number(metrics.centroidDistanceM) <= 6
		&& hybridHeightOk(candidate)
		&& outsideM2 !== null
		&& outsideM2 <= HYBRID_B_ABSOLUTE_MAX_OUTSIDE_M2 + 1e-9
	);
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
	const ksIds = [...new Set(
		(candidate.ksIds || [])
			.map((value) => String(value || "").trim())
			.filter((value) => /^wien-fmzk:/.test(value))
	)].sort();
	if (!ksIds.length) {
		throw new Error("No exact OGD KS_IDs for " + code);
	}
	const currentArea = Number(candidate?.metrics?.currentArea);
	const intersectionArea = Number(candidate?.metrics?.intersectionArea);
	const outsideHistoricalM2 = historicalOutsideCurrentM2(candidate);
	const expectedRemainderM2 = (
		Number.isFinite(currentArea)
		&& Number.isFinite(intersectionArea)
	)
		? Math.max(0, currentArea - intersectionArea)
		: null;
	return {
		name: name || ("Wien LOD2.1 " + code),
		historicalCode: code,
		bwGebId,
		ksIds,
		sheet,
		lng: Number(candidate.lng),
		lat: Number(candidate.lat),
		rolloutMode,
		expectedRemainderM2: Number.isFinite(expectedRemainderM2)
			? Number(expectedRemainderM2.toFixed(3))
			: null,
		historicalOutsideCurrentM2: Number.isFinite(outsideHistoricalM2)
			? Number(outsideHistoricalM2.toFixed(3))
			: null
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

	const hybridA = args.includeHybridA
		? (report.hybridCandidates || []).filter(isHybridA)
		: [];
	for (const candidate of hybridA) {
		const pilotTarget = pilotByCode.get(String(candidate.historicalCode));
		targets.push(targetFromCandidate(candidate, {
			name: pilotTarget?.name || "",
			rolloutMode: "hybrid-a"
		}));
	}

	const hybridBAbsolute = args.includeHybridBAbsolute
		? (report.hybridCandidates || []).filter(isHybridBAbsolute)
		: [];
	for (const candidate of hybridBAbsolute) {
		const pilotTarget = pilotByCode.get(String(candidate.historicalCode));
		targets.push(targetFromCandidate(candidate, {
			name: pilotTarget?.name || "",
			rolloutMode: "hybrid-b-absolute"
		}));
	}

	const resultsByCode = new Map(
		(report.results || [])
			.filter((item) => item.candidateType === "historical-code")
			.map((item) => [String(item.historicalCode), item])
	);
	for (const [code, expectedBand] of MANUAL_PILOT_BANDS) {
		if (targets.some((target) => target.historicalCode === code)) continue;
		const candidate = resultsByCode.get(code);
		const pilotTarget = pilotByCode.get(code);
		if (!candidate || !pilotTarget) {
			throw new Error("Missing manual pilot " + code);
		}
		if (
			candidate.method !== "historical-code"
			|| candidate.band !== expectedBand
			|| !candidate.lod21?.hasPitchedRoof
		) {
			throw new Error("Manual pilot is no longer valid: " + code);
		}
		targets.push(targetFromCandidate(candidate, {
			name: pilotTarget.name,
			rolloutMode: expectedBand === "strong"
				? "manual-pilot-strong"
				: "manual-pilot-hybrid"
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
	const hybridACount = targets.filter(
		(target) => target.rolloutMode === "hybrid-a"
	).length;
	const hybridBAbsoluteCount = targets.filter(
		(target) => target.rolloutMode === "hybrid-b-absolute"
	).length;
	const manualStrongCount = targets.filter(
		(target) => target.rolloutMode === "manual-pilot-strong"
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
			hybridCandidatesSelected: hybridACount + hybridBAbsoluteCount,
			hybridCandidatesDeferred:
				Number(report?.counts?.hybridCandidates || 0)
				- hybridACount
				- hybridBAbsoluteCount,
			hybridBAbsoluteMaxHistoricalOutsideCurrentM2:
				HYBRID_B_ABSOLUTE_MAX_OUTSIDE_M2
		},
		counts: {
			total: targets.length,
			directStrong: directCount,
			hybridA: hybridACount,
			hybridBAbsolute: hybridBAbsoluteCount,
			manualPilotStrong: manualStrongCount,
			manualPilotHybrid: manualHybridCount,
			sourceSheets: new Set(targets.map((target) => target.sheet)).size
		},
		buildings: targets
	};

	if (directCount !== 1209) {
		throw new Error("Expected 1209 direct production targets, got " + directCount);
	}
	if (hybridACount !== (args.includeHybridA ? 614 : 0)) {
		throw new Error(
			"Expected " + (args.includeHybridA ? 614 : 0)
			+ " hybrid-a targets, got " + hybridACount
		);
	}
	if (hybridBAbsoluteCount !== (args.includeHybridBAbsolute ? 72 : 0)) {
		throw new Error(
			"Expected " + (args.includeHybridBAbsolute ? 72 : 0)
			+ " hybrid-b-absolute targets, got " + hybridBAbsoluteCount
		);
	}
	if (manualStrongCount !== 1) {
		throw new Error("Expected 1 manual strong pilot target, got " + manualStrongCount);
	}
	const expectedManualHybrid = args.includeHybridA ? 1 : 3;
	if (manualHybridCount !== expectedManualHybrid) {
		throw new Error(
			"Expected " + expectedManualHybrid
			+ " manual hybrid pilot targets, got " + manualHybridCount
		);
	}
	const expectedTargets = args.includeHybridBAbsolute
		? 1897
		: args.includeHybridA
			? 1825
			: 1213;
	if (targets.length !== expectedTargets) {
		throw new Error(
			"Expected " + expectedTargets
			+ " production targets, got " + targets.length
		);
	}

	await fs.mkdir(path.dirname(args.output), { recursive: true });
	await fs.writeFile(args.output, JSON.stringify(output, null, "\t") + "\n", "utf8");
	console.log(JSON.stringify(output.counts, null, 2));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
