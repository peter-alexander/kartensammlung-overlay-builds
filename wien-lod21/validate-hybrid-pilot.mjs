#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "wien-lod21/build/WienBuildingsLOD21");
const release = JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8"));
const targets = JSON.parse(fs.readFileSync(path.join(root, "targets.json"), "utf8"));

if (release.status !== "hybrid-pilot") {
	throw new Error("Expected hybrid-pilot release, got " + release.status);
}
if (release.counts.targets !== 3 || release.counts.manualPilotHybrid !== 3) {
	throw new Error("Expected exactly 3 manual hybrid pilot targets.");
}
if (!Array.isArray(release.tiles?.presentTilesZ15) || !release.tiles.presentTilesZ15.length) {
	throw new Error("Hybrid pilot release has no Z15 tiles.");
}

const expectedCodes = new Set(["009238", "113842", "212535"]);
let remainderAreaM2 = 0;
let remainderFeatures = 0;
for (const target of targets.targets || []) {
	const code = String(target.historicalCode || "");
	expectedCodes.delete(code);
	if (target.rolloutMode !== "manual-pilot-hybrid") {
		throw new Error("Unexpected rollout mode for hybrid pilot " + code + ": " + target.rolloutMode);
	}
	if (!target.matches?.length) {
		throw new Error("Hybrid pilot target has no CityGML match: " + code);
	}
	for (const match of target.matches) {
		const remainder = match.hybridRemainder;
		if (!(Number(remainder?.areaM2) > 0)) {
			throw new Error("Hybrid pilot target has no OGD remainder geometry: " + code);
		}
		if (!(Number(remainder?.featureCount) > 0)) {
			throw new Error("Hybrid pilot target has no OGD remainder features: " + code);
		}
		if (!Array.isArray(remainder?.ksIds) || !remainder.ksIds.length) {
			throw new Error("Hybrid pilot target has no OGD remainder KS_IDs: " + code);
		}
		remainderAreaM2 += Number(remainder.areaM2);
		remainderFeatures += Number(remainder.featureCount);
	}
}
if (expectedCodes.size) {
	throw new Error("Missing hybrid pilot targets: " + [...expectedCodes].join(", "));
}

console.log(JSON.stringify({
	status: release.status,
	targets: release.counts.targets,
	tiles: release.tiles.presentTilesZ15.length,
	vertices: release.counts.vertices,
	triangles: release.counts.triangles,
	hybridRemainderFeatures: remainderFeatures,
	hybridRemainderAreaM2: Number(remainderAreaM2.toFixed(3))
}, null, 2));
