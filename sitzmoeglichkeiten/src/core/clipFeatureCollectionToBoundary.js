import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
import UnionOp from 'jsts/org/locationtech/jts/operation/union/UnionOp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INNER_BOUNDARY_FILE = path.join(__dirname, 'boundaries', 'wien_innen.geojson');

let innerBoundaryFeatureCollectionCache = null;
const exactBoundaryFeatureCollectionCache = new Map();

function cloneFeatureWithGeometry(feature, geometry) {
	return {
		...feature,
		properties: feature?.properties ? { ...feature.properties } : {},
		tippecanoe: feature?.tippecanoe ? { ...feature.tippecanoe } : undefined,
		geometry
	};
}

function collectLineGeometries(geometry, out = []) {
	if (!geometry || geometry.isEmpty()) {
		return out;
	}

	const type = geometry.getGeometryType();

	switch (type) {
		case 'LineString':
		case 'LinearRing':
			out.push(geometry);
			return out;

		case 'MultiLineString':
		case 'GeometryCollection':
			for (let i = 0; i < geometry.getNumGeometries(); i++) {
				collectLineGeometries(geometry.getGeometryN(i), out);
			}
			return out;

		default:
			return out;
	}
}

function parseFeatureCollectionJson(json, label) {
	if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
		throw new Error(`${label} ist kein GeoJSON-FeatureCollection.`);
	}

	return json;
}

function buildBoundaryGeometry(boundaryFeatureCollection, reader, label) {
	const features = boundaryFeatureCollection?.features;

	if (!Array.isArray(features) || features.length === 0) {
		throw new Error(`${label} enthält keine Features.`);
	}

	let boundaryGeometry = null;

	for (const feature of features) {
		if (!feature?.geometry) {
			continue;
		}

		const geom = reader.read(feature.geometry);

		if (!geom || geom.isEmpty()) {
			continue;
		}

		boundaryGeometry = boundaryGeometry
			? UnionOp.union(boundaryGeometry, geom)
			: geom;
	}

	if (!boundaryGeometry || boundaryGeometry.isEmpty()) {
		throw new Error(`${label} enthält keine verwertbare Geometrie.`);
	}

	return boundaryGeometry;
}

async function fetchBoundaryFeatureCollection(boundaryUrl) {
	if (exactBoundaryFeatureCollectionCache.has(boundaryUrl)) {
		return exactBoundaryFeatureCollectionCache.get(boundaryUrl);
	}

	const response = await fetch(boundaryUrl, {
		headers: {
			accept: 'application/json'
		}
	});

	if (!response.ok) {
		throw new Error(`Wien-Grenze konnte nicht geladen werden (HTTP ${response.status}).`);
	}

	const text = await response.text();

	if (!text || !text.trim()) {
		throw new Error('Wien-Grenze lieferte leere Antwort.');
	}

	let json;
	try {
		json = JSON.parse(text);
	} catch (err) {
		throw new Error(`Wien-Grenze ist kein gültiges JSON: ${err?.message || String(err)}`);
	}

	const parsed = parseFeatureCollectionJson(json, 'Wien-Grenze');
	exactBoundaryFeatureCollectionCache.set(boundaryUrl, parsed);
	return parsed;
}

async function loadInnerBoundaryFeatureCollection() {
	if (innerBoundaryFeatureCollectionCache) {
		return innerBoundaryFeatureCollectionCache;
	}

	const text = await fs.readFile(INNER_BOUNDARY_FILE, 'utf8');

	if (!text || !text.trim()) {
		throw new Error(`Innere Wien-Grenze ist leer: ${INNER_BOUNDARY_FILE}`);
	}

	let json;
	try {
		json = JSON.parse(text);
	} catch (err) {
		throw new Error(`Innere Wien-Grenze ist kein gültiges JSON: ${err?.message || String(err)}`);
	}

	innerBoundaryFeatureCollectionCache = parseFeatureCollectionJson(json, 'Innere Wien-Grenze');
	return innerBoundaryFeatureCollectionCache;
}

export async function clipFeatureCollectionToBoundary({
	featureCollection,
	boundaryUrl,
	strict = false,
	logger = console
}) {
	try {
		if (!featureCollection || featureCollection.type !== 'FeatureCollection') {
			throw new Error('featureCollection muss eine GeoJSON-FeatureCollection sein.');
		}

		if (!boundaryUrl) {
			throw new Error('boundaryUrl fehlt.');
		}

		const inputFeatures = Array.isArray(featureCollection.features)
			? featureCollection.features
			: [];

		if (inputFeatures.length === 0) {
			return featureCollection;
		}

		const reader = new GeoJSONReader();
		const writer = new GeoJSONWriter();

		const [
			exactBoundaryFeatureCollection,
			innerBoundaryFeatureCollection
		] = await Promise.all([
			fetchBoundaryFeatureCollection(boundaryUrl),
			loadInnerBoundaryFeatureCollection()
		]);

		const exactBoundaryGeometry = buildBoundaryGeometry(
			exactBoundaryFeatureCollection,
			reader,
			'Wien-Grenze'
		);
		const innerBoundaryGeometry = buildBoundaryGeometry(
			innerBoundaryFeatureCollection,
			reader,
			'Innere Wien-Grenze'
		);

		const exactBoundaryEnvelope = exactBoundaryGeometry.getEnvelopeInternal();
		const innerBoundaryEnvelope = innerBoundaryGeometry.getEnvelopeInternal();

		const clippedFeatures = [];
		let droppedFeatures = 0;
		let keptInsideInnerBoundary = 0;
		let intersectedFeatures = 0;
		let splitParts = 0;

		for (const feature of inputFeatures) {
			if (!feature?.geometry) {
				droppedFeatures++;
				continue;
			}

			const inputGeometry = reader.read(feature.geometry);

			if (!inputGeometry || inputGeometry.isEmpty()) {
				droppedFeatures++;
				continue;
			}

			const inputEnvelope = inputGeometry.getEnvelopeInternal();

			if (exactBoundaryEnvelope.disjoint(inputEnvelope)) {
				droppedFeatures++;
				continue;
			}

			if (innerBoundaryEnvelope.covers(inputEnvelope)) {
				const relation = RelateOp.relate(innerBoundaryGeometry, inputGeometry);
				if (relation.isCovers()) {
					clippedFeatures.push(feature);
					keptInsideInnerBoundary++;
					continue;
				}
			}

			const clippedGeometry = OverlayOp.overlayOp(
				inputGeometry,
				exactBoundaryGeometry,
				OverlayOp.INTERSECTION
			);

			if (!clippedGeometry || clippedGeometry.isEmpty()) {
				droppedFeatures++;
				continue;
			}

			const clippedType = clippedGeometry.getGeometryType();

			if (clippedType === 'LineString' || clippedType === 'LinearRing') {
				intersectedFeatures++;
				clippedFeatures.push(
					cloneFeatureWithGeometry(feature, writer.write(clippedGeometry))
				);
				continue;
			}

			if (clippedType === 'MultiLineString') {
				intersectedFeatures++;
				const count = clippedGeometry.getNumGeometries();
				splitParts += Math.max(0, count - 1);

				for (let i = 0; i < count; i++) {
					clippedFeatures.push(
						cloneFeatureWithGeometry(feature, writer.write(clippedGeometry.getGeometryN(i)))
					);
				}
				continue;
			}

			const lineGeometries = collectLineGeometries(clippedGeometry);

			if (lineGeometries.length === 0) {
				droppedFeatures++;
				continue;
			}

			intersectedFeatures++;
			splitParts += Math.max(0, lineGeometries.length - 1);

			for (const lineGeometry of lineGeometries) {
				clippedFeatures.push(
					cloneFeatureWithGeometry(feature, writer.write(lineGeometry))
				);
			}
		}

		logger?.debug?.('Boundary clip finished', {
			before: inputFeatures.length,
			after: clippedFeatures.length,
			droppedFeatures,
			keptInsideInnerBoundary,
			intersectedFeatures,
			splitParts,
			innerBoundaryFile: INNER_BOUNDARY_FILE
		});

		return {
			...featureCollection,
			features: clippedFeatures
		};
	} catch (err) {
		logger?.error?.(err?.stack || String(err));

		if (strict) {
			throw err;
		}

		logger?.warn?.(`Boundary clip übersprungen: ${err?.message || String(err)}`);
		return featureCollection;
	}
}
