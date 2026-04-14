import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import PreparedGeometryFactory from 'jsts/org/locationtech/jts/geom/prep/PreparedGeometryFactory.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import UnionOp from 'jsts/org/locationtech/jts/operation/union/UnionOp.js';

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

function buildBoundaryGeometry(boundaryFeatureCollection, reader) {
	const features = boundaryFeatureCollection?.features;

	if (!Array.isArray(features) || features.length === 0) {
		throw new Error('Wien-Grenze enthält keine Features.');
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
		throw new Error('Wien-Grenze enthält keine verwertbare Geometrie.');
	}

	return boundaryGeometry;
}

async function fetchBoundaryFeatureCollection(boundaryUrl) {
	const response = await fetch(boundaryUrl, {
		headers: {
			accept: 'application/json'
		}
	});

	if (!response.ok) {
		throw new Error(`Wien-Grenze konnte nicht geladen werden (HTTP ${response.status}).`);
	}

	const json = await response.json();

	if (!json || json.type !== 'FeatureCollection') {
		throw new Error('Wien-Grenze ist kein GeoJSON-FeatureCollection.');
	}

	return json;
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

		const boundaryFeatureCollection = await fetchBoundaryFeatureCollection(boundaryUrl);
		const boundaryGeometry = buildBoundaryGeometry(boundaryFeatureCollection, reader);
		const boundaryEnvelope = boundaryGeometry.getEnvelopeInternal();
		const preparedBoundary = PreparedGeometryFactory.prepare(boundaryGeometry);

		const clippedFeatures = [];
		let droppedFeatures = 0;
		let keptUnchanged = 0;
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

			if (boundaryEnvelope.disjoint(inputEnvelope)) {
				droppedFeatures++;
				continue;
			}

			if (
				boundaryEnvelope.covers(inputEnvelope) &&
				preparedBoundary.covers(inputGeometry)
			) {
				clippedFeatures.push(feature);
				keptUnchanged++;
				continue;
			}

			if (!preparedBoundary.intersects(inputGeometry)) {
				droppedFeatures++;
				continue;
			}

			const clippedGeometry = OverlayOp.overlayOp(
				inputGeometry,
				boundaryGeometry,
				OverlayOp.INTERSECTION
			);

			if (!clippedGeometry || clippedGeometry.isEmpty()) {
				droppedFeatures++;
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
			keptUnchanged,
			intersectedFeatures,
			splitParts
		});

		return {
			...featureCollection,
			features: clippedFeatures
		};
	} catch (err) {
		if (strict) {
			throw err;
		}

		logger?.warn?.(`Boundary clip übersprungen: ${err?.message || String(err)}`);
		return featureCollection;
	}
}
