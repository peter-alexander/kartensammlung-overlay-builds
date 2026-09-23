#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

const MTK_TILE_URL =
	"https://mtk.wien.gv.at/dataconnector/wien/buildings3d/{z}/{x}/{y}.pbf";
const RENDER_EXTENT = 8192;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.68557849;
const ROOF_MIN_UP_NORMAL = 0.2;
const FLAT_ROOF_MIN_UP_NORMAL = 0.985;
const REPLACEMENT_MODES = new Set([
	"maptoolkit-roof-replacement",
	"maptoolkit-roof-replacement-pilot"
]);

function parseArgs(argv) {
	const result = {
		root: "",
		output: "",
		requireSafe: false,
		expectedCount: null
	};
	for (let index = 2; index < argv.length; index += 1) {
		if (argv[index] === "--root") {
			result.root = path.resolve(argv[++index]);
		} else if (argv[index] === "--output") {
			result.output = path.resolve(argv[++index]);
		} else if (argv[index] === "--require-safe") {
			result.requireSafe = true;
		} else if (argv[index] === "--expected-count") {
			result.expectedCount = Number(argv[++index]);
		} else {
			throw new Error("Unknown argument: " + argv[index]);
		}
	}
	if (!result.root) throw new Error("--root is required.");
	if (
		result.expectedCount !== null
		&& (!Number.isInteger(result.expectedCount) || result.expectedCount < 1)
	) {
		throw new Error("--expected-count must be a positive integer.");
	}
	return result;
}

function openRing(ring) {
	const result = [];
	for (const point of ring || []) {
		const next = {
			x: Number(point.x),
			y: Number(point.y),
			z: Number(point.z || 0)
		};
		if (
			!result.length
			|| result[result.length - 1].x !== next.x
			|| result[result.length - 1].y !== next.y
			|| result[result.length - 1].z !== next.z
		) {
			result.push(next);
		}
	}
	if (
		result.length > 1
		&& result[0].x === result[result.length - 1].x
		&& result[0].y === result[result.length - 1].y
		&& result[0].z === result[result.length - 1].z
	) {
		result.pop();
	}
	return result;
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

function getFeatureBaseDecimeters(groups) {
	const metadata = openRing(groups?.[0]?.[0]);
	if (metadata.length === 2) {
		return Math.min(metadata[0].z, metadata[1].z);
	}
	const points = (groups || []).flat(2);
	const elevations = points
		.map((point) => Number(point?.z))
		.filter(Number.isFinite);
	return elevations.length ? Math.min(...elevations) : 0;
}

function surfaceRelativeHeightMeters(surface, baseDecimeters) {
	const heights = (surface || [])
		.flatMap((ring) => openRing(ring))
		.map((point) => (Number(point.z) - baseDecimeters) / 10)
		.filter(Number.isFinite);
	if (!heights.length) return null;
	const sorted = heights.sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const median = sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
	return {
		min: sorted[0],
		median,
		max: sorted[sorted.length - 1]
	};
}

function tileCenterLatitude(tile) {
	const n = 2 ** tile.z;
	const worldY = (tile.y + 0.5) / n;
	return Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180 / Math.PI;
}

function normalUpFraction(ring, xyMetersPerExtentUnit) {
	const points = openRing(ring);
	if (points.length < 3) return 0;
	let nx = 0;
	let ny = 0;
	let nz = 0;
	for (let index = 0; index < points.length; index += 1) {
		const current = {
			x: points[index].x * xyMetersPerExtentUnit,
			y: points[index].y * xyMetersPerExtentUnit,
			z: points[index].z / 10
		};
		const rawNext = points[(index + 1) % points.length];
		const next = {
			x: rawNext.x * xyMetersPerExtentUnit,
			y: rawNext.y * xyMetersPerExtentUnit,
			z: rawNext.z / 10
		};
		nx += (current.y - next.y) * (current.z + next.z);
		ny += (current.z - next.z) * (current.x + next.x);
		nz += (current.x - next.x) * (current.y + next.y);
	}
	const length = Math.hypot(nx, ny, nz);
	return length > 1e-9 ? Math.abs(nz) / length : 0;
}

function surfaceKind(surface, xyMetersPerExtentUnit) {
	const contour = surface?.[0];
	const up = normalUpFraction(contour, xyMetersPerExtentUnit);
	if (up < ROOF_MIN_UP_NORMAL) return "wall";
	return up >= FLAT_ROOF_MIN_UP_NORMAL ? "flat-roof" : "pitched-roof";
}

function pointInRing(point, ring) {
	let inside = false;
	for (
		let index = 0, previous = ring.length - 1;
		index < ring.length;
		previous = index++
	) {
		const a = ring[index];
		const b = ring[previous];
		if (
			(a.y > point.y) !== (b.y > point.y)
			&& point.x < (
				(b.x - a.x) * (point.y - a.y)
				/ ((b.y - a.y) || Number.EPSILON)
				+ a.x
			)
		) {
			inside = !inside;
		}
	}
	return inside;
}

function surfaceContainsPoint(surface, point, scale) {
	const rings = (surface || [])
		.map(openRing)
		.filter((ring) => ring.length >= 3)
		.map((ring) => ring.map((vertex) => ({
			x: vertex.x * scale,
			y: vertex.y * scale
		})));
	if (!rings.length || !pointInRing(point, rings[0])) return false;
	for (let index = 1; index < rings.length; index += 1) {
		if (pointInRing(point, rings[index])) return false;
	}
	return true;
}

function parseBin(buffer) {
	const bytes = new Uint8Array(
		buffer.buffer,
		buffer.byteOffset,
		buffer.byteLength
	);
	const view = new DataView(
		buffer.buffer,
		buffer.byteOffset,
		buffer.byteLength
	);
	const magic = Buffer.from(bytes.subarray(0, 8)).toString("ascii");
	if (magic !== "KSL21B01") throw new Error("Unexpected BIN magic: " + magic);
	const extent = view.getUint32(12, true);
	const vertexCount = view.getUint32(16, true);
	const indexCount = view.getUint32(20, true);
	const metadataLength = view.getUint32(28, true);
	const metadataStart = 32;
	const metadataEnd = metadataStart + metadataLength;
	const metadata = JSON.parse(
		Buffer.from(bytes.subarray(metadataStart, metadataEnd)).toString("utf8")
	);
	const padding = (4 - (metadataLength % 4)) % 4;
	const vertexOffset = metadataEnd + padding;
	const vertexStride = Number(metadata.vertexStride || 16);
	return {
		view,
		metadata,
		extent,
		vertexCount,
		indexCount,
		vertexOffset,
		vertexStride,
		indexOffset: vertexOffset + vertexCount * vertexStride
	};
}

function replacementPointsForBuilding(tileData, historicalCode) {
	const building = (tileData.metadata.buildings || []).find((item) => (
		String(item?.historicalCode || "") === historicalCode
	));
	if (!building) return [];
	if (!REPLACEMENT_MODES.has(String(building.rolloutMode || ""))) {
		throw new Error(historicalCode + ": replacement rolloutMode missing");
	}

	const points = [];
	const center = tileData.extent / 2;
	const sourceVertexStart = Number(building.vertexStart);
	const sourceVertexCount = Number(building.vertexCount);
	const sourceIndexStart = Number(building.indexStart);
	const sourceIndexCount = Number(building.indexCount);

	for (let localIndex = 0; localIndex + 2 < sourceIndexCount; localIndex += 3) {
		const triangle = [];
		let pitched = true;
		for (let corner = 0; corner < 3; corner += 1) {
			const sourceIndex = tileData.view.getUint32(
				tileData.indexOffset
					+ (sourceIndexStart + localIndex + corner) * 4,
				true
			);
			if (
				sourceIndex < sourceVertexStart
				|| sourceIndex >= sourceVertexStart + sourceVertexCount
			) {
				pitched = false;
				break;
			}
			const offset =
				tileData.vertexOffset + sourceIndex * tileData.vertexStride;
			if (tileData.view.getUint8(offset + 12) !== 1) {
				pitched = false;
				break;
			}
			triangle.push({
				x: center + tileData.view.getInt16(offset, true) / 4,
				y: center + tileData.view.getInt16(offset + 2, true) / 4
			});
		}
		if (!pitched || triangle.length !== 3) continue;
		points.push({
			x: triangle.reduce((sum, point) => sum + point.x, 0) / 3,
			y: triangle.reduce((sum, point) => sum + point.y, 0) / 3
		});
	}
	return points;
}

function historicalPitchedRoofStats(tileData, historicalCode) {
	const building = (tileData.metadata.buildings || []).find((item) => (
		String(item?.historicalCode || "") === historicalCode
	));
	if (!building) return null;
	const sourceVertexStart = Number(building.vertexStart);
	const sourceVertexCount = Number(building.vertexCount);
	if (
		!Number.isFinite(sourceVertexStart)
		|| !Number.isFinite(sourceVertexCount)
		|| sourceVertexStart < 0
		|| sourceVertexCount <= 0
	) return null;

	const heights = [];
	for (
		let sourceIndex = sourceVertexStart;
		sourceIndex < sourceVertexStart + sourceVertexCount;
		sourceIndex += 1
	) {
		const offset = tileData.vertexOffset + sourceIndex * tileData.vertexStride;
		if (tileData.view.getUint8(offset + 12) !== 1) continue;
		heights.push(tileData.view.getUint16(offset + 4, true) / 100);
	}
	if (!heights.length) return null;
	heights.sort((a, b) => a - b);
	const min = heights[0];
	const max = heights[heights.length - 1];
	return {
		minM: Number(min.toFixed(3)),
		maxM: Number(max.toFixed(3)),
		riseM: Number((max - min).toFixed(3))
	};
}

function median(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!sorted.length) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

async function fetchMtkTile(tile) {
	const url = MTK_TILE_URL
		.replace("{z}", String(tile.z))
		.replace("{x}", String(tile.x))
		.replace("{y}", String(tile.y));
	const response = await fetch(url, {
		headers: {
			"User-Agent":
				"kartensammlung-overlay-builds/wien-roof-loss-pilot-validator"
		}
	});
	if (!response.ok) {
		throw new Error("Maptoolkit " + tile.z + "/" + tile.x + "/" + tile.y
			+ ": HTTP " + response.status);
	}
	return new Uint8Array(await response.arrayBuffer());
}

async function main() {
	const args = parseArgs(process.argv);
	const manifest = JSON.parse(
		await fs.readFile(path.join(args.root, "targets.json"), "utf8")
	);
	const reports = [];

	for (const target of manifest.targets || []) {
		const code = String(target.historicalCode || "");
		if (!REPLACEMENT_MODES.has(String(target.rolloutMode || ""))) continue;
		const tileKey = String(target.matches?.[0]?.tile || "");
		const parts = tileKey.split("/").map(Number);
		if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) {
			throw new Error(code + ": invalid target tile " + tileKey);
		}
		const tile = { z: parts[0], x: parts[1], y: parts[2] };
		const binPath = path.join(
			args.root,
			"tiles",
			String(tile.z),
			String(tile.x),
			String(tile.y) + ".bin"
		);
		const tileData = parseBin(await fs.readFile(binPath));
		const replacementPoints = replacementPointsForBuilding(tileData, code);
		const historicalRoof = historicalPitchedRoofStats(tileData, code);

		const mtkBuffer = await fetchMtkTile(tile);
		const vectorTile = new VectorTile(new PbfReader(mtkBuffer));
		const layer = vectorTile.layers?.buildings3d;
		if (!layer?.length) {
			throw new Error(code + ": Maptoolkit tile has no buildings3d layer");
		}
		const extent = Number(layer.extent) || 4096;
		const scale = RENDER_EXTENT / extent;
		const centerLat = tileCenterLatitude(tile) * Math.PI / 180;
		const tileWidthM =
			EARTH_CIRCUMFERENCE_METERS * Math.cos(centerLat) / 2 ** tile.z;
		const xyMetersPerExtentUnit = tileWidthM / extent;
		const matchedFeatures = [];
		const flatHitPoints = new Set();
		const pitchedHitPoints = new Set();
		const flatHitSurfaceHeights = [];

		for (let featureIndex = 0; featureIndex < layer.length; featureIndex += 1) {
			const feature = layer.feature(featureIndex);
			const groups = decodeGeometry3D(feature);
			const baseDecimeters = getFeatureBaseDecimeters(groups);
			const surfaces = getSurfaceGroups(groups);
			const featureFlatHitPoints = new Set();
			const featurePitchedHitPoints = new Set();
			let pitchedSurfaces = 0;
			let flatSurfaces = 0;
			for (const surface of surfaces) {
				const kind = surfaceKind(surface, xyMetersPerExtentUnit);
				if (kind === "pitched-roof") pitchedSurfaces += 1;
				if (kind === "flat-roof") flatSurfaces += 1;
				if (kind === "wall") continue;
				const hitPointIndices = [];
				for (let pointIndex = 0; pointIndex < replacementPoints.length; pointIndex += 1) {
					if (
						!surfaceContainsPoint(
							surface,
							replacementPoints[pointIndex],
							scale
						)
					) continue;
					hitPointIndices.push(pointIndex);
					if (kind === "pitched-roof") {
						pitchedHitPoints.add(pointIndex);
						featurePitchedHitPoints.add(pointIndex);
					} else if (kind === "flat-roof") {
						flatHitPoints.add(pointIndex);
						featureFlatHitPoints.add(pointIndex);
					}
				}
				if (kind === "flat-roof" && hitPointIndices.length) {
					const height = surfaceRelativeHeightMeters(
						surface,
						baseDecimeters
					);
					if (height) {
						flatHitSurfaceHeights.push({
							featureIndex,
							hitPointIndices,
							minM: Number(height.min.toFixed(3)),
							medianM: Number(height.median.toFixed(3)),
							maxM: Number(height.max.toFixed(3))
						});
					}
				}
			}
			if (!featureFlatHitPoints.size && !featurePitchedHitPoints.size) continue;
			matchedFeatures.push({
				featureIndex,
				pitchedSurfaces,
				flatSurfaces,
				flatHitPoints: [...featureFlatHitPoints].sort((a, b) => a - b),
				pitchedHitPoints: [...featurePitchedHitPoints].sort((a, b) => a - b)
			});
		}

		const unmatchedReplacementPoints = Math.max(
			0,
			replacementPoints.length
				- new Set([...flatHitPoints, ...pitchedHitPoints]).size
		);
		const safe = (
			replacementPoints.length > 0
			&& flatHitPoints.size > 0
			&& pitchedHitPoints.size === 0
		);
		const reasons = [];
		if (!replacementPoints.length) reasons.push("no-historical-pitched-samples");
		if (!flatHitPoints.size) reasons.push("no-flat-maptoolkit-hit");
		if (pitchedHitPoints.size) reasons.push("pitched-maptoolkit-hit");

		const flatSurfaceMedians = flatHitSurfaceHeights
			.map((surface) => Number(surface.medianM))
			.filter(Number.isFinite);
		const maptoolkitFlatMedianM = median(flatSurfaceMedians);
		const eaveDeltaM = (
			Number.isFinite(maptoolkitFlatMedianM)
			&& Number.isFinite(historicalRoof?.minM)
		)
			? maptoolkitFlatMedianM - historicalRoof.minM
			: null;
		const ridgeDeltaM = (
			Number.isFinite(maptoolkitFlatMedianM)
			&& Number.isFinite(historicalRoof?.maxM)
		)
			? maptoolkitFlatMedianM - historicalRoof.maxM
			: null;
		const roofRisePosition = (
			Number.isFinite(maptoolkitFlatMedianM)
			&& Number.isFinite(historicalRoof?.minM)
			&& Number(historicalRoof?.riseM) > 0.01
		)
			? (
				(maptoolkitFlatMedianM - historicalRoof.minM)
				/ historicalRoof.riseM
			)
			: null;

		reports.push({
			historicalCode: code,
			bwGebId: target.bwGebId ?? null,
			tile: tileKey,
			roofType: String(target.matches?.[0]?.roofType || ""),
			safe,
			reasons,
			replacementPoints: replacementPoints.length,
			flatHitPoints: flatHitPoints.size,
			pitchedHitPoints: pitchedHitPoints.size,
			unmatchedReplacementPoints,
			flatHitPercent: replacementPoints.length
				? Number((flatHitPoints.size / replacementPoints.length * 100).toFixed(3))
				: 0,
			pitchedHitPercent: replacementPoints.length
				? Number((pitchedHitPoints.size / replacementPoints.length * 100).toFixed(3))
				: 0,
			currentOgdParts: Array.isArray(target.ksIds) ? target.ksIds.length : 0,
			maptoolkitMatchedFeatures: matchedFeatures.length,
			historicalPitchedRoof: historicalRoof,
			maptoolkitFlatHitSurfaces: flatHitSurfaceHeights,
			maptoolkitFlatMedianM: Number.isFinite(maptoolkitFlatMedianM)
				? Number(maptoolkitFlatMedianM.toFixed(3))
				: null,
			maptoolkitFlatVsHistoricalEaveM: Number.isFinite(eaveDeltaM)
				? Number(eaveDeltaM.toFixed(3))
				: null,
			maptoolkitFlatVsHistoricalRidgeM: Number.isFinite(ridgeDeltaM)
				? Number(ridgeDeltaM.toFixed(3))
				: null,
			maptoolkitFlatRoofRisePosition: Number.isFinite(roofRisePosition)
				? Number(roofRisePosition.toFixed(4))
				: null,
			maptoolkitFeatures: matchedFeatures
		});
	}

	const summary = {
		targets: reports.length,
		safe: reports.filter((report) => report.safe).length,
		unsafe: reports.filter((report) => !report.safe).length,
		withFlatHits: reports.filter((report) => report.flatHitPoints > 0).length,
		withPitchedHits: reports.filter((report) => report.pitchedHitPoints > 0).length,
		withoutMaptoolkitRoofHit: reports.filter(
			(report) => (
				report.flatHitPoints === 0
				&& report.pitchedHitPoints === 0
			)
		).length
	};
	const output = {
		generatedAt: new Date().toISOString(),
		summary,
		reports
	};
	console.log(JSON.stringify(output, null, 2));
	if (args.output) {
		await fs.mkdir(path.dirname(args.output), { recursive: true });
		await fs.writeFile(
			args.output,
			JSON.stringify(output, null, "\t") + "\n",
			"utf8"
		);
	}
	if (
		args.expectedCount !== null
		&& reports.length !== args.expectedCount
	) {
		throw new Error(
			"Expected " + args.expectedCount + " reports, got " + reports.length
		);
	}
	if (args.requireSafe && summary.unsafe > 0) {
		throw new Error(
			summary.unsafe + " of " + summary.targets
			+ " Maptoolkit roof-replacement target(s) are not surface-safe"
		);
	}
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
