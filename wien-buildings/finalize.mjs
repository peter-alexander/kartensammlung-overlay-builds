#!/usr/bin/env node

import fsp from "node:fs/promises";
import path from "node:path";

const PUBLIC_TILE_BASE = "https://tiles.radlobby.at/WienBuildings";
const DEFAULT_PUBLISH_DIR = path.resolve("wien-buildings/build/WienBuildings");

function parseArgs(argv) {
	const result = {
		publishDir: DEFAULT_PUBLISH_DIR
	};

	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		const value = argv[index + 1];
		if (arg === "--publish-dir") {
			result.publishDir = path.resolve(value);
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return result;
}

async function listPbfTileKeys(tilesDir, zoom) {
	const zoomDir = path.join(tilesDir, String(zoom));
	let xEntries;
	try {
		xEntries = await fsp.readdir(zoomDir, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw error;
	}

	const keys = [];
	for (const xEntry of xEntries) {
		if (!xEntry.isDirectory() || !/^\d+$/.test(xEntry.name)) continue;
		const xDir = path.join(zoomDir, xEntry.name);
		const yEntries = await fsp.readdir(xDir, { withFileTypes: true });
		for (const yEntry of yEntries) {
			if (!yEntry.isFile()) continue;
			const match = yEntry.name.match(/^(\d+)\.pbf$/);
			if (!match) continue;
			keys.push(`${zoom}/${xEntry.name}/${match[1]}`);
		}
	}

	keys.sort((a, b) => {
		const aa = a.split("/").map(Number);
		const bb = b.split("/").map(Number);
		return aa[1] - bb[1] || aa[2] - bb[2];
	});
	return keys;
}

function assertRelease(release) {
	if (!release || typeof release !== "object") {
		throw new Error("release.json is not an object.");
	}
	if (!release.generatedAt) {
		throw new Error("release.json has no generatedAt timestamp.");
	}
	const vectorTiles = release.vectorTiles;
	if (!vectorTiles || vectorTiles.layer !== "wien_buildings") {
		throw new Error("release.json has no Wiener building vector-tile definition.");
	}
	if (Number(vectorTiles.minzoom) !== 12 || Number(vectorTiles.maxzoom) !== 15) {
		throw new Error("Unexpected Wiener building zoom range.");
	}
	if (
		!Array.isArray(vectorTiles.bounds)
		|| vectorTiles.bounds.length !== 4
		|| !vectorTiles.bounds.every(Number.isFinite)
	) {
		throw new Error("release.json has invalid bounds.");
	}
}

async function main() {
	const args = parseArgs(process.argv);
	const releasePath = path.join(args.publishDir, "release.json");
	const tilejsonPath = path.join(args.publishDir, "tilejson.json");
	const tilesDir = path.join(args.publishDir, "tiles");

	const release = JSON.parse(await fsp.readFile(releasePath, "utf8"));
	assertRelease(release);

	const tileKeysByZoom = {};
	for (let zoom = 12; zoom <= 15; zoom += 1) {
		const keys = await listPbfTileKeys(tilesDir, zoom);
		if (!keys.length) throw new Error(`No generated PBF tiles found for Z${zoom}.`);
		tileKeysByZoom[zoom] = keys;
	}

	const presentTilesZ15 = tileKeysByZoom[15];
	release.vectorTiles.presentTilesZ15 = presentTilesZ15;
	release.vectorTiles.tileCounts = Object.fromEntries(
		Object.entries(tileKeysByZoom).map(([zoom, keys]) => [zoom, keys.length])
	);

	const generatedAt = String(release.generatedAt);
	const bounds = release.vectorTiles.bounds;
	const tilejson = {
		tilejson: "3.0.0",
		name: "Wiener Gebäude – Baukörpermodell LOD0.4",
		scheme: "xyz",
		tiles: [
			`${PUBLIC_TILE_BASE}/tiles/{z}/{x}/{y}.pbf?v=${encodeURIComponent(generatedAt)}`
		],
		minzoom: 12,
		maxzoom: 15,
		bounds,
		attribution: "Stadt Wien – data.wien.gv.at, CC BY 4.0",
		vector_layers: [
			{
				id: "wien_buildings",
				fields: {
					render_height: "Number",
					render_min_height: "Number",
					F_KLASSE: "Number",
					BW_GEB_ID: "String",
					BEZUG: "String",
					FMZK_ID: "String"
				}
			}
		]
	};

	await Promise.all([
		fsp.writeFile(releasePath, JSON.stringify(release, null, "\t") + "\n", "utf8"),
		fsp.writeFile(tilejsonPath, JSON.stringify(tilejson, null, "\t") + "\n", "utf8")
	]);

	console.log(
		`Finalized Wiener building manifests: Z12=${tileKeysByZoom[12].length}, `
		+ `Z13=${tileKeysByZoom[13].length}, Z14=${tileKeysByZoom[14].length}, `
		+ `Z15=${presentTilesZ15.length}`
	);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
