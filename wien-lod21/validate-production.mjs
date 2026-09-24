#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(
	process.argv[2] || "wien-lod21/build/WienBuildingsLOD21"
);
const release = JSON.parse(
	fs.readFileSync(path.join(root, "release.json"), "utf8")
);
const targets = JSON.parse(
	fs.readFileSync(path.join(root, "targets.json"), "utf8")
);
const items = Array.isArray(targets.targets) ? targets.targets : [];
const roofReplacementManifest = JSON.parse(
	fs.readFileSync(
		new URL("./maptoolkit-roof-overrides.production.json", import.meta.url),
		"utf8"
	)
);
const auditedRoofReplacementBuildings =
	Array.isArray(roofReplacementManifest?.buildings)
		? roofReplacementManifest.buildings
		: [];
const EXPECTED_MAPTOOLKIT_ROOF_REPLACEMENTS =
	auditedRoofReplacementBuildings.length;
if (
	Number(roofReplacementManifest?.count)
	!== EXPECTED_MAPTOOLKIT_ROOF_REPLACEMENTS
) {
	throw new Error(
		"Roof replacement manifest count mismatch: "
		+ roofReplacementManifest?.count + " vs "
		+ EXPECTED_MAPTOOLKIT_ROOF_REPLACEMENTS
	);
}

if (release.status !== "production") {
	throw new Error("Expected production release, got " + release.status);
}
if (!items.length) {
	throw new Error("Production target manifest is empty.");
}
if (release.counts.targets !== items.length) {
	throw new Error(
		"Release/manifest target count mismatch: "
		+ release.counts.targets + " vs " + items.length
	);
}
if (!Array.isArray(release.tiles?.presentTilesZ15) || !release.tiles.presentTilesZ15.length) {
	throw new Error("Production release has no Z15 tiles.");
}

const countMode = (mode) => items.filter(
	(target) => target.rolloutMode === mode
).length;
const directStrong = countMode("direct-strong");
const hybridA = countMode("hybrid-a");
const hybridBAbsolute = countMode("hybrid-b-absolute");
const hybridBThin = countMode("hybrid-b-thin");
const hybridBClip = countMode("hybrid-b-clip");
const hybridCClip = countMode("hybrid-c-clip");
const hybridDClip = countMode("hybrid-d-clip");
const hybridEaveClip = countMode("hybrid-eave-clip");
const hybridHeightSplit = countMode("hybrid-height-split");
const maptoolkitRoofReplacement = countMode("maptoolkit-roof-replacement");
const manualPilotStrong = countMode("manual-pilot-strong");
const manualPilotHybrid = countMode("manual-pilot-hybrid");

if (directStrong !== 1209 || release.counts.directStrong !== directStrong) {
	throw new Error(
		"Expected 1209 direct-strong targets, got "
		+ directStrong + " / release " + release.counts.directStrong
	);
}
if (manualPilotStrong !== 1 || release.counts.manualPilotStrong !== 1) {
	throw new Error(
		"Expected one manual strong pilot, got "
		+ manualPilotStrong + " / release " + release.counts.manualPilotStrong
	);
}
if (hybridA !== 614 || Number(release.counts.hybridA || 0) !== hybridA) {
	throw new Error(
		"Expected 614 Hybrid-A targets, got "
		+ hybridA + " / release " + Number(release.counts.hybridA || 0)
	);
}
if (
	hybridBAbsolute !== 72
	|| Number(release.counts.hybridBAbsolute || 0) !== hybridBAbsolute
) {
	throw new Error(
		"Expected 72 absolute-safe Hybrid-B targets, got "
		+ hybridBAbsolute + " / release "
		+ Number(release.counts.hybridBAbsolute || 0)
	);
}
if (
	hybridBThin !== 3
	|| Number(release.counts.hybridBThin || 0) !== hybridBThin
) {
	throw new Error(
		"Expected 3 audited thin Hybrid-B targets, got "
		+ hybridBThin + " / release "
		+ Number(release.counts.hybridBThin || 0)
	);
}
if (
	hybridBClip !== 7
	|| Number(release.counts.hybridBClip || 0) !== hybridBClip
) {
	throw new Error(
		"Expected 7 audited clipped Hybrid-B targets, got "
		+ hybridBClip + " / release "
		+ Number(release.counts.hybridBClip || 0)
	);
}
if (
	hybridCClip !== 169
	|| Number(release.counts.hybridCClip || 0) !== hybridCClip
) {
	throw new Error(
		"Expected 169 audited clipped Hybrid-C targets, got "
		+ hybridCClip + " / release "
		+ Number(release.counts.hybridCClip || 0)
	);
}
if (
	hybridDClip !== 169
	|| Number(release.counts.hybridDClip || 0) !== hybridDClip
) {
	throw new Error(
		"Expected 169 audited clipped Hybrid-D targets, got "
		+ hybridDClip + " / release "
		+ Number(release.counts.hybridDClip || 0)
	);
}
if (
	hybridEaveClip !== 26
	|| Number(release.counts.hybridEaveClip || 0) !== hybridEaveClip
) {
	throw new Error(
		"Expected 26 audited eave-corrected clip targets, got "
		+ hybridEaveClip + " / release "
		+ Number(release.counts.hybridEaveClip || 0)
	);
}
if (
	hybridHeightSplit !== 2
	|| Number(release.counts.hybridHeightSplit || 0) !== hybridHeightSplit
) {
	throw new Error(
		"Expected 2 audited height-split targets, got "
		+ hybridHeightSplit + " / release "
		+ Number(release.counts.hybridHeightSplit || 0)
	);
}
if (
	maptoolkitRoofReplacement !== EXPECTED_MAPTOOLKIT_ROOF_REPLACEMENTS
	|| Number(release.counts.maptoolkitRoofReplacement || 0)
		!== maptoolkitRoofReplacement
) {
	throw new Error(
		"Expected " + EXPECTED_MAPTOOLKIT_ROOF_REPLACEMENTS
		+ " audited Maptoolkit roof replacements, got "
		+ maptoolkitRoofReplacement + " / release "
		+ Number(release.counts.maptoolkitRoofReplacement || 0)
	);
}
const expectedProductionTargets =
	2273 + EXPECTED_MAPTOOLKIT_ROOF_REPLACEMENTS;
if (items.length !== expectedProductionTargets) {
	throw new Error(
		"Expected " + expectedProductionTargets
		+ " production targets, got " + items.length
	);
}

const releaseRoofOverrides =
	Array.isArray(release.maptoolkitRoofOverrides?.targets)
		? release.maptoolkitRoofOverrides.targets
		: [];
if (
	release.maptoolkitRoofOverrides?.mode
	!== "fail-safe-feature-fingerprint"
	|| releaseRoofOverrides.length
		!== EXPECTED_MAPTOOLKIT_ROOF_REPLACEMENTS
) {
	throw new Error(
		"Expected " + EXPECTED_MAPTOOLKIT_ROOF_REPLACEMENTS
		+ " fail-safe Maptoolkit roof override release entries."
	);
}
if (Number(release.counts.manualPilotHybrid || 0) !== manualPilotHybrid) {
	throw new Error(
		"Manual hybrid count mismatch: "
		+ manualPilotHybrid + " vs release "
		+ Number(release.counts.manualPilotHybrid || 0)
	);
}

const hybrid = items.filter((target) => (
	target.rolloutMode === "hybrid-a"
	|| target.rolloutMode === "hybrid-b-absolute"
	|| target.rolloutMode === "hybrid-b-thin"
	|| target.rolloutMode === "hybrid-b-clip"
	|| target.rolloutMode === "hybrid-c-clip"
	|| target.rolloutMode === "hybrid-d-clip"
	|| target.rolloutMode === "hybrid-eave-clip"
	|| target.rolloutMode === "hybrid-height-split"
	|| target.rolloutMode === "manual-pilot-hybrid"
));
let remainderTargets = 0;
const missingMeaningfulRemainders = [];

for (const target of items) {
	if (!target.matches?.length) {
		throw new Error(
			"Target has no CityGML match: " + target.historicalCode
		);
	}
	if (!Array.isArray(target.ksIds) || !target.ksIds.length) {
		throw new Error(
			"Target has no exact OGD KS_IDs: " + target.historicalCode
		);
	}
	for (const id of target.ksIds) {
		if (!/^wien-fmzk:/.test(String(id))) {
			throw new Error(
				"Invalid OGD KS_ID " + id
				+ " for " + target.historicalCode
			);
		}
	}

	if (target.rolloutMode === "hybrid-b-absolute") {
		const outsideM2 = Number(target.historicalOutsideCurrentM2);
		if (!Number.isFinite(outsideM2) || outsideM2 > 0.5801) {
			throw new Error(
				"Hybrid-B absolute footprint mismatch exceeds 0.58 m² for "
				+ target.historicalCode + ": " + outsideM2
			);
		}
	}
	if (target.rolloutMode === "hybrid-b-thin") {
		const maxWidthM = Number(
			target.auditedHistoricalOutsideMaxMeanWidthM
		);
		if (!Number.isFinite(maxWidthM) || maxWidthM > 0.0501) {
			throw new Error(
				"Hybrid-B thin overhang exceeds 5 cm for "
				+ target.historicalCode + ": " + maxWidthM
			);
		}
	}
	if (
		target.rolloutMode === "hybrid-b-clip"
		|| target.rolloutMode === "hybrid-c-clip"
		|| target.rolloutMode === "hybrid-d-clip"
		|| target.rolloutMode === "hybrid-eave-clip"
		|| target.rolloutMode === "hybrid-height-split"
	) {
		if (target.auditedHistoricalClip !== true) {
			throw new Error(
				"Hybrid clip target is not explicitly audited: "
				+ target.historicalCode
			);
		}
		const expectedRemovedM2 = Number(
			target.rolloutMode === "hybrid-height-split"
				? target.auditedRemovedHistoricalAreaM2
				: target.historicalOutsideCurrentM2
		);
		const clip = target.historicalClip;
		const removedM2 = Number(clip?.removedHistoricalAreaM2);
		const roofCoverage = Number(clip?.minRoofCoverageRatio);
		const wallCoverage = Number(
			clip?.geometricWallBoundaryCoverageRatio
		);
		const uncoveredBoundaryM = Number(
			clip?.uncoveredWallBoundaryLengthM
		);
		if (
			!Number.isFinite(expectedRemovedM2)
			|| !Number.isFinite(removedM2)
			|| Math.abs(removedM2 - expectedRemovedM2) > 0.05
		) {
			throw new Error(
				"Hybrid clip area mismatch for "
				+ target.historicalCode + ": "
				+ removedM2 + " vs " + expectedRemovedM2
			);
		}
		if (!Number.isFinite(roofCoverage) || roofCoverage < 0.995) {
			throw new Error(
				"Hybrid clip roof coverage is incomplete for "
				+ target.historicalCode + ": " + roofCoverage
			);
		}
		if (!Number.isFinite(wallCoverage) || wallCoverage < 0.999) {
			throw new Error(
				"Hybrid clip wall coverage is incomplete for "
				+ target.historicalCode + ": " + wallCoverage
			);
		}
		if (
			!Number.isFinite(uncoveredBoundaryM)
			|| uncoveredBoundaryM > 0.01
		) {
			throw new Error(
				"Hybrid clip leaves uncovered boundary for "
				+ target.historicalCode + ": "
				+ uncoveredBoundaryM + " m"
			);
		}
		const maxSliverHoleWidthM = Number(
			clip?.maxRemovedInteriorSliverHoleMeanWidthM || 0
		);
		if (
			!Number.isFinite(maxSliverHoleWidthM)
			|| maxSliverHoleWidthM > 0.0501
		) {
			throw new Error(
				"Hybrid clip removed an interior hole wider than 5 cm for "
				+ target.historicalCode + ": "
				+ maxSliverHoleWidthM + " m"
			);
		}
	}

	if (target.rolloutMode === "maptoolkit-roof-replacement") {
		const audit = target.auditedMaptoolkitOverride;
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
		const auditClass = String(
			audit?.auditClass || "complete-flat-hit"
		);
		const featureAudit = Array.isArray(audit?.featureAudit)
			? audit.featureAudit
			: [];
		const featureAuditSignatures = featureAudit
			.map((item) => String(item?.signature || "").toLowerCase())
			.sort();
		const exactFootprintFlatOnly = (
			auditClass === "exact-footprint-flat-only"
			&& Number(audit?.flatHitPercent) >= 80
			&& Number(audit?.flatHitPercent) < 100
			&& Number(audit?.pitchedHitPercent) === 0
			&& Number(audit?.unmatchedReplacementPoints) >= 1
			&& Number(audit?.unmatchedReplacementPoints) <= 2
			&& Number(audit?.currentCoverage) >= 0.998
			&& Number(audit?.historicalCoverage) >= 0.998
			&& Number(audit?.centroidDistanceM) <= 0.10
			&& featureAudit.length === allFeatureSignatures.length
			&& JSON.stringify(featureAuditSignatures)
				=== JSON.stringify([...allFeatureSignatures].sort())
			&& featureAudit.every((item) => (
				Number(item?.flatRoofSurfaces) >= 1
				&& Number(item?.pitchedRoofSurfaces) === 0
				&& item?.touchesTileEdge === false
			))
		);
		const coverageAuditValid = (
			(
				auditClass === "complete-flat-hit"
				&& Number(audit?.flatHitPercent) === 100
			)
			|| exactFootprintFlatOnly
		);
		if (
			!audit
			|| !/^15\/\d+\/\d+$/.test(String(audit.tile || ""))
			|| signatures.length < 1
			|| allFeatureSignatures.length !== Number(audit.featureCount)
			|| !signatures.every((value) => /^[0-9a-f]{8}$/.test(value))
			|| !featureTilesValid
			|| !coverageAuditValid
			|| Number(audit.flatVsHistoricalEaveM) < -0.25
			|| Number(audit.flatVsHistoricalRidgeM) > 0.25
		) {
			throw new Error(
				"Invalid Maptoolkit roof replacement audit for "
				+ target.historicalCode
			);
		}
		const releaseEntry = releaseRoofOverrides.find(
			(item) => (
				String(item.historicalCode) === String(target.historicalCode)
			)
		);
		const releaseFeatureTiles = Array.isArray(releaseEntry?.featureTiles)
			? releaseEntry.featureTiles
				.map((item) => ({
					tile: String(item?.tile || ""),
					featureSignatures: [...new Set(
						item?.featureSignatures || []
					)].map(String).sort()
				}))
				.sort((a, b) => a.tile.localeCompare(b.tile))
			: [];
		const expectedOgdKsIds = [...new Set(target.ksIds || [])]
			.map(String)
			.sort();
		const releaseOgdKsIds = [...new Set(releaseEntry?.ogdKsIds || [])]
			.map(String)
			.sort();
		if (
			!releaseEntry
			|| String(releaseEntry.tile) !== String(audit.tile)
			|| String(releaseEntry.bwGebId) !== String(target.bwGebId)
			|| JSON.stringify(
				[...(releaseEntry.featureSignatures || [])].map(String).sort()
			) !== JSON.stringify(signatures)
			|| (
				featureTiles.length
				&& JSON.stringify(releaseFeatureTiles)
					!== JSON.stringify(featureTiles)
			)
			|| (
				featureTiles.length
				&& JSON.stringify(releaseOgdKsIds)
					!== JSON.stringify(expectedOgdKsIds)
			)
		) {
			throw new Error(
				"Maptoolkit roof replacement release fingerprint mismatch for "
				+ target.historicalCode
			);
		}
	}

		if (target.rolloutMode === "hybrid-eave-clip") {
		if (target.auditedHeightMetric !== "median-roof-surface-minimum") {
			throw new Error(
				"Unexpected eave height metric for "
				+ target.historicalCode
			);
		}
		const eaveHeightM = Number(target.auditedHistoricalEaveHeightM);
		const eaveDifferenceM = Number(
			target.auditedHistoricalEaveDifferenceM
		);
		const eaveToleranceM = Number(
			target.auditedHistoricalEaveToleranceM
		);
		if (
			!Number.isFinite(eaveHeightM)
			|| !Number.isFinite(eaveDifferenceM)
			|| !Number.isFinite(eaveToleranceM)
			|| eaveDifferenceM > eaveToleranceM + 1e-9
		) {
			throw new Error(
				"Invalid audited eave height for "
				+ target.historicalCode
			);
		}
	}

	if (target.rolloutMode === "hybrid-height-split") {
		if (
			target.auditedHeightSplit !== true
			|| Number(target.auditedHeightSplitToleranceM) !== 0.25
		) {
			throw new Error(
				"Invalid audited height split metadata for "
				+ target.historicalCode
			);
		}
		const split = target.historicalClip?.heightSplit;
		if (
			!split
			|| Number(split.toleranceM) !== 0.25
			|| Number(split.protectedParts) < 1
			|| Number(split.compatibleParts) < 1
		) {
			throw new Error(
				"Missing or invalid runtime height split for "
				+ target.historicalCode
			);
		}
		const actualProtected = (split.parts || [])
			.filter((part) => part.protectedCurrent)
			.map((part) => String(part.ksId))
			.sort();
		const expectedProtected = [
			...(target.auditedProtectedKsIds || [])
		].map(String).sort();
		const actualCompatible = (split.parts || [])
			.filter((part) => !part.protectedCurrent)
			.map((part) => String(part.ksId))
			.sort();
		const expectedCompatible = [
			...(target.auditedCompatibleKsIds || [])
		].map(String).sort();
		if (
			JSON.stringify(actualProtected) !== JSON.stringify(expectedProtected)
			|| JSON.stringify(actualCompatible)
				!== JSON.stringify(expectedCompatible)
		) {
			throw new Error(
				"Height split KS_ID partition changed for "
				+ target.historicalCode
			);
		}
		for (const part of split.parts || []) {
			const delta = part.roofDeltaM === null
				? null
				: Number(part.roofDeltaM);
			if (
				part.protectedCurrent
				&& part.historicalMaxRoofZ !== null
				&& !(delta > 0.25)
			) {
				throw new Error(
					"Protected height-split part is below threshold for "
					+ target.historicalCode + ": " + part.ksId
				);
			}
			if (
				!part.protectedCurrent
				&& part.historicalMaxRoofZ !== null
				&& delta > 0.2501
			) {
				throw new Error(
					"Compatible height-split part exceeds threshold for "
					+ target.historicalCode + ": " + part.ksId
				);
			}
		}
		const clippedAreaM2 = Number(
			target.historicalClip?.clippedHistoricalAreaM2
		);
		const expectedClippedAreaM2 = Number(
			target.auditedClippedHistoricalAreaM2
		);
		const remainderAreaM2 = Number(
			target.hybridRemainder?.remainderAreaM2
		);
		const expectedRemainderAreaM2 = Number(
			target.auditedRemainderAreaM2
		);
		if (
			!Number.isFinite(clippedAreaM2)
			|| !Number.isFinite(expectedClippedAreaM2)
			|| Math.abs(clippedAreaM2 - expectedClippedAreaM2) > 0.05
			|| !Number.isFinite(remainderAreaM2)
			|| !Number.isFinite(expectedRemainderAreaM2)
			|| Math.abs(remainderAreaM2 - expectedRemainderAreaM2) > 0.05
		) {
			throw new Error(
				"Height split audited area changed for "
				+ target.historicalCode
			);
		}
	}

	if (!hybrid.includes(target)) continue;
	const syntheticObjects = Number(
		target.hybridRemainder?.syntheticObjects || 0
	);
	if (syntheticObjects > 0) {
		remainderTargets += 1;
		continue;
	}

	const rawRemainderAreaM2 = Number(
		target.hybridRemainder?.rawRemainderAreaM2 || 0
	);
	const discardedSliverAreaM2 = Number(
		target.hybridRemainder?.discardedSliverAreaM2 || 0
	);
	const maxDiscardedSliverWidthM = Number(
		target.hybridRemainder?.maxDiscardedSliverWidthM || 0
	);
	const unaccountedAreaM2 = Math.max(
		0,
		rawRemainderAreaM2 - discardedSliverAreaM2
	);
	if (
		unaccountedAreaM2 > 0.01
		|| maxDiscardedSliverWidthM > 0.0501
	) {
		missingMeaningfulRemainders.push({
			code: target.historicalCode,
			rawRemainderAreaM2,
			discardedSliverAreaM2,
			maxDiscardedSliverWidthM,
			unaccountedAreaM2
		});
	}
}

if (missingMeaningfulRemainders.length) {
	throw new Error(
		"Hybrid targets missing meaningful remainder meshes: "
		+ missingMeaningfulRemainders.slice(0, 20)
			.map((item) => (
				item.code + "("
				+ (
					Number.isFinite(item.rawRemainderAreaM2)
						? item.rawRemainderAreaM2.toFixed(2) + "m² raw"
						: "unknown"
				)
				+ ")"
			))
			.join(", ")
	);
}
if (Number(release.counts.hybridRemainderTargets || 0) !== remainderTargets) {
	throw new Error(
		"Hybrid remainder count mismatch: "
		+ remainderTargets + " vs release "
		+ Number(release.counts.hybridRemainderTargets || 0)
	);
}

const expectedPilots = new Set(["006973", "009238", "113842", "212535"]);
for (const target of items) {
	expectedPilots.delete(String(target.historicalCode));
}
if (expectedPilots.size) {
	throw new Error(
		"Missing pilot targets: " + [...expectedPilots].join(", ")
	);
}

console.log(JSON.stringify({
	status: release.status,
	counts: release.counts,
	rolloutModes: {
		directStrong,
		hybridA,
		hybridBAbsolute,
		hybridBThin,
		hybridBClip,
		hybridCClip,
		hybridDClip,
		hybridEaveClip,
		hybridHeightSplit,
		maptoolkitRoofReplacement,
		manualPilotStrong,
		manualPilotHybrid
	},
	hybrid: {
		targets: hybrid.length,
		remainderTargets,
		tinyRemainderTargets: hybrid.length - remainderTargets
	},
	sourceSheets: release.source.sheets.length,
	tiles: release.tiles.presentTilesZ15.length,
	vertices: release.counts.vertices,
	triangles: release.counts.triangles,
	releaseBytes: fs.statSync(path.join(root, "release.json")).size,
	targetManifestBytes: fs.statSync(path.join(root, "targets.json")).size
}, null, 2));
