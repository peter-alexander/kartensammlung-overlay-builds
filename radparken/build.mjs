//npm install geos-wasm proj4

import fs from "node:fs/promises";
import path from "node:path";

import proj4 from "proj4";
import wellknown from "wellknown";

import { geosGeomToGeojson } from "geos-wasm/helpers";

proj4.defs(
	"EPSG:31257",
	"+proj=tmerc +lat_0=0 +lon_0=10.3333333333333 +k=1 +x_0=150000 +y_0=-5000000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs +type=crs"
);

const CONFIG = {
	inputDir: path.resolve(process.argv[2] ?? "./input"),
	outputDir: path.resolve(process.argv[3] ?? "./output"),
	streetFile: "STRASSENGRAPHOGD.json",
	parkingFile: "FAHRRADABSTELLANLAGEOGD.json",
	streetBufferMeters: 15,
	radii: [25, 45, 60, 70],
	lineChunkSize: 1500,
	pointChunkSize: 4000,
	bufferQuadrantSegments: 8,
	kGridSizeMeters: 512,
	iGridSizeMeters: 512
};

async function loadGeos() {
	const candidates = [
		() => import("geos-wasm"),
		() => import("geos-wasm/geos.esm.js"),
		() => import("./node_modules/geos-wasm/build/package/geos.esm.js")
	];

	const errors = [];

	for (const candidate of candidates) {
		try {
			const mod = await candidate();
			const initGeos = mod.default ?? mod;

			if (typeof initGeos === "function") {
				return await initGeos();
			}

			errors.push(new Error("Modul geladen, aber kein Init-Export gefunden."));
		}
		catch (error) {
			errors.push(error);
		}
	}

	throw new Error(
		"geos-wasm konnte nicht geladen werden:\n" +
		errors.map((error) => `- ${error.message}`).join("\n")
	);
}

function log(message) {
	const now = new Date().toISOString().replace("T", " ").replace(/\..+$/, "");
	console.log(`[${now}] ${message}`);
}

function requireFunctions(geos, names) {
	const missing = names.filter((name) => typeof geos[name] !== "function");

	if (missing.length) {
		throw new Error(`Fehlende GEOS-Funktionen: ${missing.join(", ")}`);
	}
}

function allocCString(geos, text) {
	const size = Buffer.byteLength(text, "utf8") + 1;
	const ptr = geos.Module._malloc(size);
	geos.Module.stringToUTF8(text, ptr, size);
	return ptr;
}

function readWkt(geos, reader, wkt) {
	const wktPtr = allocCString(geos, wkt);
	const geomPtr = geos.GEOSWKTReader_read(reader, wktPtr);
	geos.Module._free(wktPtr);

	if (!geomPtr) {
		throw new Error(`WKT konnte nicht gelesen werden.`);
	}

	return geomPtr;
}

function writeWkt(geos, writer, geomPtr) {
	const outPtr = geos.GEOSWKTWriter_write(writer, geomPtr);

	if (!outPtr) {
		throw new Error("WKT konnte nicht geschrieben werden.");
	}

	const wkt = geos.Module.UTF8ToString(outPtr);
	geos.GEOSFree(outPtr);
	return wkt;
}

function destroyGeom(geos, geomPtr) {
	if (geomPtr) {
		geos.GEOSGeom_destroy(geomPtr);
	}
}

function chunkArray(values, size) {
	const chunks = [];

	for (let i = 0; i < values.length; i += size) {
		chunks.push(values.slice(i, i + size));
	}

	return chunks;
}

function ringSignedArea(ring) {
	let area = 0;

	for (let i = 0; i < ring.length - 1; i += 1) {
		const [x1, y1] = ring[i];
		const [x2, y2] = ring[i + 1];
		area += (x1 * y2) - (x2 * y1);
	}

	return area / 2;
}

function ensureClosedRing(ring) {
	if (!Array.isArray(ring) || ring.length < 4) {
		return ring;
	}

	const first = ring[0];
	const last = ring[ring.length - 1];

	if (first[0] === last[0] && first[1] === last[1]) {
		return ring;
	}

	return [...ring, first];
}

function rewindRing(ring, clockwise) {
	const closed = ensureClosedRing(ring);
	const area = ringSignedArea(closed);
	const isClockwise = area < 0;

	if (clockwise === isClockwise) {
		return closed;
	}

	return [...closed].reverse();
}

function rewindPolygonCoordinates(coords) {
	if (!Array.isArray(coords) || coords.length === 0) {
		return coords;
	}

	return coords.map((ring, index) => {
		if (index === 0) {
			return rewindRing(ring, false);
		}

		return rewindRing(ring, true);
	});
}

function rewindGeometryRfc7946(geometry) {
	if (!geometry) {
		return geometry;
	}

	switch (geometry.type) {
		case "Polygon":
			return {
				type: "Polygon",
				coordinates: rewindPolygonCoordinates(geometry.coordinates)
			};

		case "MultiPolygon":
			return {
				type: "MultiPolygon",
				coordinates: geometry.coordinates.map((polygon) =>
					rewindPolygonCoordinates(polygon)
				)
			};

		case "GeometryCollection":
			return {
				type: "GeometryCollection",
				geometries: geometry.geometries.map((child) =>
					rewindGeometryRfc7946(child)
				)
			};

		default:
			return geometry;
	}
}

function geosGeometryToGeoJsonDirect(geos, geomPtr, { makeValid = false, orient = false, normalize = false } = {}) {
	let exportGeom = geomPtr;
	let madeValidGeom = null;

	try {
		if (makeValid && geos.GEOSisValid(exportGeom) !== 1) {
			madeValidGeom = geos.GEOSMakeValid(exportGeom);

			if (!madeValidGeom) {
				throw new Error("GEOSMakeValid fehlgeschlagen.");
			}

			exportGeom = madeValidGeom;
		}

		if (normalize) {
			const rc = geos.GEOSNormalize(exportGeom);

			if (rc !== 0) {
				throw new Error("GEOSNormalize fehlgeschlagen.");
			}
		}

		if (orient) {
			const rc = geos.GEOSOrientPolygons(exportGeom, 0);

			if (rc !== 0) {
				throw new Error("GEOSOrientPolygons fehlgeschlagen.");
			}
		}

		const geometry = geosGeomToGeojson(exportGeom, geos);

		if (!geometry || Number.isNaN(geometry?.coordinates?.[0]?.[0])) {
			return null;
		}

		return geometry;
	}
	finally {
		if (madeValidGeom) {
			destroyGeom(geos, madeValidGeom);
		}
	}
}

function buildBoxPolygonWkt(minX, minY, maxX, maxY) {
	return `POLYGON ((${minX} ${minY}, ${maxX} ${minY}, ${maxX} ${maxY}, ${minX} ${maxY}, ${minX} ${minY}))`;
}

function extendBbox(bbox, coord) {
	if (!Array.isArray(coord) || coord.length < 2) {
		return;
	}

	if (coord[0] < bbox[0]) bbox[0] = coord[0];
	if (coord[1] < bbox[1]) bbox[1] = coord[1];
	if (coord[0] > bbox[2]) bbox[2] = coord[0];
	if (coord[1] > bbox[3]) bbox[3] = coord[1];
}

function updateBboxFromGeometry(geometry, bbox) {
	if (!geometry) {
		return;
	}

	switch (geometry.type) {
		case "Point":
			extendBbox(bbox, geometry.coordinates);
			return;

		case "MultiPoint":
		case "LineString":
			for (const coord of geometry.coordinates) {
				extendBbox(bbox, coord);
			}
			return;

		case "MultiLineString":
		case "Polygon":
			for (const part of geometry.coordinates) {
				for (const coord of part) {
					extendBbox(bbox, coord);
				}
			}
			return;

		case "MultiPolygon":
			for (const polygon of geometry.coordinates) {
				for (const ring of polygon) {
					for (const coord of ring) {
						extendBbox(bbox, coord);
					}
				}
			}
			return;

		case "GeometryCollection":
			for (const child of geometry.geometries ?? []) {
				updateBboxFromGeometry(child, bbox);
			}
			return;

		default:
			throw new Error(`Nicht unterstützter Geometrietyp für BBox: ${geometry.type}`);
	}
}

function getGeometryBbox(geometry) {
	const bbox = [Infinity, Infinity, -Infinity, -Infinity];

	updateBboxFromGeometry(geometry, bbox);

	if (
		!Number.isFinite(bbox[0]) ||
		!Number.isFinite(bbox[1]) ||
		!Number.isFinite(bbox[2]) ||
		!Number.isFinite(bbox[3])
	) {
		throw new Error("BBox konnte nicht berechnet werden.");
	}

	return bbox;
}

function featuresToFeatureCollection(features) {
	return {
		type: "FeatureCollection",
		features
	};
}

function splitGeometryByGrid(geos, reader, geomPtr, layerName, radius, gridSizeMeters) {
	const geometry31257 = geosGeometryToGeoJsonDirect(geos, geomPtr, {
		makeValid: true,
		normalize: true,
		orient: true
	});

	if (!geometry31257) {
		return [];
	}

	const [minX, minY, maxX, maxY] = getGeometryBbox(geometry31257);
	const features = [];

	let cellIndex = 0;

	for (let x = minX; x < maxX; x += gridSizeMeters) {
		const x2 = Math.min(x + gridSizeMeters, maxX);

		for (let y = minY; y < maxY; y += gridSizeMeters) {
			const y2 = Math.min(y + gridSizeMeters, maxY);
			cellIndex += 1;

			const cellWkt = buildBoxPolygonWkt(x, y, x2, y2);
			const cellGeom = readWkt(geos, reader, cellWkt);

			let clippedGeom = null;

			try {
				clippedGeom = geos.GEOSIntersection(geomPtr, cellGeom);

				if (!clippedGeom) {
					throw new Error(`${layerName}: Grid-Schnitt fehlgeschlagen in Zelle ${cellIndex}.`);
				}

				const clipped31257 = geosGeometryToGeoJsonDirect(geos, clippedGeom, {
					makeValid: true,
					normalize: true,
					orient: true
				});

				if (!clipped31257) {
					continue;
				}

				const clipped4326 = projectGeometry(clipped31257, "EPSG:31257", "EPSG:4326");

				features.push({
					type: "Feature",
					properties: {
						layer: layerName,
						radius,
						cell: cellIndex
					},
					geometry: clipped4326
				});
			}
			finally {
				destroyGeom(geos, clippedGeom);
				destroyGeom(geos, cellGeom);
			}
		}
	}

	return features;
}

function projectCoord(coord, from = "EPSG:4326", to = "EPSG:31257") {
	return proj4(from, to, coord);
}

function projectGeometry(geometry, from = "EPSG:31257", to = "EPSG:4326") {
	if (!geometry) {
		return null;
	}

	switch (geometry.type) {
		case "Point":
			return {
				type: "Point",
				coordinates: projectCoord(geometry.coordinates, from, to)
			};

		case "MultiPoint":
		case "LineString":
			return {
				type: geometry.type,
				coordinates: geometry.coordinates.map((coord) => projectCoord(coord, from, to))
			};

		case "MultiLineString":
		case "Polygon":
			return {
				type: geometry.type,
				coordinates: geometry.coordinates.map((part) =>
					part.map((coord) => projectCoord(coord, from, to))
				)
			};

		case "MultiPolygon":
			return {
				type: "MultiPolygon",
				coordinates: geometry.coordinates.map((polygon) =>
					polygon.map((ring) =>
						ring.map((coord) => projectCoord(coord, from, to))
					)
				)
			};

		case "GeometryCollection":
			return {
				type: "GeometryCollection",
				geometries: geometry.geometries.map((child) => projectGeometry(child, from, to))
			};

		default:
			throw new Error(`Nicht unterstützter Geometrietyp: ${geometry.type}`);
	}
}

function collectPointsFromGeometry(geometry, target) {
	if (!geometry) {
		return;
	}

	switch (geometry.type) {
		case "Point":
			if (Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
				target.push(geometry.coordinates);
			}
			return;

		case "MultiPoint":
			for (const coord of geometry.coordinates) {
				if (Array.isArray(coord) && coord.length >= 2) {
					target.push(coord);
				}
			}
			return;

		case "GeometryCollection":
			for (const child of geometry.geometries ?? []) {
				collectPointsFromGeometry(child, target);
			}
			return;

		default:
			return;
	}
}

function collectLineStringsFromGeometry(geometry, target) {
	if (!geometry) {
		return;
	}

	switch (geometry.type) {
		case "LineString":
			if (Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
				target.push(geometry.coordinates);
			}
			return;

		case "MultiLineString":
			for (const line of geometry.coordinates) {
				if (Array.isArray(line) && line.length >= 2) {
					target.push(line);
				}
			}
			return;

		case "GeometryCollection":
			for (const child of geometry.geometries ?? []) {
				collectLineStringsFromGeometry(child, target);
			}
			return;

		default:
			return;
	}
}

async function loadFeatureCollection(filePath) {
	const raw = await fs.readFile(filePath, "utf8");
	const json = JSON.parse(raw);

	if (!json || json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
		throw new Error(`Keine gültige FeatureCollection: ${filePath}`);
	}

	return json;
}

function buildMultiPointWkt(points) {
	if (!points.length) {
		throw new Error("Keine Punkte für MULTIPOINT vorhanden.");
	}

	return `MULTIPOINT (${points.map(([x, y]) => `(${x} ${y})`).join(", ")})`;
}

function buildMultiLineStringWkt(lines) {
	if (!lines.length) {
		throw new Error("Keine Linien für MULTILINESTRING vorhanden.");
	}

	return `MULTILINESTRING (${lines.map((line) =>
		`(${line.map(([x, y]) => `${x} ${y}`).join(", ")})`
	).join(", ")})`;
}

function mapFeatureCollection(featureCollection, mapProperties) {
	return {
		type: "FeatureCollection",
		features: featureCollection.features.map((feature) => ({
			type: "Feature",
			properties: mapProperties(feature.properties ?? {}),
			geometry: feature.geometry
		}))
	};
}

function buildStreetOutputCollection(featureCollection) {
	return mapFeatureCollection(featureCollection, (properties) => {
		const result = {};

		if (properties.FEATURENAME != null) {
			result.name = properties.FEATURENAME;
		}
		if (properties.FRC != null) {
			result.FRC = properties.FRC;
		}

		return result;
	});
}

function buildParkingOutputCollection(featureCollection) {
	return {
		type: "FeatureCollection",
		features: featureCollection.features.map((feature) => {
			const result = {};

			if (feature.properties?.ANZAHL != null) {
				result.ANZAHL = feature.properties.ANZAHL;
			}

			return {
				type: "Feature",
				tippecanoe: {
					minzoom: 14
				},
				properties: result,
				geometry: feature.geometry
			};
		})
	};
}

function geometryToFeatureCollection(geometry, properties = {}) {
	if (!geometry) {
		return {
			type: "FeatureCollection",
			features: []
		};
	}

	return {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				properties,
				geometry
			}
		]
	};
}

async function writeJson(filePath, data) {
	await fs.writeFile(filePath, JSON.stringify(data));
}

function geosGeometryToGeoJson(geos, writer, geomPtr) {
	const wkt = writeWkt(geos, writer, geomPtr);

	if (/\bEMPTY\b/i.test(wkt)) {
		return null;
	}

	const geometry = wellknown.parse(wkt);

	if (!geometry) {
		throw new Error("WKT konnte nicht nach GeoJSON geparst werden.");
	}

	return geometry;
}

function unionMany(geos, geomPtrs, label) {
	if (!geomPtrs.length) {
		throw new Error(`Keine Geometrien für Union: ${label}`);
	}

	let round = 1;
	let current = geomPtrs.slice();

	while (current.length > 1) {
		log(`${label}: Union-Runde ${round}, ${current.length} Geometrien`);

		const next = [];

		for (let i = 0; i < current.length; i += 2) {
			const left = current[i];
			const right = current[i + 1];

			if (!right) {
				next.push(left);
				continue;
			}

			const merged = geos.GEOSUnion(left, right);

			destroyGeom(geos, left);
			destroyGeom(geos, right);

			if (!merged) {
				throw new Error(`${label}: GEOSUnion fehlgeschlagen.`);
			}

			next.push(merged);
		}

		current = next;
		round += 1;
	}

	return current[0];
}

function buildProjectedLineStrings(featureCollection) {
	const lines = [];

	for (const feature of featureCollection.features) {
		const rawLines = [];
		collectLineStringsFromGeometry(feature.geometry, rawLines);

		for (const line of rawLines) {
			const projected = line
				.filter((coord) => Array.isArray(coord) && coord.length >= 2)
				.map((coord) => projectCoord(coord));

			if (projected.length >= 2) {
				lines.push(projected);
			}
		}
	}

	return lines;
}

function buildProjectedPoints(featureCollection) {
	const points = [];

	for (const feature of featureCollection.features) {
		const rawPoints = [];
		collectPointsFromGeometry(feature.geometry, rawPoints);

		for (const point of rawPoints) {
			if (Array.isArray(point) && point.length >= 2) {
				points.push(projectCoord(point));
			}
		}
	}

	return points;
}

function buildRoadBuffer(geos, reader, projectedLines) {
	const lineChunks = chunkArray(projectedLines, CONFIG.lineChunkSize);
	const bufferedChunks = [];

	log(`Straßen: ${projectedLines.length} LineStrings in ${lineChunks.length} Chunk(s)`);

	for (let index = 0; index < lineChunks.length; index += 1) {
		const lines = lineChunks[index];
		log(`Straßen-Chunk ${index + 1}/${lineChunks.length}: ${lines.length} LineStrings`);

		const linesGeom = readWkt(geos, reader, buildMultiLineStringWkt(lines));
		const bufferGeom = geos.GEOSBuffer(
			linesGeom,
			CONFIG.streetBufferMeters,
			CONFIG.bufferQuadrantSegments
		);

		destroyGeom(geos, linesGeom);

		if (!bufferGeom) {
			throw new Error(`Straßen-Buffer fehlgeschlagen in Chunk ${index + 1}.`);
		}

		bufferedChunks.push(bufferGeom);
	}

	return unionMany(geos, bufferedChunks, "Straßenbuffer");
}

function buildParkingBufferForRadius(geos, reader, projectedPoints, radius) {
	log(`Radius ${radius}: ${projectedPoints.length} Punkte in 1 Chunk`);

	const pointsGeom = readWkt(geos, reader, buildMultiPointWkt(projectedPoints));

	let bufferGeom = null;
	let unionGeom = null;

	try {
		bufferGeom = geos.GEOSBuffer(
			pointsGeom,
			radius,
			CONFIG.bufferQuadrantSegments
		);

		if (!bufferGeom) {
			throw new Error(`Punkt-Buffer fehlgeschlagen für Radius ${radius}.`);
		}

		unionGeom = geos.GEOSUnaryUnion(bufferGeom);

		if (!unionGeom) {
			throw new Error(`GEOSUnaryUnion fehlgeschlagen für Radius ${radius}.`);
		}

		return unionGeom;
	}
	finally {
		destroyGeom(geos, bufferGeom);
		destroyGeom(geos, pointsGeom);
	}
}

async function main() {
	log(`Input:  ${CONFIG.inputDir}`);
	log(`Output: ${CONFIG.outputDir}`);

	await fs.mkdir(CONFIG.outputDir, { recursive: true });

	const streetInputPath = path.join(CONFIG.inputDir, CONFIG.streetFile);
	const parkingInputPath = path.join(CONFIG.inputDir, CONFIG.parkingFile);

	const streetOutputPath = path.join(CONFIG.outputDir, CONFIG.streetFile);
	const parkingOutputPath = path.join(CONFIG.outputDir, CONFIG.parkingFile);

	log("Lade GeoJSON-Dateien");
	const [streetCollection, parkingCollection] = await Promise.all([
		loadFeatureCollection(streetInputPath),
		loadFeatureCollection(parkingInputPath)
	]);

	log(`Straßen-Features: ${streetCollection.features.length}`);
	log(`Abstellanlagen-Features: ${parkingCollection.features.length}`);

	log("Projiziere Straßen");
	const projectedLines = buildProjectedLineStrings(streetCollection);

	log("Projiziere Abstellanlagen");
	const projectedPoints = buildProjectedPoints(parkingCollection);

	log(`Projizierte LineStrings: ${projectedLines.length}`);
	log(`Projizierte Punkte: ${projectedPoints.length}`);

	if (!projectedLines.length) {
		throw new Error("Keine verarbeitbaren Straßen gefunden.");
	}

	if (!projectedPoints.length) {
		throw new Error("Keine verarbeitbaren Abstellanlagen gefunden.");
	}

    log("Verarbeite Input-Dateien für Output");
    
    const streetOutputCollection = buildStreetOutputCollection(streetCollection);
    const parkingOutputCollection = buildParkingOutputCollection(parkingCollection);
    
    await Promise.all([
    	writeJson(streetOutputPath, streetOutputCollection),
    	writeJson(parkingOutputPath, parkingOutputCollection)
    ]);

	const geos = await loadGeos();

    requireFunctions(geos, [
    	"GEOSWKTReader_create",
    	"GEOSWKTReader_read",
    	"GEOSWKTReader_destroy",
    	"GEOSWKTWriter_create",
    	"GEOSWKTWriter_write",
    	"GEOSWKTWriter_destroy",
    	"GEOSGeom_destroy",
    	"GEOSBuffer",
    	"GEOSUnaryUnion",
    	"GEOSUnion",
    	"GEOSIntersection",
    	"GEOSFree"
    ]);

	const reader = geos.GEOSWKTReader_create();
	const writer = geos.GEOSWKTWriter_create();

	let roadBufferGeom = null;

	try {
		log("Berechne internen Straßenbuffer");
		roadBufferGeom = buildRoadBuffer(geos, reader, projectedLines);

        for (const radius of CONFIG.radii) {
        	let kGeom = null;
        	let iGeom = null;
        
        	try {
        		log(`Berechne k${radius}`);
        		kGeom = buildParkingBufferForRadius(geos, reader, projectedPoints, radius);
        
        		log(`Berechne i${radius}`);
        		iGeom = geos.GEOSIntersection(kGeom, roadBufferGeom);
        
        		if (!iGeom) {
        			throw new Error(`GEOSIntersection fehlgeschlagen für Radius ${radius}.`);
        		}
        
        		const kProjected = geosGeometryToGeoJsonDirect(geos, kGeom, {
        			makeValid: true,
        			normalize: true,
        			orient: true
        		});
        		const k4326 = projectGeometry(kProjected, "EPSG:31257", "EPSG:4326");
        
        		const kOutputPath = path.join(CONFIG.outputDir, `k${radius}.geojson`);
        		const iOutputPath = path.join(CONFIG.outputDir, `i${radius}.geojson`);
        
        		log(`Schreibe ${path.basename(kOutputPath)}`);
        		await writeJson(
        			kOutputPath,
        			geometryToFeatureCollection(k4326, {
        				layer: `k${radius}`,
        				radius
        			})
        		);
        
        		log(`Zerlege i${radius} in Grid ${CONFIG.iGridSizeMeters} m`);
        		const iFeatures = splitGeometryByGrid(
        			geos,
        			reader,
        			iGeom,
        			`i${radius}`,
        			radius,
        			CONFIG.iGridSizeMeters
        		);
        
        		log(`i${radius}: ${iFeatures.length} Teil-Feature(s)`);
        
        		log(`Schreibe ${path.basename(iOutputPath)}`);
        		await writeJson(
        			iOutputPath,
        			featuresToFeatureCollection(iFeatures)
        		);
        	}
        	finally {
        		destroyGeom(geos, iGeom);
        		destroyGeom(geos, kGeom);
        	}
        }

		const summaryPath = path.join(CONFIG.outputDir, "build-summary.json");
		await writeJson(summaryPath, {
			createdAt: new Date().toISOString(),
			streetFeatures: streetCollection.features.length,
			parkingFeatures: parkingCollection.features.length,
			projectedLineStrings: projectedLines.length,
			projectedPoints: projectedPoints.length,
			streetBufferMeters: CONFIG.streetBufferMeters,
			radii: CONFIG.radii
		});

		log("Fertig");
	}
	finally {
		destroyGeom(geos, roadBufferGeom);
		geos.GEOSWKTWriter_destroy(writer);
		geos.GEOSWKTReader_destroy(reader);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
