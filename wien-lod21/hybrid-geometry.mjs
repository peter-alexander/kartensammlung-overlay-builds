#!/usr/bin/env node

import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import UnionOp from "jsts/org/locationtech/jts/operation/union/UnionOp.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";

const WFS_URL = "https://data.wien.gv.at/daten/geo";
const WFS_TYPE_NAME = "ogdwien:FMZKBKMOGD";
const HYBRID_ROLLOUT_MODES = new Set(["manual-pilot-hybrid"]);
const WFS_BATCH_SIZE = 20;
const MIN_REMAINDER_AREA_M2 = 0.05;

function finiteNumber(value) {
	if (value === null || value === undefined || value === "") return null;
	const normalized = typeof value === "string" ? value.replace(",", ".").trim() : value;
	const number = Number(normalized);
	return Number.isFinite(number) ? number : null;
}

export function deriveOgdHeights(properties = {}) {
	const roof = finiteNumber(properties.O_KOTE);
	const terrain = finiteNumber(properties.T_KOTE) ?? finiteNumber(properties.HOEHE_DGM);
	const underside = finiteNumber(properties.U_KOTE);
	if (roof === null || terrain === null) return null;

	const height = roof - terrain;
	if (!(height > 0.1) || height > 350) return null;

	let base = 0;
	if (underside !== null && underside > terrain && underside < roof) {
		base = underside - terrain;
	}
	return {
		height: Number(height.toFixed(3)),
		base: Number(Math.max(0, base).toFixed(3))
	};
}

function closeRing(ring) {
	const points = (ring || [])
		.map((point) => [Number(point?.x), Number(point?.y)])
		.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
	if (points.length < 3) return [];
	const first = points[0];
	const last = points[points.length - 1];
	if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
	return points;
}

function repairGeometry(geometry) {
	if (!geometry || geometry.isEmpty()) return null;
	try {
		return BufferOp.bufferOp(geometry, 0);
	} catch {
		return geometry;
	}
}

function unionGeometries(geometries) {
	let result = null;
	for (const geometry of geometries) {
		const repaired = repairGeometry(geometry);
		if (!repaired || repaired.isEmpty()) continue;
		try {
			result = result ? UnionOp.union(result, repaired) : repaired;
		} catch {
			const repairedResult = repairGeometry(result);
			result = repairedResult ? UnionOp.union(repairedResult, repaired) : repaired;
		}
	}
	return result;
}

function safeDifference(a, b) {
	try {
		return OverlayOp.overlayOp(a, b, OverlayOp.DIFFERENCE);
	} catch {
		const repairedA = repairGeometry(a);
		const repairedB = repairGeometry(b);
		if (!repairedA || !repairedB) return null;
		try {
			return OverlayOp.overlayOp(repairedA, repairedB, OverlayOp.DIFFERENCE);
		} catch {
			return null;
		}
	}
}

export function historicalGroundFootprint(surfaces, reader = new GeoJSONReader()) {
	const geometries = [];
	for (const surface of surfaces || []) {
		if (surface?.semantic !== "ground") continue;
		const coordinates = (surface.rings || []).map(closeRing).filter((ring) => ring.length >= 4);
		if (!coordinates.length) continue;
		try {
			geometries.push(reader.read({
				type: "Polygon",
				coordinates
			}));
		} catch {}
	}
	return unionGeometries(geometries);
}

function chunks(values, size = WFS_BATCH_SIZE) {
	const result = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

async function fetchWithRetry(url, {
	attempts = 4,
	timeoutMs = 120_000
} = {}) {
	let lastError = null;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				headers: {
					Accept: "application/json",
					"User-Agent": "kartensammlung-overlay-builds/wien-lod21-hybrid"
				},
				signal: controller.signal
			});
			if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
			return await response.json();
		} catch (error) {
			lastError = error;
			if (attempt < attempts) {
				await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
			}
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastError || new Error("Wien OGD WFS request failed.");
}

function requestedHybridIds(targets) {
	return [...new Set(
		(targets || [])
			.filter((target) => HYBRID_ROLLOUT_MODES.has(String(target?.rolloutMode || "")))
			.flatMap((target) => target.ksIds || [])
			.map((id) => String(id || "").replace(/^wien-fmzk:/, "").trim())
			.filter((id) => /^\d+$/.test(id))
	)].sort();
}

export async function fetchHybridOgdFeatures(targets) {
	const ids = requestedHybridIds(targets);
	const byKsId = new Map();
	for (const batch of chunks(ids)) {
		const url = new URL(WFS_URL);
		url.searchParams.set("service", "WFS");
		url.searchParams.set("request", "GetFeature");
		url.searchParams.set("version", "1.1.0");
		url.searchParams.set("typeName", WFS_TYPE_NAME);
		url.searchParams.set("outputFormat", "json");
		url.searchParams.set("srsName", "EPSG:31256");
		url.searchParams.set(
			"CQL_FILTER",
			"F_KLASSE=11 AND FMZK_ID IN (" + batch.join(",") + ")"
		);
		const payload = await fetchWithRetry(url.toString());
		if (!Array.isArray(payload?.features)) {
			throw new Error("Unexpected Vienna OGD WFS response for hybrid buildings.");
		}
		for (const feature of payload.features) {
			const id = String(feature?.properties?.FMZK_ID ?? "").trim();
			if (!id) continue;
			byKsId.set("wien-fmzk:" + id, feature);
		}
	}

	const missing = ids
		.map((id) => "wien-fmzk:" + id)
		.filter((id) => !byKsId.has(id));
	if (missing.length) {
		throw new Error(
			"Hybrid OGD features missing from current WFS: " + missing.join(", ")
		);
	}
	return byKsId;
}

export function buildHybridRemainders(
	target,
	historicalSurfaces,
	featuresByKsId,
	{
		reader = new GeoJSONReader(),
		writer = new GeoJSONWriter()
	} = {}
) {
	if (!HYBRID_ROLLOUT_MODES.has(String(target?.rolloutMode || ""))) return [];

	const historical = historicalGroundFootprint(historicalSurfaces, reader);
	if (!historical || historical.isEmpty()) {
		throw new Error(
			`Hybrid target ${target?.historicalCode || "?"} has no usable GroundSurface footprint.`
		);
	}

	const remainders = [];
	for (const ksId of target.ksIds || []) {
		const feature = featuresByKsId.get(String(ksId));
		if (!feature?.geometry) {
			throw new Error(
				`Hybrid target ${target.historicalCode}: current OGD feature ${ksId} is unavailable.`
			);
		}
		const heights = deriveOgdHeights(feature.properties || {});
		if (!heights) {
			throw new Error(
				`Hybrid target ${target.historicalCode}: OGD heights invalid for ${ksId}.`
			);
		}

		let current;
		try {
			current = repairGeometry(reader.read(feature.geometry));
		} catch (error) {
			throw new Error(
				`Hybrid target ${target.historicalCode}: OGD geometry invalid for ${ksId}: ${error.message}`
			);
		}
		if (!current || current.isEmpty()) continue;

		const difference = safeDifference(current, historical);
		const area = Number(difference?.getArea?.() || 0);
		if (!(area > MIN_REMAINDER_AREA_M2)) continue;

		const geometry = writer.write(difference);
		if (!geometry || !["Polygon", "MultiPolygon", "GeometryCollection"].includes(geometry.type)) {
			continue;
		}
		remainders.push({
			ksId: String(ksId),
			height: heights.height,
			base: heights.base,
			areaM2: Number(area.toFixed(3)),
			geometry
		});
	}
	return remainders;
}

export const HYBRID_GEOMETRY_CONSTANTS = Object.freeze({
	minRemainderAreaM2: MIN_REMAINDER_AREA_M2,
	rolloutModes: [...HYBRID_ROLLOUT_MODES]
});
