#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "wien-lod21/build/WienBuildingsLOD21");
const release = JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8"));
const targets = JSON.parse(fs.readFileSync(path.join(root, "targets.json"), "utf8"));

if (release.status !== "production") {
	throw new Error("Expected production release, got " + release.status);
}
if (release.counts.targets !== 1213) {
	throw new Error("Expected 1213 targets, got " + release.counts.targets);
}
if (release.counts.directStrong !== 1209) {
	throw new Error("Expected 1209 direct targets, got " + release.counts.directStrong);
}
if (release.counts.manualPilotStrong !== 1) {
	throw new Error(
		"Expected 1 manual strong pilot exception, got "
		+ release.counts.manualPilotStrong
	);
}
if (release.counts.manualPilotHybrid !== 3) {
	throw new Error(
		"Expected 3 pilot hybrid exceptions, got "
		+ release.counts.manualPilotHybrid
	);
}
if (!Array.isArray(release.tiles?.presentTilesZ15) || !release.tiles.presentTilesZ15.length) {
	throw new Error("Production release has no Z15 tiles.");
}
if (targets.targets?.length !== 1213) {
	throw new Error("Target manifest size mismatch.");
}

for (const target of targets.targets) {
	if (!target.matches?.length) {
		throw new Error("Target has no CityGML match: " + target.historicalCode);
	}
	if (target.rolloutMode === "manual-pilot-hybrid") {
		for (const match of target.matches) {
			if (!(Number(match.hybridRemainder?.areaM2) > 0)) {
				throw new Error(
					"Hybrid pilot target has no embedded OGD remainder: "
					+ target.historicalCode
				);
			}
		}
	}
	if (!Array.isArray(target.ksIds) || !target.ksIds.length) {
		throw new Error("Target has no exact OGD KS_IDs: " + target.historicalCode);
	}
	for (const id of target.ksIds) {
		if (!/^wien-fmzk:/.test(String(id))) {
			throw new Error(
				"Invalid OGD KS_ID " + id + " for " + target.historicalCode
			);
		}
	}
}

const expectedPilots = new Set(["006973", "009238", "113842", "212535"]);
for (const target of targets.targets) {
	expectedPilots.delete(String(target.historicalCode));
}
if (expectedPilots.size) {
	throw new Error("Missing pilot targets: " + [...expectedPilots].join(", "));
}

console.log(JSON.stringify({
	status: release.status,
	counts: release.counts,
	sourceSheets: release.source.sheets.length,
	tiles: release.tiles.presentTilesZ15.length,
	vertices: release.counts.vertices,
	triangles: release.counts.triangles,
	releaseBytes: fs.statSync(path.join(root, "release.json")).size,
	targetManifestBytes: fs.statSync(path.join(root, "targets.json")).size
}, null, 2));
