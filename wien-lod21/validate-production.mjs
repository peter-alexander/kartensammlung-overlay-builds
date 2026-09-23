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
if (Number(release.counts.hybridA || 0) !== hybridA) {
	throw new Error(
		"Hybrid-A count mismatch: "
		+ hybridA + " vs release " + Number(release.counts.hybridA || 0)
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
					item.expectedRemainderM2 === null
						? "unknown"
						: item.expectedRemainderM2.toFixed(2) + "m²"
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
