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
if (items.length !== 1907) {
	throw new Error("Expected 1907 production targets, got " + items.length);
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
	if (target.rolloutMode === "hybrid-b-clip") {
		if (target.auditedHistoricalClip !== true) {
			throw new Error(
				"Hybrid-B clip target is not explicitly audited: "
				+ target.historicalCode
			);
		}
		const expectedRemovedM2 = Number(
			target.historicalOutsideCurrentM2
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
				"Hybrid-B clip area mismatch for "
				+ target.historicalCode + ": "
				+ removedM2 + " vs " + expectedRemovedM2
			);
		}
		if (!Number.isFinite(roofCoverage) || roofCoverage < 0.995) {
			throw new Error(
				"Hybrid-B clip roof coverage is incomplete for "
				+ target.historicalCode + ": " + roofCoverage
			);
		}
		if (!Number.isFinite(wallCoverage) || wallCoverage < 0.999) {
			throw new Error(
				"Hybrid-B clip wall coverage is incomplete for "
				+ target.historicalCode + ": " + wallCoverage
			);
		}
		if (
			!Number.isFinite(uncoveredBoundaryM)
			|| uncoveredBoundaryM > 0.01
		) {
			throw new Error(
				"Hybrid-B clip leaves uncovered boundary for "
				+ target.historicalCode + ": "
				+ uncoveredBoundaryM + " m"
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
