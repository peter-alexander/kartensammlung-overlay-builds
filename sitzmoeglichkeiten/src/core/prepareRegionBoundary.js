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

	throw new Error('Unbekanntes Koordinatenformat aus JSTS.');
}

function ringToPositions(ring) {
	const coordinates = ring.getCoordinates();
	return coordinates.map((coord) => coordinateToPosition(coord));
}

function polygonToCoordinates(polygon) {
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

function jstsPolygonalGeometryToGeoJSON(geometry) {
	const polygons = collectPolygonCoordinatesFromJstsGeometry(geometry);

	if (polygons.length === 0) {
		throw new Error('Puffergeometrie enthält keine Polygone.');
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

function getFeatureCollectionBounds4326(featureCollection) {
	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = -Infinity;
	let maxLat = -Infinity;

	for (const feature of featureCollection.features ?? []) {
		visitPositionsInGeometry(feature.geometry, ([lon, lat]) => {
			if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

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
		throw new Error('GeoJSON enthält keine gültigen Koordinaten.');
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
		throw new Error(`${label} enthält keine verwertbare Geometrie.`);
	}

	return geometry;
}

function bufferBoundaryFeatureCollection(featureCollection, bufferMeters, label) {
	if (!bufferMeters || bufferMeters <= 0) {
		return cloneJson(featureCollection);
	}

	const bounds = getFeatureCollectionBounds4326(featureCollection);
	const centerLon = (bounds.minLon + bounds.maxLon) / 2;
	const centerLat = (bounds.minLat + bounds.maxLat) / 2;
	const localProjection = `+proj=aeqd +lat_0=${centerLat} +lon_0=${centerLon} +datum=WGS84 +units=m +no_defs`;

	const toLocal = ([lon, lat]) => {
		const [x, y] = proj4('EPSG:4326', localProjection, [lon, lat]);
		return [x, y];
	};

	const toLonLat = ([x, y]) => {
		const [lon, lat] = proj4(localProjection, 'EPSG:4326', [x, y]);
		return [lon, lat];
	};

	const localFeatureCollection = transformFeatureCollection(featureCollection, toLocal);
	const reader = new GeoJSONReader();
	const localBoundaryGeometry = buildBoundaryGeometry(localFeatureCollection, reader, label);
	const bufferedLocalGeometry = BufferOp.bufferOp(localBoundaryGeometry, bufferMeters);

	if (!bufferedLocalGeometry || bufferedLocalGeometry.isEmpty()) {
		throw new Error(`${label}: Puffergeometrie ist leer.`);
	}

	const bufferedLocalFeatureCollection = {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: {
					generated: true,
					bufferMeters
				},
				geometry: jstsPolygonalGeometryToGeoJSON(bufferedLocalGeometry)
			}
		]
	};

	return transformFeatureCollection(bufferedLocalFeatureCollection, toLonLat);
}

export async function prepareRegionBoundary(region, { logger = console } = {}) {
	const boundary = region.boundary;

	if (!boundary?.file) {
		throw new Error(`Region ${region.id}: boundary.file fehlt.`);
	}

	const bufferMeters = Number(boundary.bufferMeters ?? 0);
	const overpassMarginMeters = Number(boundary.overpassMarginMeters ?? 0);
	const sourceFeatureCollection = await loadBoundaryFeatureCollectionFromFile(
		boundary.file,
		`${region.name} Grenze`
	);
	const clipFeatureCollection = bufferBoundaryFeatureCollection(
		sourceFeatureCollection,
		bufferMeters,
		`${region.name} Grenze`
	);
	const clipBounds4326 = getFeatureCollectionBounds4326(clipFeatureCollection);
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
}
