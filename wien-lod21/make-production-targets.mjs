#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const MAPTOOLKIT_EXACT_FOOTPRINT_AUDIT_CLASS =
	"exact-footprint-flat-only";
const MAPTOOLKIT_CLIPPED_FOOTPRINT_AUDIT_CLASS =
	"current-footprint-clipped-flat-only";

function isSafeMaptoolkitRoofCoverageAudit(audit) {
	if (Number(audit?.flatHitPercent) === 100) return true;

	const auditClass = String(audit?.auditClass || "");
	if (auditClass === MAPTOOLKIT_EXACT_FOOTPRINT_AUDIT_CLASS) {
		return (
			Number(audit?.flatHitPercent) >= 80
			&& Number(audit?.pitchedHitPercent) === 0
			&& Number(audit?.currentCoverage) >= 0.998
			&& Number(audit?.oldCoverage) >= 0.998
			&& Number(audit?.centroidDistanceM) <= 0.10
			&& Number(audit?.currentCoverageByFlatRoof) >= 0.98
			&& Number(audit?.flatRoofInsideCurrent) >= 0.98
			&& Number(audit?.flatRoofSymmetricDifferenceM2) <= 2
			&& Number(audit?.footprintSymmetricDifferenceM2) <= 0.25
			&& audit?.featureOwnershipExclusive === true
			&& audit?.allFeaturesInterior === true
			&& audit?.allRoofSurfacesFlat === true
		);
	}
	if (auditClass === MAPTOOLKIT_CLIPPED_FOOTPRINT_AUDIT_CLASS) {
		return (
			Number(audit?.flatHitPercent) >= 80
			&& Number(audit?.pitchedHitPercent) === 0
			&& Number(audit?.currentCoverageByFlatRoof) >= 0.995
			&& Number(audit?.flatRoofInsideCurrent) >= 0.995
			&& Number(audit?.flatRoofSymmetricDifferenceRatio) <= 0.01
			&& audit?.featureOwnershipExclusive === true
			&& audit?.allFeaturesInterior === true
			&& audit?.allRoofSurfacesFlat === true
		);
	}
	return false;
}

const HYBRID_B_ABSOLUTE_MAX_OUTSIDE_M2 = 0.58;
const HYBRID_B_THIN_MAX_MEAN_WIDTH_M = 0.05;
const HYBRID_HEIGHT_SPLIT_TOLERANCE_M = 0.25;
const EAVE_AUDIT_PATH = new URL(
	"./eave-height-analysis.generated.json",
	import.meta.url
);
const AUDITED_HYBRID_B_THIN = new Map([
	["079387", 0.0330],
	["088019", 0.0306],
	["123321", 0.0312]
]);
const AUDITED_HYBRID_B_CLIP = new Set([
	"011758",
	"032459",
	"045503",
	"047031",
	"061091",
	"065479",
	"088729"
]);

const AUDITED_PLAUSIBLE_EAVE_CLIP = new Map([
	["006944", {
		bwGebId: 5288572,
		ksIds: [
			"wien-fmzk:4002350666",
			"wien-fmzk:4002350702",
			"wien-fmzk:4004308520"
		],
		minIou: 0.999,
		minCoverage: 0.999,
		maxCentroidDistanceM: 0.05,
		maxHistoricalOutsideM2: 0.10,
		eaveHeightM: 20.68,
		eaveDifferenceM: 0.77,
		eaveToleranceM: 6
	}]
]);

const AUDITED_HYBRID_HEIGHT_SPLIT = new Map([
	["029048", {
		protectedKsIds: [
			"wien-fmzk:4006403822"
		],
		compatibleKsIds: [
			"wien-fmzk:4005793328",
			"wien-fmzk:4005793338",
			"wien-fmzk:4007858369"
		],
		clippedHistoricalAreaM2: 174.909,
		removedHistoricalAreaM2: 253.064,
		remainderAreaM2: 337.305
	}],
	["074864", {
		protectedKsIds: [
			"wien-fmzk:4005973324",
			"wien-fmzk:4005973341",
			"wien-fmzk:4005973350",
			"wien-fmzk:4005973513",
			"wien-fmzk:4006453611",
			"wien-fmzk:4007481442"
		],
		compatibleKsIds: [
			"wien-fmzk:4005973518"
		],
		clippedHistoricalAreaM2: 116.769,
		removedHistoricalAreaM2: 94.527,
		remainderAreaM2: 160.136
	}]
]);

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
		roofReplacements: "",
		includeMaptoolkitRoofReplacements: false,
		includeHybridA: false,
		includeHybridBAbsolute: false,
		includeHybridBThin: false,
		includeHybridBClip: false,
		includeHybridCClip: false,
		includeHybridDClip: false,
		includeHybridEaveClip: false,
		includeHybridHeightSplit: false
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--report") {
			result.report = path.resolve(argv[++index]);
		} else if (arg === "--pilot") {
			result.pilot = path.resolve(argv[++index]);
		} else if (arg === "--output") {
			result.output = path.resolve(argv[++index]);
		} else if (arg === "--roof-replacements") {
			result.roofReplacements = path.resolve(argv[++index]);
		} else if (arg === "--include-maptoolkit-roof-replacements") {
			result.includeMaptoolkitRoofReplacements = true;
		} else if (arg === "--include-hybrid-a") {
			result.includeHybridA = true;
		} else if (arg === "--include-hybrid-b-absolute") {
			result.includeHybridBAbsolute = true;
		} else if (arg === "--include-hybrid-b-thin") {
			result.includeHybridBThin = true;
		} else if (arg === "--include-hybrid-b-clip") {
			result.includeHybridBClip = true;
		} else if (arg === "--include-hybrid-c-clip") {
			result.includeHybridCClip = true;
		} else if (arg === "--include-hybrid-d-clip") {
			result.includeHybridDClip = true;
		} else if (arg === "--include-hybrid-eave-clip") {
			result.includeHybridEaveClip = true;
		} else if (arg === "--include-hybrid-height-split") {
			result.includeHybridHeightSplit = true;
		} else {
			throw new Error("Unknown argument: " + arg);
		}
	}
	if (!result.report || !result.pilot || !result.output) {
		throw new Error("--report, --pilot and --output are required.");
	}
	if (
		result.includeMaptoolkitRoofReplacements
		&& !result.roofReplacements
	) {
		throw new Error(
			"--include-maptoolkit-roof-replacements requires --roof-replacements."
		);
	}
	if (result.includeHybridBAbsolute && !result.includeHybridA) {
		throw new Error("--include-hybrid-b-absolute requires --include-hybrid-a.");
	}
	if (result.includeHybridBThin && !result.includeHybridBAbsolute) {
		throw new Error(
			"--include-hybrid-b-thin requires --include-hybrid-b-absolute."
		);
	}
	if (result.includeHybridBClip && !result.includeHybridBThin) {
		throw new Error(
			"--include-hybrid-b-clip requires --include-hybrid-b-thin."
		);
	}
	if (result.includeHybridCClip && !result.includeHybridBClip) {
		throw new Error(
			"--include-hybrid-c-clip requires --include-hybrid-b-clip."
		);
	}
	if (result.includeHybridDClip && !result.includeHybridCClip) {
		throw new Error(
			"--include-hybrid-d-clip requires --include-hybrid-c-clip."
		);
	}
	if (result.includeHybridEaveClip && !result.includeHybridDClip) {
		throw new Error(
			"--include-hybrid-eave-clip requires --include-hybrid-d-clip."
		);
	}
	if (result.includeHybridHeightSplit && !result.includeHybridEaveClip) {
		throw new Error(
			"--include-hybrid-height-split requires --include-hybrid-eave-clip."
		);
	}
	if (
		result.includeMaptoolkitRoofReplacements
		&& !result.includeHybridHeightSplit
	) {
		throw new Error(
			"--include-maptoolkit-roof-replacements requires "
			+ "--include-hybrid-height-split."
		);
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

function isHybridBThin(candidate) {
	if (isHybridA(candidate) || isHybridBAbsolute(candidate)) return false;
	const code = String(candidate?.historicalCode || "");
	const auditedMaxWidthM = AUDITED_HYBRID_B_THIN.get(code);
	const metrics = candidate?.metrics || {};
	return (
		auditedMaxWidthM !== undefined
		&& auditedMaxWidthM <= HYBRID_B_THIN_MAX_MEAN_WIDTH_M + 1e-9
		&& Number(metrics.oldCoverage) >= 0.995
		&& Number(metrics.currentCoverage) >= 0.60
		&& Number(metrics.centroidDistanceM) <= 6
		&& hybridHeightOk(candidate)
	);
}

function isHybridBClip(candidate) {
	if (
		isHybridA(candidate)
		|| isHybridBAbsolute(candidate)
		|| isHybridBThin(candidate)
	) return false;
	const code = String(candidate?.historicalCode || "");
	const metrics = candidate?.metrics || {};
	return (
		AUDITED_HYBRID_B_CLIP.has(code)
		&& Number(metrics.oldCoverage) >= 0.995
		&& Number(metrics.currentCoverage) >= 0.60
		&& Number(metrics.centroidDistanceM) <= 6.5
		&& hybridHeightOk(candidate)
	);
}

function isHybridCClip(candidate) {
	if (
		isHybridA(candidate)
		|| isHybridBAbsolute(candidate)
		|| isHybridBThin(candidate)
		|| isHybridBClip(candidate)
	) return false;
	const metrics = candidate?.metrics || {};
	return (
		Number(metrics.oldCoverage) >= 0.98
		&& Number(metrics.currentCoverage) >= 0.60
		&& Number(metrics.centroidDistanceM) <= 8
		&& hybridHeightOk(candidate)
	);
}

function isHybridDClip(candidate) {
	if (
		isHybridA(candidate)
		|| isHybridBAbsolute(candidate)
		|| isHybridBThin(candidate)
		|| isHybridBClip(candidate)
		|| isHybridCClip(candidate)
	) return false;
	const metrics = candidate?.metrics || {};
	return (
		Number(metrics.oldCoverage) >= 0.95
		&& Number(metrics.currentCoverage) >= 0.60
		&& Number(metrics.centroidDistanceM) <= 8
		&& hybridHeightOk(candidate)
	);
}

function isHybridEaveClip(candidate, eaveAuditByCode) {
	if (
		isHybridA(candidate)
		|| isHybridBAbsolute(candidate)
		|| isHybridBThin(candidate)
		|| isHybridBClip(candidate)
		|| isHybridCClip(candidate)
		|| isHybridDClip(candidate)
	) return false;
	const code = String(candidate?.historicalCode || "");
	const audit = eaveAuditByCode.get(code);
	const metrics = candidate?.metrics || {};
	return (
		audit?.surfaceMinMedianHeightMPass === true
		&& Number(metrics.oldCoverage) >= 0.95
		&& Number(metrics.currentCoverage) >= 0.60
		&& Number(metrics.centroidDistanceM) <= 8
	);
}

function isHybridHeightSplit(candidate, eaveAuditByCode) {
	if (
		isHybridA(candidate)
		|| isHybridBAbsolute(candidate)
		|| isHybridBThin(candidate)
		|| isHybridBClip(candidate)
		|| isHybridCClip(candidate)
		|| isHybridDClip(candidate)
		|| isHybridEaveClip(candidate, eaveAuditByCode)
	) return false;
	const code = String(candidate?.historicalCode || "");
	const metrics = candidate?.metrics || {};
	return (
		AUDITED_HYBRID_HEIGHT_SPLIT.has(code)
		&& Number(metrics.oldCoverage) >= 0.95
		&& Number(metrics.currentCoverage) >= 0.60
		&& Number(metrics.centroidDistanceM) <= 8
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
	const roofReplacements = args.includeMaptoolkitRoofReplacements
		? JSON.parse(await fs.readFile(args.roofReplacements, "utf8"))
		: { count: 0, buildings: [] };
	const expectedRoofReplacementCount =
		args.includeMaptoolkitRoofReplacements
			? Number(roofReplacements?.count)
			: 0;
	if (
		!Number.isInteger(expectedRoofReplacementCount)
		|| expectedRoofReplacementCount < 0
		|| (
			args.includeMaptoolkitRoofReplacements
			&& expectedRoofReplacementCount < 1
		)
	) {
		throw new Error(
			"Invalid Maptoolkit roof replacement manifest count: "
			+ String(roofReplacements?.count)
		);
	}
	const eaveAudit = JSON.parse(await fs.readFile(EAVE_AUDIT_PATH, "utf8"));
	const eaveAuditByCode = new Map(
		(eaveAudit.rows || []).map((item) => [
			String(item.historicalCode),
			item
		])
	);
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

	const hybridBThin = args.includeHybridBThin
		? (report.hybridCandidates || []).filter(isHybridBThin)
		: [];
	for (const candidate of hybridBThin) {
		const code = String(candidate.historicalCode);
		const pilotTarget = pilotByCode.get(code);
		targets.push({
			...targetFromCandidate(candidate, {
				name: pilotTarget?.name || "",
				rolloutMode: "hybrid-b-thin"
			}),
			auditedHistoricalOutsideMaxMeanWidthM:
				AUDITED_HYBRID_B_THIN.get(code)
		});
	}

	const hybridBClip = args.includeHybridBClip
		? (report.hybridCandidates || []).filter(isHybridBClip)
		: [];
	for (const candidate of hybridBClip) {
		const code = String(candidate.historicalCode);
		const pilotTarget = pilotByCode.get(code);
		targets.push({
			...targetFromCandidate(candidate, {
				name: pilotTarget?.name || "",
				rolloutMode: "hybrid-b-clip"
			}),
			auditedHistoricalClip: true
		});
	}

	const hybridCClip = args.includeHybridCClip
		? (report.hybridCandidates || []).filter(isHybridCClip)
		: [];
	for (const candidate of hybridCClip) {
		const code = String(candidate.historicalCode);
		const pilotTarget = pilotByCode.get(code);
		targets.push({
			...targetFromCandidate(candidate, {
				name: pilotTarget?.name || "",
				rolloutMode: "hybrid-c-clip"
			}),
			auditedHistoricalClip: true
		});
	}

	const hybridDClip = args.includeHybridDClip
		? (report.hybridCandidates || []).filter(isHybridDClip)
		: [];
	for (const candidate of hybridDClip) {
		const code = String(candidate.historicalCode);
		const pilotTarget = pilotByCode.get(code);
		targets.push({
			...targetFromCandidate(candidate, {
				name: pilotTarget?.name || "",
				rolloutMode: "hybrid-d-clip"
			}),
			auditedHistoricalClip: true
		});
	}

	const hybridEaveClip = args.includeHybridEaveClip
		? (report.hybridCandidates || []).filter((candidate) => (
			isHybridEaveClip(candidate, eaveAuditByCode)
		))
		: [];
	for (const candidate of hybridEaveClip) {
		const code = String(candidate.historicalCode);
		const pilotTarget = pilotByCode.get(code);
		const audit = eaveAuditByCode.get(code);
		targets.push({
			...targetFromCandidate(candidate, {
				name: pilotTarget?.name || "",
				rolloutMode: "hybrid-eave-clip"
			}),
			auditedHistoricalClip: true,
			auditedHeightMetric: "median-roof-surface-minimum",
			auditedHistoricalEaveHeightM:
				Number(audit.surfaceMinMedianHeightM.toFixed(3)),
			auditedHistoricalEaveDifferenceM:
				Number(audit.surfaceMinMedianHeightMDifferenceM.toFixed(3)),
			auditedHistoricalEaveToleranceM:
				Number(audit.productionToleranceM.toFixed(3))
		});
	}

	if (args.includeHybridEaveClip) {
		const reportResultsByCode = new Map(
			(report.results || [])
				.filter((item) => item.candidateType === "historical-code")
				.map((item) => [String(item.historicalCode), item])
		);
		for (const [code, audit] of AUDITED_PLAUSIBLE_EAVE_CLIP) {
			if (targets.some((target) => target.historicalCode === code)) continue;
			const candidate = reportResultsByCode.get(code);
			const metrics = candidate?.metrics || {};
			const currentKsIds = [
				...new Set(
					(candidate?.current?.ksIds || candidate?.ksIds || [])
						.map(String)
						.filter(Boolean)
				)
			].sort();
			const expectedKsIds = [...audit.ksIds].sort();
			const owners = [
				...new Set(
					(candidate?.ownerBwGebIds || candidate?.current?.ownerBwGebIds || [])
						.map(String)
						.filter(Boolean)
				)
			].sort();
			const sameCodeOwners = [
				...new Set(
					(candidate?.sameCodeOwnerBwGebIds || [])
						.map(String)
						.filter(Boolean)
				)
			].sort();
			const outsideM2 = historicalOutsideCurrentM2(candidate);
			const eaveMatchesCurrent = (
				Number.isFinite(Number(metrics.currentHeightM))
				&& Math.abs(
					Number(metrics.currentHeightM) - Number(audit.eaveHeightM)
				) <= Number(audit.eaveToleranceM)
			);
			if (
				!candidate
				|| candidate.method !== "historical-code"
				|| candidate.band !== "plausible"
				|| candidate.lod21?.hasPitchedRoof !== true
				|| owners.length !== 1
				|| owners[0] !== String(audit.bwGebId)
				|| sameCodeOwners.length !== 1
				|| sameCodeOwners[0] !== String(audit.bwGebId)
				|| Number(candidate.sameCodeMatchedParts || 0) !== 0
				|| JSON.stringify(currentKsIds) !== JSON.stringify(expectedKsIds)
				|| Number(metrics.iou) < Number(audit.minIou)
				|| Number(metrics.currentCoverage) < Number(audit.minCoverage)
				|| Number(metrics.oldCoverage) < Number(audit.minCoverage)
				|| Number(metrics.centroidDistanceM) > Number(audit.maxCentroidDistanceM)
				|| !Number.isFinite(outsideM2)
				|| outsideM2 > Number(audit.maxHistoricalOutsideM2)
				|| !eaveMatchesCurrent
			) {
				throw new Error(
					"Audited plausible eave-clip candidate changed: " + code
				);
			}
			targets.push({
				...targetFromCandidate({
					...candidate,
					ownerBwGebIds: [String(audit.bwGebId)],
					ksIds: expectedKsIds
				}, {
					rolloutMode: "hybrid-eave-clip"
				}),
				auditedHistoricalClip: true,
				auditedHeightMetric: "median-roof-surface-minimum",
				auditedHistoricalEaveHeightM: Number(audit.eaveHeightM),
				auditedHistoricalEaveDifferenceM: Number(audit.eaveDifferenceM),
				auditedHistoricalEaveToleranceM: Number(audit.eaveToleranceM)
			});
		}
	}

	const hybridHeightSplit = args.includeHybridHeightSplit
		? (report.hybridCandidates || []).filter((candidate) => (
			isHybridHeightSplit(candidate, eaveAuditByCode)
		))
		: [];
	for (const candidate of hybridHeightSplit) {
		const code = String(candidate.historicalCode);
		const pilotTarget = pilotByCode.get(code);
		const audit = AUDITED_HYBRID_HEIGHT_SPLIT.get(code);
		targets.push({
			...targetFromCandidate(candidate, {
				name: pilotTarget?.name || "",
				rolloutMode: "hybrid-height-split"
			}),
			auditedHistoricalClip: true,
			auditedHeightSplit: true,
			auditedHeightSplitToleranceM: HYBRID_HEIGHT_SPLIT_TOLERANCE_M,
			auditedProtectedKsIds: [...audit.protectedKsIds].sort(),
			auditedCompatibleKsIds: [...audit.compatibleKsIds].sort(),
			auditedClippedHistoricalAreaM2: audit.clippedHistoricalAreaM2,
			auditedRemovedHistoricalAreaM2: audit.removedHistoricalAreaM2,
			auditedRemainderAreaM2: audit.remainderAreaM2
		});
	}

	if (args.includeMaptoolkitRoofReplacements) {
		const replacements = Array.isArray(roofReplacements?.buildings)
			? roofReplacements.buildings
			: [];
		if (replacements.length !== expectedRoofReplacementCount) {
			throw new Error(
				"Maptoolkit roof replacement manifest count mismatch: "
				+ replacements.length + " buildings vs "
				+ expectedRoofReplacementCount + " declared"
			);
		}
		for (const replacement of replacements) {
			const code = String(replacement?.historicalCode || "").trim();
			const audit = replacement?.auditedMaptoolkitOverride;
			const signatures = Array.isArray(audit?.featureSignatures)
				? [...new Set(
					audit.featureSignatures
						.map((value) => String(value || "").trim().toLowerCase())
						.filter(Boolean)
				)].sort()
				: [];
			const featureTiles = Array.isArray(audit?.featureTiles)
				? audit.featureTiles
					.map((item) => ({
						tile: String(item?.tile || "").trim(),
						featureSignatures: [...new Set(
							Array.isArray(item?.featureSignatures)
								? item.featureSignatures
									.map((value) => (
										String(value || "").trim().toLowerCase()
									))
									.filter(Boolean)
								: []
						)].sort()
					}))
					.sort((a, b) => a.tile.localeCompare(b.tile))
				: [];
			const allFeatureSignatures = featureTiles.length
				? featureTiles.flatMap((item) => item.featureSignatures)
				: signatures;
			const replacementFeatureTile = featureTiles.find(
				(item) => item.tile === String(audit?.tile || "")
			);
			const featureTilesValid = !featureTiles.length || (
				featureTiles.length >= 2
				&& new Set(featureTiles.map((item) => item.tile)).size
					=== featureTiles.length
				&& featureTiles.every((item) => (
					/^15\/\d+\/\d+$/.test(item.tile)
					&& item.featureSignatures.length >= 1
					&& item.featureSignatures.every(
						(value) => /^[0-9a-f]{8}$/.test(value)
					)
				))
				&& new Set(allFeatureSignatures).size
					=== allFeatureSignatures.length
				&& replacementFeatureTile
				&& JSON.stringify(replacementFeatureTile.featureSignatures)
					=== JSON.stringify(signatures)
			);
			const clippedFootprintAudit = (
				String(audit?.auditClass || "")
				=== MAPTOOLKIT_CLIPPED_FOOTPRINT_AUDIT_CLASS
			);
			const clippedFootprintMetadataValid = !clippedFootprintAudit || (
				replacement?.clipHistoricalToCurrentFootprint === true
				&& replacement?.auditedHistoricalClip === true
				&& Number.isFinite(
					Number(replacement?.auditedOriginalHistoricalAreaM2)
				)
				&& Number.isFinite(
					Number(replacement?.auditedClippedHistoricalAreaM2)
				)
				&& Number.isFinite(
					Number(replacement?.auditedRemovedHistoricalAreaM2)
				)
				&& Number(replacement?.auditedRemovedHistoricalAreaM2) > 0
				&& Number(replacement?.auditedRemainderAreaM2) === 0
				&& Number.isFinite(
					Number(replacement?.auditedMaxDiscardedSliverWidthM)
				)
				&& Number(replacement?.auditedMaxDiscardedSliverWidthM)
					<= 0.0101
			);
			if (
				!code
				|| replacement?.rolloutMode !== "maptoolkit-roof-replacement"
				|| !String(replacement?.sheet || "").trim()
				|| !Number.isFinite(Number(replacement?.lng))
				|| !Number.isFinite(Number(replacement?.lat))
				|| !String(audit?.tile || "").match(/^15\/\d+\/\d+$/)
				|| signatures.length < 1
				|| allFeatureSignatures.length !== Number(audit?.featureCount)
				|| !signatures.every((value) => /^[0-9a-f]{8}$/.test(value))
				|| !featureTilesValid
				|| !clippedFootprintMetadataValid
				|| !isSafeMaptoolkitRoofCoverageAudit(audit)
				|| Number(audit?.flatVsHistoricalEaveM) < -0.25
				|| Number(audit?.flatVsHistoricalRidgeM) > 0.25
			) {
				throw new Error(
					"Invalid audited Maptoolkit roof replacement: " + code
				);
			}
			targets.push({
				...replacement,
				historicalCode: code,
				bwGebId: Number(replacement.bwGebId),
				ksIds: [...new Set(
					(replacement.ksIds || []).map(String).filter(Boolean)
				)].sort(),
				auditedMaptoolkitOverride: {
					...audit,
					featureSignatures: signatures,
					...(featureTiles.length ? { featureTiles } : {})
				}
			});
		}
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
	const hybridBThinCount = targets.filter(
		(target) => target.rolloutMode === "hybrid-b-thin"
	).length;
	const hybridBClipCount = targets.filter(
		(target) => target.rolloutMode === "hybrid-b-clip"
	).length;
	const hybridCClipCount = targets.filter(
		(target) => target.rolloutMode === "hybrid-c-clip"
	).length;
	const hybridDClipCount = targets.filter(
		(target) => target.rolloutMode === "hybrid-d-clip"
	).length;
	const hybridEaveClipCount = targets.filter(
		(target) => target.rolloutMode === "hybrid-eave-clip"
	).length;
	const hybridHeightSplitCount = targets.filter(
		(target) => target.rolloutMode === "hybrid-height-split"
	).length;
	const maptoolkitRoofReplacementCount = targets.filter(
		(target) => target.rolloutMode === "maptoolkit-roof-replacement"
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
			hybridCandidatesSelected:
				hybridACount
				+ hybridBAbsoluteCount
				+ hybridBThinCount
				+ hybridBClipCount
				+ hybridCClipCount
				+ hybridDClipCount
				+ hybridEaveClipCount
				+ hybridHeightSplitCount,
			hybridCandidatesDeferred:
				Number(report?.counts?.hybridCandidates || 0)
				- hybridACount
				- hybridBAbsoluteCount
				- hybridBThinCount
				- hybridBClipCount
				- hybridCClipCount
				- hybridDClipCount
				- hybridEaveClipCount
				- hybridHeightSplitCount,
			hybridBAbsoluteMaxHistoricalOutsideCurrentM2:
				HYBRID_B_ABSOLUTE_MAX_OUTSIDE_M2,
			hybridBThinMaxHistoricalOutsideMeanWidthM:
				HYBRID_B_THIN_MAX_MEAN_WIDTH_M,
			hybridEaveHeightMetric: "median-roof-surface-minimum",
			hybridEaveAuditGeneratedAt: eaveAudit.generatedAt || null,
			hybridHeightSplitToleranceM: HYBRID_HEIGHT_SPLIT_TOLERANCE_M,
			maptoolkitRoofReplacementSelected:
				maptoolkitRoofReplacementCount,
			maptoolkitRoofReplacementAuditGeneratedAt:
				roofReplacements?.generatedAt || null
		},
		counts: {
			total: targets.length,
			directStrong: directCount,
			hybridA: hybridACount,
			hybridBAbsolute: hybridBAbsoluteCount,
			hybridBThin: hybridBThinCount,
			hybridBClip: hybridBClipCount,
			hybridCClip: hybridCClipCount,
			hybridDClip: hybridDClipCount,
			hybridEaveClip: hybridEaveClipCount,
			hybridHeightSplit: hybridHeightSplitCount,
			maptoolkitRoofReplacement: maptoolkitRoofReplacementCount,
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
	if (hybridBThinCount !== (args.includeHybridBThin ? 3 : 0)) {
		throw new Error(
			"Expected " + (args.includeHybridBThin ? 3 : 0)
			+ " hybrid-b-thin targets, got " + hybridBThinCount
		);
	}
	if (hybridBClipCount !== (args.includeHybridBClip ? 7 : 0)) {
		throw new Error(
			"Expected " + (args.includeHybridBClip ? 7 : 0)
			+ " hybrid-b-clip targets, got " + hybridBClipCount
		);
	}
	if (hybridCClipCount !== (args.includeHybridCClip ? 169 : 0)) {
		throw new Error(
			"Expected " + (args.includeHybridCClip ? 169 : 0)
			+ " hybrid-c-clip targets, got " + hybridCClipCount
		);
	}
	if (hybridDClipCount !== (args.includeHybridDClip ? 169 : 0)) {
		throw new Error(
			"Expected " + (args.includeHybridDClip ? 169 : 0)
			+ " hybrid-d-clip targets, got " + hybridDClipCount
		);
	}
	if (hybridEaveClipCount !== (args.includeHybridEaveClip ? 27 : 0)) {
		throw new Error(
			"Expected " + (args.includeHybridEaveClip ? 27 : 0)
			+ " hybrid-eave-clip targets, got " + hybridEaveClipCount
		);
	}
	if (hybridHeightSplitCount !== (args.includeHybridHeightSplit ? 2 : 0)) {
		throw new Error(
			"Expected " + (args.includeHybridHeightSplit ? 2 : 0)
			+ " hybrid-height-split targets, got " + hybridHeightSplitCount
		);
	}
	if (maptoolkitRoofReplacementCount !== expectedRoofReplacementCount) {
		throw new Error(
			"Expected " + expectedRoofReplacementCount
			+ " Maptoolkit roof replacements, got "
			+ maptoolkitRoofReplacementCount
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
	const expectedTargets = args.includeMaptoolkitRoofReplacements
		? 2274 + expectedRoofReplacementCount
		: args.includeHybridHeightSplit
			? 2274
			: args.includeHybridEaveClip
			? 2272
			: args.includeHybridDClip
			? 2245
			: args.includeHybridCClip
			? 2076
			: args.includeHybridBClip
			? 1907
			: args.includeHybridBThin
			? 1900
			: args.includeHybridBAbsolute
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
