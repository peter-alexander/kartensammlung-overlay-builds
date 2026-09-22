#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import earcut from "earcut";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

const RELEASE_URL = "https://tiles.radlobby.at/WienBuildings/release.json";
const OGD_TILE_URL = "https://tiles.radlobby.at/WienBuildings/tiles/{z}/{x}/{y}.pbf";
const MTK_TILE_URL = "https://mtk.wien.gv.at/dataconnector/wien/buildings3d/{z}/{x}/{y}.pbf";
const ZOOM = 15;
const GRID_SIZE = 64;
const CONCURRENCY = 12;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.68557849;

const KNOWN_TARGETS = [
	{ name: "Straussengasse 2-10", lng: 16.362449, lat: 48.191404 },
	{ name: "Straussengasse 12", lng: 16.362021, lat: 48.191684 },
	{ name: "Straussengasse 14", lng: 16.361881, lat: 48.191824 },
	{ name: "TU Wien Karlsplatz 13", lng: 16.369902, lat: 48.198897 },
	{ name: "WKO Wiedner Hauptstrasse 63", lng: 16.366988, lat: 48.190398 }
];

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function tileKey(tile) {
	return `${tile.z}/${tile.x}/${tile.y}`;
}

function tileUrl(template, tile) {
	return template
		.replace("{z}", String(tile.z))
		.replace("{x}", String(tile.x))
		.replace("{y}", String(tile.y));
}

function lngToWorldX(lng, zoom) {
	return (Number(lng) + 180) / 360 * 2 ** zoom;
}

function latToWorldY(lat, zoom) {
	const radians = clamp(Number(lat), -85.05112878, 85.05112878) * Math.PI / 180;
	return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom;
}

function tilePointLngLat(tile, x, y) {
	const n = 2 ** tile.z;
	const worldX = (tile.x + x) / n;
	const worldY = (tile.y + y) / n;
	return {
		lng: worldX * 360 - 180,
		lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180 / Math.PI
	};
}

function localPointForLngLat(tile, lng, lat) {
	return {
		x: lngToWorldX(lng, tile.z) - tile.x,
		y: latToWorldY(lat, tile.z) - tile.y
	};
}

function openRing(ring) {
	const out = [];
	for (const point of ring || []) {
		const next = { x: Number(point.x), y: Number(point.y), z: Number(point.z || 0) };
		if (
			!out.length
			|| out[out.length - 1].x !== next.x
			|| out[out.length - 1].y !== next.y
			|| out[out.length - 1].z !== next.z
		) out.push(next);
	}
	if (
		out.length > 1
		&& out[0].x === out[out.length - 1].x
		&& out[0].y === out[out.length - 1].y
		&& out[0].z === out[out.length - 1].z
	) out.pop();
	return out;
}

function signedArea2D(ring) {
	let area = 0;
	for (let i = 0; i < ring.length; i += 1) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}

function classifyPolygons(rings, extent) {
	const polygons = [];
	let polygon = null;
	let outerClockwise = null;
	for (const raw of rings || []) {
		const ring = openRing(raw).map((point) => ({
			x: point.x / extent,
			y: point.y / extent
		}));
		if (ring.length < 3) continue;
		const area = signedArea2D(ring);
		if (!area) continue;
		if (outerClockwise === null) outerClockwise = area < 0;
		if ((area < 0) === outerClockwise) {
			polygon = [ring];
			polygons.push(polygon);
		} else if (polygon) {
			polygon.push(ring);
		}
	}
	return polygons;
}

function pointInRing(point, ring) {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i];
		const b = ring[j];
		if (
			(a.y > point.y) !== (b.y > point.y)
			&& point.x < (
				(b.x - a.x) * (point.y - a.y)
				/ ((b.y - a.y) || Number.EPSILON)
				+ a.x
			)
		) inside = !inside;
	}
	return inside;
}

function polygonContainsPoint(polygon, point) {
	if (!polygon?.length || !pointInRing(point, polygon[0])) return false;
	for (let i = 1; i < polygon.length; i += 1) {
		if (pointInRing(point, polygon[i])) return false;
	}
	return true;
}

function polygonBounds(polygons) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const polygon of polygons) {
		for (const ring of polygon) {
			for (const point of ring) {
				minX = Math.min(minX, point.x);
				minY = Math.min(minY, point.y);
				maxX = Math.max(maxX, point.x);
				maxY = Math.max(maxY, point.y);
			}
		}
	}
	return { minX, minY, maxX, maxY };
}

function cellIndex(value) {
	return clamp(Math.floor(value * GRID_SIZE), 0, GRID_SIZE - 1);
}

function addFeatureToGrid(grid, index, bounds) {
	const minX = cellIndex(bounds.minX);
	const maxX = cellIndex(bounds.maxX);
	const minY = cellIndex(bounds.minY);
	const maxY = cellIndex(bounds.maxY);
	for (let x = minX; x <= maxX; x += 1) {
		for (let y = minY; y <= maxY; y += 1) {
			const key = y * GRID_SIZE + x;
			let bucket = grid.get(key);
			if (!bucket) {
				bucket = [];
				grid.set(key, bucket);
			}
			bucket.push(index);
		}
	}
}

function gridCandidates(grid, point) {
	return grid.get(cellIndex(point.y) * GRID_SIZE + cellIndex(point.x)) || [];
}

function decodeGeometry3D(feature) {
	const pbf = feature?._pbf;
	const geometryOffset = Number(feature?._geometry);
	if (!pbf || !Number.isFinite(geometryOffset) || geometryOffset < 0) return [];

	pbf.pos = geometryOffset;
	const end = pbf.readVarint() + pbf.pos;
	const groups = [];
	let group = [];
	let currentPath = null;
	let command = 1;
	let commandLength = 0;
	let x = 0;
	let y = 0;
	let z = 0;

	while (pbf.pos < end) {
		if (commandLength <= 0) {
			const commandAndLength = pbf.readVarint();
			command = commandAndLength & 0x7;
			commandLength = commandAndLength >> 3;
		}
		commandLength -= 1;

		if (command === 1 || command === 2) {
			if (command === 1) currentPath = [];
			x += pbf.readSVarint();
			y += pbf.readSVarint();
			z += pbf.readSVarint();
			currentPath.push({ x, y, z });
		} else if (command === 7) {
			if (!currentPath?.length) break;
			if (commandLength > 0) {
				group.push(currentPath);
				groups.push(group);
				group = [];
				commandLength -= 1;
			} else if (groups.length) {
				groups[groups.length - 1].push(currentPath);
			} else {
				groups.push([currentPath]);
			}
		} else {
			break;
		}
	}
	return groups;
}

function getSurfaceGroups(groups) {
	const metadata = openRing(groups?.[0]?.[0]);
	return metadata.length === 2 ? groups.slice(1) : groups;
}

function newellUpFraction(ring, xyMetersPerUnit) {
	const points = openRing(ring);
	if (points.length < 3) return 0;
	let nx = 0;
	let ny = 0;
	let nz = 0;
	for (let i = 0; i < points.length; i += 1) {
		const current = {
			x: points[i].x * xyMetersPerUnit,
			y: points[i].y * xyMetersPerUnit,
			z: points[i].z / 10
		};
		const nextRaw = points[(i + 1) % points.length];
		const next = {
			x: nextRaw.x * xyMetersPerUnit,
			y: nextRaw.y * xyMetersPerUnit,
			z: nextRaw.z / 10
		};
		nx += (current.y - next.y) * (current.z + next.z);
		ny += (current.z - next.z) * (current.x + next.x);
		nz += (current.x - next.x) * (current.y + next.y);
	}
	const length = Math.hypot(nx, ny, nz);
	return length > 1e-9 ? Math.abs(nz) / length : 0;
}

function interiorPolygonPoint(polygon) {
	const rings = (polygon || []).filter((ring) => ring.length >= 3);
	if (!rings.length) return null;

	const flat = [];
	const holes = [];
	let vertexCount = 0;
	for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
		if (ringIndex > 0) holes.push(vertexCount);
		for (const point of rings[ringIndex]) {
			flat.push(point.x, point.y);
			vertexCount += 1;
		}
	}
	const triangles = earcut(flat, holes, 2);
	if (triangles.length < 3) return null;
	const a = triangles[0] * 2;
	const b = triangles[1] * 2;
	const c = triangles[2] * 2;
	return {
		x: (flat[a] + flat[b] + flat[c]) / 3,
		y: (flat[a + 1] + flat[b + 1] + flat[c + 1]) / 3
	};
}

function normalizeSurfacePolygon(surface, extent) {
	const rings = (surface || [])
		.map(openRing)
		.filter((ring) => ring.length >= 3)
		.map((ring) => ring.map((point) => ({
			x: point.x / extent,
			y: point.y / extent
		})));
	return rings.length ? rings : null;
}

function extractLod2Surfaces(buffer, tile) {
	const vectorTile = new VectorTile(new PbfReader(buffer));
	const layer = vectorTile.layers?.buildings3d;
	if (!layer?.length) return [];

	const extent = Number(layer.extent) || 4096;
	const centerLat = tilePointLngLat(tile, 0.5, 0.5).lat * Math.PI / 180;
	const tileWidthM = EARTH_CIRCUMFERENCE_METERS * Math.cos(centerLat) / 2 ** tile.z;
	const xyMetersPerUnit = tileWidthM / extent;
	const surfaces = [];

	for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
		const feature = layer.feature(featureIndex);
		const groups = decodeGeometry3D(feature);
		for (const surface of getSurfaceGroups(groups)) {
			const contour = surface?.[0];
			if (!contour || newellUpFraction(contour, xyMetersPerUnit) < 0.12) continue;
			const polygon = normalizeSurfacePolygon(surface, extent);
			if (!polygon) continue;
			const point = interiorPolygonPoint(polygon);
			if (!point) continue;
			surfaces.push({
				point,
				polygon,
				bounds: polygonBounds([polygon])
			});
		}
	}
	return surfaces;
}

function decodeOgdFeatures(buffer) {
	const vectorTile = new VectorTile(new PbfReader(buffer));
	const layer = vectorTile.layers?.wien_buildings;
	if (!layer?.length) return [];

	const extent = Number(layer.extent) || 4096;
	const features = [];
	for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
		const feature = layer.feature(featureIndex);
		if (feature?.type !== 3) continue;
		const properties = feature.properties || {};
		const id = String(properties.KS_ID || "").trim();
		if (!id) continue;
		const polygons = classifyPolygons(feature.loadGeometry?.() || [], extent);
		if (!polygons.length) continue;
		features.push({
			id,
			properties,
			polygons,
			bounds: polygonBounds(polygons)
		});
	}
	return features;
}

async function fetchBuffer(url, allow404 = false) {
	let lastError = null;
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 45_000);
		try {
			const response = await fetch(url, {
				headers: { "User-Agent": "kartensammlung-overlay-builds/wien-gap-analysis" },
				signal: controller.signal
			});
			if (allow404 && response.status === 404) return null;
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} for ${url}`);
			}
			return new Uint8Array(await response.arrayBuffer());
		} catch (error) {
			lastError = error;
			if (attempt >= 5) break;
			const waitMs = Math.min(15_000, attempt * 2_000);
			console.warn(
				`Fetch retry ${attempt}/5 in ${waitMs / 1000}s: ${url}: `
				+ `${error?.message || error}`
			);
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		} finally {
			clearTimeout(timer);
		}
	}
	throw new Error(
		`Fetch failed after 5 attempts: ${url}: ${lastError?.message || lastError}`
	);
}

async function processTile(tile) {
	const [ogdBuffer, mtkBuffer] = await Promise.all([
		fetchBuffer(tileUrl(OGD_TILE_URL, tile)),
		fetchBuffer(tileUrl(MTK_TILE_URL, tile), true)
	]);
	const ogdFeatures = decodeOgdFeatures(ogdBuffer);
	const lod2Surfaces = mtkBuffer ? extractLod2Surfaces(mtkBuffer, tile) : [];

	const ogdGrid = new Map();
	for (let i = 0; i < ogdFeatures.length; i += 1) {
		addFeatureToGrid(ogdGrid, i, ogdFeatures[i].bounds);
	}
	const matched = new Set();

	// Richtung 1: Ein sicherer LOD2-Dachpunkt liegt in einem aktuellen
	// OGD-Baukoerper. Das ist praezise fuer fein geteilte LOD2-Daecher.
	for (const surface of lod2Surfaces) {
		for (const featureIndex of gridCandidates(ogdGrid, surface.point)) {
			if (matched.has(featureIndex)) continue;
			const feature = ogdFeatures[featureIndex];
			if (feature.polygons.some((polygon) => polygonContainsPoint(polygon, surface.point))) {
				matched.add(featureIndex);
			}
		}
	}

	// Richtung 2: Ein sicherer Innenpunkt des aktuellen OGD-Baukoerpers liegt
	// in einer projizierten LOD2-Dachflaeche. Dadurch werden auch Faelle
	// erkannt, in denen ein aelteres/groesseres Dach mehrere heutige
	// OGD-Teilflaechen ueberspannt.
	const lod2Grid = new Map();
	for (let i = 0; i < lod2Surfaces.length; i += 1) {
		addFeatureToGrid(lod2Grid, i, lod2Surfaces[i].bounds);
	}
	for (let featureIndex = 0; featureIndex < ogdFeatures.length; featureIndex += 1) {
		if (matched.has(featureIndex)) continue;
		const feature = ogdFeatures[featureIndex];
		let reverseMatched = false;
		for (const polygon of feature.polygons) {
			const point = interiorPolygonPoint(polygon);
			if (!point) continue;
			for (const surfaceIndex of gridCandidates(lod2Grid, point)) {
				if (polygonContainsPoint(lod2Surfaces[surfaceIndex].polygon, point)) {
					reverseMatched = true;
					break;
				}
			}
			if (reverseMatched) break;
		}
		if (reverseMatched) matched.add(featureIndex);
	}

	const known = {};
	for (const target of KNOWN_TARGETS) {
		const targetTile = {
			z: ZOOM,
			x: Math.floor(lngToWorldX(target.lng, ZOOM)),
			y: Math.floor(latToWorldY(target.lat, ZOOM))
		};
		if (targetTile.x !== tile.x || targetTile.y !== tile.y) continue;
		const point = localPointForLngLat(tile, target.lng, target.lat);
		const ids = [];
		for (const featureIndex of gridCandidates(ogdGrid, point)) {
			const feature = ogdFeatures[featureIndex];
			if (feature.polygons.some((polygon) => polygonContainsPoint(polygon, point))) {
				ids.push(feature.id);
			}
		}
		known[target.name] = ids;
	}

	return {
		tile,
		ogdFeatures,
		matched,
		lod2PointCount: lod2Surfaces.length,
		known
	};
}

async function mapLimit(items, limit, worker) {
	let next = 0;
	const results = new Array(items.length);
	async function run() {
		while (true) {
			const index = next;
			next += 1;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
	return results;
}

function representativePoint(tile, feature) {
	const b = feature.bounds;
	return tilePointLngLat(tile, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
}

async function main() {
	const release = await (await fetch(RELEASE_URL, { cache: "no-store" })).json();
	const keys = release?.vectorTiles?.presentTilesZ15 || [];
	const tiles = keys.map((key) => {
		const [z, x, y] = key.split("/").map(Number);
		return { z, x, y };
	});
	console.log(`Analyzing ${tiles.length} Wiener Z15 tiles...`);

	const resultById = new Map();
	const knownIds = new Map(KNOWN_TARGETS.map((target) => [target.name, new Set()]));
	let lod2PointTotal = 0;
	let tilesDone = 0;

	const tileResults = await mapLimit(tiles, CONCURRENCY, async (tile) => {
		const result = await processTile(tile);
		tilesDone += 1;
		if (tilesDone % 25 === 0 || tilesDone === tiles.length) {
			console.log(`Processed ${tilesDone}/${tiles.length} tiles`);
		}
		return result;
	});

	for (const result of tileResults) {
		lod2PointTotal += result.lod2PointCount;
		for (const [name, ids] of Object.entries(result.known)) {
			const targetSet = knownIds.get(name);
			for (const id of ids) targetSet.add(id);
		}

		for (let index = 0; index < result.ogdFeatures.length; index += 1) {
			const feature = result.ogdFeatures[index];
			let record = resultById.get(feature.id);
			if (!record) {
				record = {
					id: feature.id,
					matched: false,
					tilesSeen: 0,
					properties: feature.properties,
					point: representativePoint(result.tile, feature)
				};
				resultById.set(feature.id, record);
			}
			record.tilesSeen += 1;
			if (result.matched.has(index)) record.matched = true;
		}
	}

	const records = [...resultById.values()];
	const missing = records.filter((record) => !record.matched);
	const matched = records.length - missing.length;
	const byClass = {};
	for (const record of missing) {
		const key = String(record.properties.F_KLASSE ?? "unknown");
		byClass[key] = (byClass[key] || 0) + 1;
	}

	const buildingGroups = new Map();
	for (const record of records) {
		const bwGebId = String(record.properties.BW_GEB_ID ?? "").trim();
		if (!bwGebId) continue;
		let group = buildingGroups.get(bwGebId);
		if (!group) {
			group = {
				BW_GEB_ID: bwGebId,
				total: 0,
				missing: 0,
				records: []
			};
			buildingGroups.set(bwGebId, group);
		}
		group.total += 1;
		if (!record.matched) group.missing += 1;
		group.records.push(record);
	}
	const fullyMissingGroups = [];
	let partiallyMissingBuildings = 0;
	for (const group of buildingGroups.values()) {
		if (group.missing === group.total && group.missing > 0) {
			const classes = [...new Set(
				group.records.map((record) => Number(record.properties.F_KLASSE))
					.filter(Number.isFinite)
			)].sort((a, b) => a - b);
			const heights = group.records
				.map((record) => Number(record.properties.render_height))
				.filter(Number.isFinite);
			const class11 = group.records.filter((record) => Number(record.properties.F_KLASSE) === 11);
			const representative = class11[0] || group.records[0];
			fullyMissingGroups.push({
				BW_GEB_ID: group.BW_GEB_ID,
				partCount: group.total,
				classes,
				maxHeight: heights.length ? Number(Math.max(...heights).toFixed(3)) : null,
				lng: Number(representative.point.lng.toFixed(7)),
				lat: Number(representative.point.lat.toFixed(7)),
				ksIds: group.records.map((record) => record.id)
			});
		} else if (group.missing > 0) {
			partiallyMissingBuildings += 1;
		}
	}
	const fullyMissingBuildings = fullyMissingGroups.length;

	const knownTargets = KNOWN_TARGETS.map((target) => {
		const ids = [...knownIds.get(target.name)];
		return {
			...target,
			ids,
			status: ids.map((id) => ({
				id,
				matched: resultById.get(id)?.matched ?? null,
				properties: resultById.get(id)?.properties ?? null
			}))
		};
	});

	const output = {
		generatedAt: new Date().toISOString(),
		method: {
			zoom: ZOOM,
			tiles: tiles.length,
			match: "bidirectional interior-point containment between non-wall Maptoolkit LOD2 surfaces and current OGD building polygons",
			aggregation: "KS_ID across tile boundaries"
		},
		counts: {
			ogdFeatures: records.length,
			matchedOgdFeatures: matched,
			missingOgdFeatures: missing.length,
			matchPercent: Number((matched / Math.max(1, records.length) * 100).toFixed(3)),
			lod2SurfaceInteriorPoints: lod2PointTotal,
			uniqueBwGebId: buildingGroups.size,
			fullyMissingBuildings,
			partiallyMissingBuildings,
			missingByClass: byClass
		},
		knownTargets,
		fullyMissingBuildingGroups: fullyMissingGroups,
		missing: missing.map((record) => ({
			KS_ID: record.id,
			FMZK_ID: record.properties.FMZK_ID ?? null,
			BW_GEB_ID: record.properties.BW_GEB_ID ?? null,
			F_KLASSE: record.properties.F_KLASSE ?? null,
			KLASSE_SUB: record.properties.KLASSE_SUB ?? null,
			render_height: record.properties.render_height ?? null,
			lng: Number(record.point.lng.toFixed(7)),
			lat: Number(record.point.lat.toFixed(7))
		}))
	};

	const outputPath = process.argv[2] || "wien-maptoolkit-gaps.json";
	await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
	await fs.writeFile(outputPath, JSON.stringify(output, null, "\t") + "\n", "utf8");

	console.log("");
	console.log("SUMMARY");
	console.log(JSON.stringify(output.counts, null, 2));
	console.log("");
	console.log("KNOWN TARGETS");
	for (const target of knownTargets) {
		console.log(JSON.stringify(target));
	}
	console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
