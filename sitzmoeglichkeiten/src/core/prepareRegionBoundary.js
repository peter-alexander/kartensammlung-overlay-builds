import fs from 'node:fs/promises';

import proj4 from 'proj4';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import UnionOp from 'jsts/org/locationtech/jts/operation/union/UnionOp.js';

const boundaryCache = new Map();

function cloneJson(value) {
	return JSON.parse(JSON.stringify(value));
}

function parseFeatureCollection(json, label) {
	if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
		throw new Error(`${label} ist keine GeoJSON-FeatureCollection.`);
	}

	return json;
}

function safeStringify(value, maxLength = 1200) {
	let text;

	try {
		text = JSON.stringify(value);
	} catch (err) {
		return `[nicht serialisierbar: ${err?.message || String(err)}]`;
	}

	if (text.length <= maxLength) {
		return text;
	}

	return `${text.slice(0, maxLength)}…`;
}

function isPositionArray(value) {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'number'
	);
}

function isCoordinateObject(value) {
	return (
		value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		typeof value.x === 'number' &&
		typeof value.y === 'number'
	);
}

function coordinateToPosition(coord) {
	if (isPositionArray(coord)) {
		return [coord[0], coord[1]];
	}

	if (isCoordinateObject(coord)) {
		return [coord.x, coord.y];
	}

	if (coord && typeof coord.getX === 'function' && typeof coord.getY === 'function') {
		return [coord.getX(), coord.getY()];
	}

	if (coord && typeof coord === 'object') {
		throw new Error(`Unbekanntes Koordinatenformat aus JSTS. Keys: ${Object.keys(coord).join(', ') || '(keine)'}. Sample: ${safeStringify(coord)}`);
	}

	throw new Error(`Unbekanntes Koordinatenformat aus JSTS: ${String(coord)}`);
}

function ringToPositions(ring) {
	if (!ring || typeof ring.getCoordinates !== 'function') {
		throw new Error(`JSTS-Ring hat keine getCoordinates()-Funktion. Sample: ${safeStringify(ring)}`);
	}

	const coordinates = ring.getCoordinates();

	if (!Array.isArray(coordinates) || coordinates.length === 0) {
		throw new Error(`JSTS-Ring lieferte keine Koordinaten. Sample: ${safeStringify(coordinates)}`);
	}

	return coordinates.map((coord) => coordinateToPosition(coord));
}

function polygonToCoordinates(polygon) {
	if (!polygon || typeof polygon.getExteriorRing !== 'function') {
		throw new Error(`JSTS-Polygon hat keine getExteriorRing()-Funktion. Type: ${polygon?.getGeometryType?.() ?? typeof polygon}`);
	}

	const rings = [ringToPositions(polygon.getExteriorRing())];
	const holeCount = typeof polygon.getNumInteriorRing === 'function'
		? polygon.getNumInteriorRing()
		: 0;

	for (let i = 0; i < holeCount; i++) {
		rings.push(ringToPositions(polygon.getInteriorRingN(i)));
	}

	return rings;
}

function collectPolygonCoordinatesFromJstsGeometry(geometry, out = []) {
	if (!geometry || geometry.isEmpty()) {
		return out;
	}

	const type = geometry.getGeometryType();

	if (type === 'Polygon') {
		out.push(polygonToCoordinates(geometry));
		return out;
	}

	if (type === 'MultiPolygon' || type === 'GeometryCollection') {
		for (let i = 0; i < geometry.getNumGeometries(); i++) {
			collectPolygonCoordinatesFromJstsGeometry(geometry.getGeometryN(i), out);
		}
		return out;
	}

	throw new Error(`Puffer ergab unerwarteten Geometrietyp: ${type}`);
}

function describeJstsGeometry(geometry) {
	if (!geometry) {
		return { exists: false };
	}

	return {
		exists: true,
		type: geometry.getGeometryType?.() ?? null,
		isEmpty: typeof geometry.isEmpty === 'function' ? geometry.isEmpty() : null,
		numGeometries: typeof geometry.getNumGeometries === 'function' ? geometry.getNumGeometries() : null,
		numPoints: typeof geometry.getNumPoints === 'function' ? geometry.getNumPoints() : null,
		envelope: (() => {
			try {
				const env = geometry.getEnvelopeInternal?.();
				return env ? {
					minX: env.getMinX?.(),
					minY: env.getMinY?.(),
					maxX: env.getMaxX?.(),
					maxY: env.getMaxY?.()
				} : null;
			} catch (err) {
				return `Envelope-Fehler: ${err?.message || String(err)}`;
			}
		})()
	};
}

function jstsPolygonalGeometryToGeoJSON(geometry, label = 'Puffergeometrie') {
	const polygons = collectPolygonCoordinatesFromJstsGeometry(geometry);

	if (polygons.length === 0) {
		throw new Error(`${label} enthält keine Polygone. JSTS: ${safeStringify(describeJstsGeometry(geometry))}`);
	}

	const coordinateStats = getCoordinateStatsFromCoordinates(polygons);

	if (coordinateStats.validPositions === 0) {
		throw new Error(`${label}: Polygon-Sammlung enthält keine gültigen Positionen. Stats: ${safeStringify(coordinateStats)} Sample: ${safeStringify(polygons)}`);
	}

	if (polygons.length === 1) {
		return {
			type: 'Polygon',
			coordinates: polygons[0]
		};
	}

	return {
		type: 'MultiPolygon',
		coordinates: polygons
	};
}

export async function loadBoundaryFeatureCollectionFromFile(file, label = 'Grenze') {
	const cacheKey = `file:${file}`;

	if (boundaryCache.has(cacheKey)) {
		return cloneJson(boundaryCache.get(cacheKey));
	}

	const text = await fs.readFile(file, 'utf8');

	if (!text || !text.trim()) {
		throw new Error(`${label} ist leer: ${file}`);
	}

	let json;
	try {
		json = JSON.parse(text);
	} catch (err) {
		throw new Error(`${label} ist kein gültiges JSON: ${err?.message || String(err)}`);
	}

	const parsed = parseFeatureCollection(json, label);
	boundaryCache.set(cacheKey, parsed);
	return cloneJson(parsed);
}

function visitPositionsInCoordinates(coords, visit) {
	if (isPositionArray(coords)) {
		visit(coords);
		return;
	}

	if (isCoordinateObject(coords)) {
		visit([coords.x, coords.y]);
		return;
	}

	if (!Array.isArray(coords)) return;

	for (const child of coords) {
		visitPositionsInCoordinates(child, visit);
	}
}

function visitPositionsInGeometry(geometry, visit) {
	if (!geometry) return;

	if (geometry.type === 'GeometryCollection') {
		for (const childGeometry of geometry.geometries ?? []) {
			visitPositionsInGeometry(childGeometry, visit);
		}
		return;
	}

	visitPositionsInCoordinates(geometry.coordinates, visit);
}

function transformCoordinates(coords, transformPosition) {
	if (isPositionArray(coords)) {
		return transformPosition(coords);
	}

	if (isCoordinateObject(coords)) {
		return transformPosition([coords.x, coords.y]);
	}

	if (!Array.isArray(coords)) return coords;

	return coords.map((child) => transformCoordinates(child, transformPosition));
}

function transformGeometry(geometry, transformPosition) {
	if (!geometry) return geometry;

	if (geometry.type === 'GeometryCollection') {
		return {
			...geometry,
			geometries: (geometry.geometries ?? []).map((childGeometry) =>
				transformGeometry(childGeometry, transformPosition)
			)
		};
	}

	return {
		...geometry,
		coordinates: transformCoordinates(geometry.coordinates, transformPosition)
	};
}

function transformFeatureCollection(featureCollection, transformPosition) {
	return {
		...featureCollection,
		features: (featureCollection.features ?? []).map((feature) => ({
			...feature,
			properties: feature?.properties ? { ...feature.properties } : {},
			geometry: transformGeometry(feature.geometry, transformPosition)
		}))
	};
}

function getCoordinateStatsFromCoordinates(coords, stats = null) {
	stats ??= {
		validPositions: 0,
		invalidPositions: 0,
		arrays: 0,
		objects: 0,
		other: 0,
		firstValid: null,
		firstInvalid: null
	};

	if (isPositionArray(coords)) {
		stats.arrays++;

		if (Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
			stats.validPositions++;
			stats.firstValid ??= [coords[0], coords[1]];
		} else {
			stats.invalidPositions++;
			stats.firstInvalid ??= coords;
		}

		return stats;
	}

	if (isCoordinateObject(coords)) {
		stats.objects++;

		if (Number.isFinite(coords.x) && Number.isFinite(coords.y)) {
			stats.validPositions++;
			stats.firstValid ??= [coords.x, coords.y];
		} else {
			stats.invalidPositions++;
			stats.firstInvalid ??= coords;
		}

		return stats;
	}

	if (Array.isArray(coords)) {
		for (const child of coords) {
			getCoordinateStatsFromCoordinates(child, stats);
		}
		return stats;
	}

	if (coords != null) {
		stats.other++;
		stats.firstInvalid ??= coords;
	}

	return stats;
}

function describeFeatureCollection(featureCollection, label = 'FeatureCollection') {
	const features = Array.isArray(featureCollection?.features)
		? featureCollection.features
		: [];
	const geometryTypes = new Map();
	const coordinateStats = {
		validPositions: 0,
		invalidPositions: 0,
		arrays: 0,
		objects: 0,
		other: 0,
		firstValid: null,
		firstInvalid: null
	};

	for (const feature of features) {
		const type = feature?.geometry?.type ?? '(keine Geometrie)';
		geometryTypes.set(type, (geometryTypes.get(type) ?? 0) + 1);

		if (feature?.geometry?.type === 'GeometryCollection') {
			for (const childGeometry of feature.geometry.geometries ?? []) {
				const childType = `GeometryCollection/${childGeometry?.type ?? '(unbekannt)'}`;
				geometryTypes.set(childType, (geometryTypes.get(childType) ?? 0) + 1);
			}
		}

		getCoordinateStatsFromCoordinates(feature?.geometry?.coordinates, coordinateStats);
	}

	return {
		label,
		type: featureCollection?.type ?? null,
		featureCount: features.length,
		geometryTypes: Object.fromEntries(geometryTypes),
		coordinateStats,
		firstFeatureSample: features[0] ? {
			id: features[0].id ?? null,
			geometryType: features[0].geometry?.type ?? null,
			propertiesKeys: Object.keys(features[0].properties ?? {}).slice(0, 20),
			geometrySample: features[0].geometry ? safeStringify(features[0].geometry, 800) : null
		} : null
	};
}

function getFeatureCollectionBounds4326(featureCollection, label = 'GeoJSON') {
	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = -Infinity;
	let maxLat = -Infinity;
	let seenPositions = 0;
	let seenValidPositions = 0;

	for (const feature of featureCollection.features ?? []) {
		visitPositionsInGeometry(feature.geometry, ([lon, lat]) => {
			seenPositions++;

			if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

			seenValidPositions++;
			minLon = Math.min(minLon, lon);
			minLat = Math.min(minLat, lat);
			maxLon = Math.max(maxLon, lon);
			maxLat = Math.max(maxLat, lat);
		});
	}

	if (
		!Number.isFinite(minLon) ||
		!Number.isFinite(minLat) ||
		!Number.isFinite(maxLon) ||
		!Number.isFinite(maxLat)
	) {
		throw new Error(`${label}: GeoJSON enthält keine gültigen Koordinaten. seenPositions=${seenPositions}, seenValidPositions=${seenValidPositions}, summary=${safeStringify(describeFeatureCollection(featureCollection, label), 2400)}`);
	}

	return {
		minLon,
		minLat,
		maxLon,
		maxLat
	};
}

function expandBoundsByMeters(bounds, marginMeters) {
	if (!marginMeters || marginMeters <= 0) {
		return bounds;
	}

	const centerLat = (bounds.minLat + bounds.maxLat) / 2;
	const metersPerDegreeLat = 111_320;
	const metersPerDegreeLon = Math.max(1, metersPerDegreeLat * Math.cos(centerLat * Math.PI / 180));

	const dLat = marginMeters / metersPerDegreeLat;
	const dLon = marginMeters / metersPerDegreeLon;

	return {
		minLon: bounds.minLon - dLon,
		minLat: bounds.minLat - dLat,
		maxLon: bounds.maxLon + dLon,
		maxLat: bounds.maxLat + dLat
	};
}

function buildBoundaryGeometry(featureCollection, reader, label) {
	let geometry = null;

	for (const feature of featureCollection.features ?? []) {
		if (!feature?.geometry) continue;

		const featureGeometry = reader.read(feature.geometry);

		if (!featureGeometry || featureGeometry.isEmpty()) continue;

		geometry = geometry
			? UnionOp.union(geometry, featureGeometry)
			: featureGeometry;
	}

	if (!geometry || geometry.isEmpty()) {
		throw new Error(`${label} enthält keine verwertbare Geometrie. Input summary: ${safeStringify(describeFeatureCollection(featureCollection, label), 2400)}`);
	}

	return geometry;
}

function bufferBoundaryFeatureCollection(featureCollection, bufferMeters, label, { logger = console } = {}) {
	if (!bufferMeters || bufferMeters <= 0) {
		return cloneJson(featureCollection);
	}

	logger?.info?.(`${label}: starte Buffer-Vorbereitung`, describeFeatureCollection(featureCollection, `${label} Quelle`));

	const bounds = getFeatureCollectionBounds4326(featureCollection, `${label} Quelle`);
	const centerLon = (bounds.minLon + bounds.maxLon) / 2;
	const centerLat = (bounds.minLat + bounds.maxLat) / 2;
	const localProjection = proj4(
		`+proj=aeqd +lat_0=${centerLat} +lon_0=${centerLon} +datum=WGS84 +units=m +no_defs`
	);
	
	const toLocal = ([lon, lat]) => {
		const [x, y] = localProjection.forward([lon, lat]);
		return [x, y];
	};
	
	const toLonLat = ([x, y]) => {
		const [lon, lat] = localProjection.inverse([x, y]);
		return [lon, lat];
	};

	const localFeatureCollection = transformFeatureCollection(featureCollection, toLocal);
	logger?.info?.(`${label}: nach Projektion`, describeFeatureCollection(localFeatureCollection, `${label} lokal`));

	const reader = new GeoJSONReader();
	const localBoundaryGeometry = buildBoundaryGeometry(localFeatureCollection, reader, `${label} lokal`);
	logger?.info?.(`${label}: JSTS-Grenze`, describeJstsGeometry(localBoundaryGeometry));

	const bufferedLocalGeometry = BufferOp.bufferOp(localBoundaryGeometry, bufferMeters);
	logger?.info?.(`${label}: JSTS-Puffer`, describeJstsGeometry(bufferedLocalGeometry));

	if (!bufferedLocalGeometry || bufferedLocalGeometry.isEmpty()) {
		throw new Error(`${label}: Puffergeometrie ist leer. JSTS: ${safeStringify(describeJstsGeometry(bufferedLocalGeometry))}`);
	}

	const bufferedGeometry = jstsPolygonalGeometryToGeoJSON(bufferedLocalGeometry, `${label} Puffer`);
	const bufferedLocalFeatureCollection = {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: {
					generated: true,
					bufferMeters
				},
				geometry: bufferedGeometry
			}
		]
	};

	logger?.info?.(`${label}: Puffer als lokales GeoJSON`, describeFeatureCollection(bufferedLocalFeatureCollection, `${label} lokaler Puffer`));

	const buffered4326FeatureCollection = transformFeatureCollection(bufferedLocalFeatureCollection, toLonLat);
	logger?.info?.(`${label}: Puffer zurück in EPSG:4326`, describeFeatureCollection(buffered4326FeatureCollection, `${label} Puffer EPSG:4326`));

	return buffered4326FeatureCollection;
}

export async function prepareRegionBoundary(region, { logger = console } = {}) {
	const boundary = region.boundary;
	const label = `${region.name} Grenze`;

	try {
		if (!boundary?.file) {
			throw new Error(`Region ${region.id}: boundary.file fehlt.`);
		}

		const bufferMeters = Number(boundary.bufferMeters ?? 0);
		const overpassMarginMeters = Number(boundary.overpassMarginMeters ?? 0);
		const sourceFeatureCollection = await loadBoundaryFeatureCollectionFromFile(
			boundary.file,
			label
		);

		logger?.info?.(`${label}: Datei geladen`, {
			regionId: region.id,
			boundaryFile: boundary.file,
			bufferMeters,
			overpassMarginMeters,
			summary: describeFeatureCollection(sourceFeatureCollection, `${label} Quelle`)
		});

		const clipFeatureCollection = bufferBoundaryFeatureCollection(
			sourceFeatureCollection,
			bufferMeters,
			label,
			{ logger }
		);
		const clipBounds4326 = getFeatureCollectionBounds4326(clipFeatureCollection, `${label} Clip-Puffer`);
		const overpassBounds4326 = expandBoundsByMeters(clipBounds4326, overpassMarginMeters);

		logger?.info?.(`Boundary vorbereitet für ${region.id}`, {
			boundaryFile: boundary.file,
			bufferMeters,
			overpassMarginMeters,
			clipBounds4326,
			overpassBounds4326
		});

		return {
			sourceFeatureCollection,
			clipFeatureCollection,
			clipBounds4326,
			overpassBounds4326,
			bufferMeters,
			overpassMarginMeters
		};
	} catch (err) {
		throw new Error(`prepareRegionBoundary failed for region=${region.id} (${region.name}), file=${boundary?.file ?? '(none)'}: ${err?.message || String(err)}`);
	}
}
