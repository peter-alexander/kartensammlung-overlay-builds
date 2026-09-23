#!/usr/bin/env node

import fs from "node:fs/promises";
import earcut from "earcut";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

const RELEASE_URL = "https://tiles.radlobby.at/WienBuildings/release.json";
const OGD_TILE_URL = "https://tiles.radlobby.at/WienBuildings/tiles/{z}/{x}/{y}.pbf";
const MTK_TILE_URL = "https://mtk.wien.gv.at/dataconnector/wien/buildings3d/{z}/{x}/{y}.pbf";
const ZOOM = 15;
const GRID_SIZE = 64;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.68557849;

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function tileUrl(template, tile, version = "") {
	const base = template
		.replace("{z}", String(tile.z))
		.replace("{x}", String(tile.x))
		.replace("{y}", String(tile.y));
	return version
		? `${base}?v=${encodeURIComponent(version)}`
		: base;
}

function lngToWorldX(lng, zoom) {
	return (Number(lng) + 180) / 360 * 2 ** zoom;
}

function latToWorldY(lat, zoom) {
	const radians = clamp(Number(lat), -85.05112878, 85.05112878)
		* Math.PI / 180;
	return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom;
}

function openRing(ring) {
	const out = [];
	for (const point of ring || []) {
		const next = {
			x: Number(point.x),
			y: Number(point.y),
			z: Number(point.z || 0)
		};
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
	for (let index = 0; index < ring.length; index += 1) {
		const a = ring[index];
		const b = ring[(index + 1) % ring.length];
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
	for (let index = 1; index < polygon.length; index += 1) {
		if (pointInRing(point, polygon[index])) return false;
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
	return grid.get(
		cellIndex(point.y) * GRID_SIZE + cellIndex(point.x)
	) || [];
}

function decodeGeometry3D(feature) {
	const pbf = feature?._pbf;
	const geometryOffset = Number(feature?._geometry);
	if (!pbf || !Number.isFinite(geometryOffset) || geometryOffset < 0) {
		return [];
	}
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

function featureGeometrySignature(groups) {
	let hash = 0x811c9dc5;
	const update = (value) => {
		let number = Number(value);
		if (!Number.isFinite(number)) number = 0;
		number |= 0;
		for (let shift = 0; shift < 32; shift += 8) {
			hash ^= (number >>> shift) & 0xff;
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
	};
	update(groups?.length || 0);
	for (const group of groups || []) {
		update(0x475250);
		update(group?.length || 0);
		for (const ring of group || []) {
			update(0x52494e47);
			const points = openRing(ring);
			update(points.length);
			for (const point of points) {
				update(point.x);
				update(point.y);
				update(point.z);
			}
		}
	}
	return hash.toString(16).padStart(8, "0");
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

function extractMaptoolkitSurfaces(buffer) {
	const vectorTile = new VectorTile(new PbfReader(buffer));
	const layer = vectorTile.layers?.buildings3d;
	if (!layer?.length) return [];
	const extent = Number(layer.extent) || 4096;
	const surfaces = [];
	for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
		const feature = layer.feature(featureIndex);
		const groups = decodeGeometry3D(feature);
		const signature = featureGeometrySignature(groups);
		for (const surface of getSurfaceGroups(groups)) {
			const polygon = normalizeSurfacePolygon(surface, extent);
			if (!polygon) continue;
			const point = interiorPolygonPoint(polygon);
			if (!point) continue;
			surfaces.push({
				featureIndex,
				signature,
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
		const polygons = classifyPolygons(
			feature.loadGeometry?.() || [],
			extent
		);
		if (!polygons.length) continue;
		features.push({
			id,
			bwGebId: String(properties.BW_GEB_ID ?? "").trim(),
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
				headers: {
					"User-Agent":
						"kartensammlung-overlay-builds/wien-roof-override-audit"
				},
				signal: controller.signal
			});
			if (allow404 && response.status === 404) return null;
			if (!response.ok) throw new Error(
				`HTTP ${response.status} for ${url}`
			);
			return new Uint8Array(await response.arrayBuffer());
		} catch (error) {
			lastError = error;
			if (attempt >= 5) break;
			await new Promise((resolve) => (
				setTimeout(resolve, Math.min(15_000, attempt * 2_000))
			));
		} finally {
			clearTimeout(timer);
		}
	}
	throw new Error(
		`Fetch failed after 5 attempts: ${url}: `
		+ String(lastError?.message || lastError)
	);
}

function targetTiles(target) {
	const centerX = Math.floor(lngToWorldX(target.lng, ZOOM));
	const centerY = Math.floor(latToWorldY(target.lat, ZOOM));
	const tiles = [];
	for (let dy = -1; dy <= 1; dy += 1) {
		for (let dx = -1; dx <= 1; dx += 1) {
			tiles.push({
				z: ZOOM,
				x: centerX + dx,
				y: centerY + dy
			});
		}
	}
	return tiles;
}

function tileKey(tile) {
	return `${tile.z}/${tile.x}/${tile.y}`;
}

async function inspectTile(tile, version) {
	const [ogdBuffer, mtkBuffer] = await Promise.all([
		fetchBuffer(tileUrl(OGD_TILE_URL, tile, version)),
		fetchBuffer(tileUrl(MTK_TILE_URL, tile), true)
	]);
	const ogd = decodeOgdFeatures(ogdBuffer);
	const surfaces = mtkBuffer ? extractMaptoolkitSurfaces(mtkBuffer) : [];
	const ogdGrid = new Map();
	for (let index = 0; index < ogd.length; index += 1) {
		addFeatureToGrid(ogdGrid, index, ogd[index].bounds);
	}
	const surfaceGrid = new Map();
	for (let index = 0; index < surfaces.length; index += 1) {
		addFeatureToGrid(surfaceGrid, index, surfaces[index].bounds);
	}

	const ownersByMtkFeature = new Map();
	const signatureByMtkFeature = new Map();
	for (const surface of surfaces) {
		if (!signatureByMtkFeature.has(surface.featureIndex)) {
			signatureByMtkFeature.set(surface.featureIndex, surface.signature);
		}
	}
	const touch = (featureIndex, ogdIndex) => {
		let owners = ownersByMtkFeature.get(featureIndex);
		if (!owners) {
			owners = new Set();
			ownersByMtkFeature.set(featureIndex, owners);
		}
		const owner = ogd[ogdIndex]?.bwGebId;
		if (owner) owners.add(owner);
	};

	for (const surface of surfaces) {
		for (const ogdIndex of gridCandidates(ogdGrid, surface.point)) {
			const feature = ogd[ogdIndex];
			if (feature.polygons.some(
				(polygon) => polygonContainsPoint(polygon, surface.point)
			)) {
				touch(surface.featureIndex, ogdIndex);
			}
		}
	}

	for (let ogdIndex = 0; ogdIndex < ogd.length; ogdIndex += 1) {
		for (const polygon of ogd[ogdIndex].polygons) {
			const point = interiorPolygonPoint(polygon);
			if (!point) continue;
			for (const surfaceIndex of gridCandidates(surfaceGrid, point)) {
				const surface = surfaces[surfaceIndex];
				if (polygonContainsPoint(surface.polygon, point)) {
					touch(surface.featureIndex, ogdIndex);
				}
			}
		}
	}

	return {
		tile,
		ogd,
		ownersByMtkFeature,
		signatureByMtkFeature
	};
}

async function main() {
	const [summaryPath, outputPath] = process.argv.slice(2);
	if (!summaryPath || !outputPath) {
		throw new Error(
			"Usage: analyze-maptoolkit-override-pilot.mjs summary.json output.json"
		);
	}
	const summary = JSON.parse(await fs.readFile(summaryPath, "utf8"));
	const pitchedTypes = new Set([
		"SATTELDACH","PULTDACH","WALMDACH","BOGENDACH","TURMDACH",
		"KEGELDACH","KUPPELDACH","KRUEPPELWALMDACH","SPITZDACH",
		"MANSARDENDACH"
	]);
	const targets = (summary.strongCandidates || []).filter((item) => {
		const metrics = item.metrics || {};
		const roofTypes = new Set(item.lod21?.roofTypes || []);
		return (
			Number(metrics.oldCoverage) >= 0.995
			&& Number(metrics.currentCoverage) >= 0.995
			&& Number(metrics.centroidDistanceM) <= 1
			&& Number(metrics.heightDifferenceM) <= 1
			&& roofTypes.size > 0
			&& [...roofTypes].every((type) => pitchedTypes.has(type))
		);
	});
	if (targets.length !== 27) {
		throw new Error(`Expected 27 pilot targets, got ${targets.length}`);
	}

	const release = await (
		await fetch(RELEASE_URL, { cache: "no-store" })
	).json();
	const version = String(release?.generatedAt || "");
	if (!version) throw new Error("WienBuildings release has no generatedAt.");

	const tileMap = new Map();
	for (const target of targets) {
		for (const tile of targetTiles(target)) {
			tileMap.set(tileKey(tile), tile);
		}
	}
	const tileResults = new Map();
	for (const tile of tileMap.values()) {
		try {
			tileResults.set(
				tileKey(tile),
				await inspectTile(tile, version)
			);
		} catch (error) {
			console.warn(
				"Tile audit failed for " + tileKey(tile) + ": "
				+ String(error?.message || error)
			);
		}
	}

	const rows = [];
	for (const target of targets) {
		const owner = String(target.ownerBwGebIds?.[0] || "");
		const matchedFeatures = [];
		for (const tile of targetTiles(target)) {
			const result = tileResults.get(tileKey(tile));
			if (!result) continue;
			for (const [featureIndex, owners] of result.ownersByMtkFeature) {
				if (!owners.has(owner)) continue;
				matchedFeatures.push({
					tile: tileKey(tile),
					featureIndex,
					signature:
						String(
							result.signatureByMtkFeature.get(featureIndex) || ""
						),
					owners: [...owners].sort(),
					exclusive: owners.size === 1
				});
			}
		}
		const unique = new Map();
		for (const item of matchedFeatures) {
			unique.set(
				item.tile + ":" + item.featureIndex,
				item
			);
		}
		const features = [...unique.values()].sort((a, b) => (
			a.tile.localeCompare(b.tile)
			|| a.featureIndex - b.featureIndex
		));
		rows.push({
			historicalCode: String(target.historicalCode),
			bwGebId: owner,
			ksIds: target.ksIds || [],
			lng: Number(target.lng),
			lat: Number(target.lat),
			featureCount: features.length,
			exclusiveFeatureCount: features.filter(
				(item) => item.exclusive
			).length,
			sharedFeatureCount: features.filter(
				(item) => !item.exclusive
			).length,
			features
		});
	}

	const output = {
		generatedAt: new Date().toISOString(),
		count: rows.length,
		allTargetsHaveFeatures: rows.every((row) => row.featureCount > 0),
		allFeaturesExclusive: rows.every((row) => row.sharedFeatureCount === 0),
		totalFeatures: rows.reduce((sum, row) => sum + row.featureCount, 0),
		totalSharedFeatures: rows.reduce(
			(sum, row) => sum + row.sharedFeatureCount,
			0
		),
		rows
	};
	await fs.writeFile(
		outputPath,
		JSON.stringify(output, null, "\t") + "\n"
	);
	console.log(JSON.stringify({
		count: output.count,
		allTargetsHaveFeatures: output.allTargetsHaveFeatures,
		allFeaturesExclusive: output.allFeaturesExclusive,
		totalFeatures: output.totalFeatures,
		totalSharedFeatures: output.totalSharedFeatures,
		sharedTargets: rows.filter(
			(row) => row.sharedFeatureCount > 0
		).map((row) => row.historicalCode)
	}, null, 2));
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
