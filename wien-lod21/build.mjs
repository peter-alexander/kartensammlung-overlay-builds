#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import earcut from "earcut";
import proj4 from "proj4";
import GeoJSONReader from "jsts/org/locationtech/jts/io/GeoJSONReader.js";
import GeoJSONWriter from "jsts/org/locationtech/jts/io/GeoJSONWriter.js";
import OverlayOp from "jsts/org/locationtech/jts/operation/overlay/OverlayOp.js";
import SnapIfNeededOverlayOp from "jsts/org/locationtech/jts/operation/overlay/snap/SnapIfNeededOverlayOp.js";
import UnionOp from "jsts/org/locationtech/jts/operation/union/UnionOp.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import GeometryPrecisionReducer from "jsts/org/locationtech/jts/precision/GeometryPrecisionReducer.js";

const GML_NS = "http://www.opengis.net/gml";
const BLDG_NS = "http://www.opengis.net/citygml/building/1.0";
const SOURCE_CRS = "EPSG:31256";
const TARGET_CRS = "EPSG:4326";
const MAGIC = "KSL21B01";
const FORMAT_VERSION = 1;
const VERTEX_STRIDE = 16;
const XY_QUANTIZATION = 4;
const EARTH_RADIUS_M = 6_371_008.8;
const ROOF_MIN_UP_NORMAL = 0.2;
const FLAT_ROOF_MIN_UP_NORMAL = 0.985;
const HYBRID_HISTORY_BUFFER_M = 0;
const HYBRID_MAX_SLIVER_MEAN_WIDTH_M = 0.05;

proj4.defs(
	SOURCE_CRS,
	"+proj=tmerc +lat_0=0 +lon_0=16.3333333333333 +k=1 +x_0=0 +y_0=-5000000 "
	+ "+ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 "
	+ "+units=m +no_defs +type=crs"
);

function parseArgs(argv) {
	const result = {
		input: path.resolve("wien-lod21/build/source"),
		output: path.resolve("wien-lod21/build/WienBuildingsLOD21"),
		targets: path.resolve("wien-lod21/targets.pilot.json"),
		hybridCurrent: ""
	};
	for (let index = 2; index < argv.length; index += 1) {
		const arg = argv[index];
		const value = argv[index + 1];
		if (arg === "--input") {
			result.input = path.resolve(value);
			index += 1;
		} else if (arg === "--output") {
			result.output = path.resolve(value);
			index += 1;
		} else if (arg === "--targets") {
			result.targets = path.resolve(value);
			index += 1;
		} else if (arg === "--hybrid-current") {
			result.hybridCurrent = path.resolve(value);
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return result;
}

function finiteNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function localName(node) {
	return String(node?.localName || node?.nodeName || "").replace(/^.*:/, "");
}

function elementChildren(node) {
	const result = [];
	for (let child = node?.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === 1) result.push(child);
	}
	return result;
}

function directChildByName(node, name) {
	return elementChildren(node).find((child) => localName(child) === name) || null;
}

function descendantByName(node, namespace, name) {
	return node?.getElementsByTagNameNS?.(namespace, name)?.[0] || null;
}

function textContent(node) {
	return String(node?.textContent || "").trim();
}

function openRing(points) {
	const result = [];
	for (const point of points || []) {
		if (
			!result.length
			|| result[result.length - 1].x !== point.x
			|| result[result.length - 1].y !== point.y
			|| result[result.length - 1].z !== point.z
		) {
			result.push(point);
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

function parseLinearRing(linearRing) {
	const posList = descendantByName(linearRing, GML_NS, "posList");
	if (posList) {
		const values = textContent(posList)
			.split(/\s+/)
			.map(Number)
			.filter(Number.isFinite);
		if (values.length < 9 || values.length % 3 !== 0) return [];
		const points = [];
		for (let index = 0; index < values.length; index += 3) {
			points.push({
				x: values[index],
				y: values[index + 1],
				z: values[index + 2]
			});
		}
		return openRing(points);
	}

	const positions = linearRing?.getElementsByTagNameNS?.(GML_NS, "pos") || [];
	const points = [];
	for (let index = 0; index < positions.length; index += 1) {
		const values = textContent(positions[index])
			.split(/\s+/)
			.map(Number)
			.filter(Number.isFinite);
		if (values.length >= 3) {
			points.push({ x: values[0], y: values[1], z: values[2] });
		}
	}
	return openRing(points);
}

function parsePolygon(polygon) {
	const rings = [];
	const exterior = descendantByName(
		descendantByName(polygon, GML_NS, "exterior"),
		GML_NS,
		"LinearRing"
	);
	const outer = parseLinearRing(exterior);
	if (outer.length >= 3) rings.push(outer);

	const interiors = polygon?.getElementsByTagNameNS?.(GML_NS, "interior") || [];
	for (let index = 0; index < interiors.length; index += 1) {
		const ring = parseLinearRing(descendantByName(interiors[index], GML_NS, "LinearRing"));
		if (ring.length >= 3) rings.push(ring);
	}
	return rings;
}

function semanticSurfaceKind(surfaceNode) {
	switch (localName(surfaceNode)) {
		case "RoofSurface":
			return "roof";
		case "WallSurface":
			return "wall";
		case "GroundSurface":
			return "ground";
		default:
			return "other";
	}
}

function parseSemanticSurfaces(building) {
	const surfaces = [];
	const boundedBy = building.getElementsByTagNameNS(BLDG_NS, "boundedBy");
	for (let index = 0; index < boundedBy.length; index += 1) {
		const surfaceNode = elementChildren(boundedBy[index])[0];
		if (!surfaceNode) continue;
		const semantic = semanticSurfaceKind(surfaceNode);
		const polygons = surfaceNode.getElementsByTagNameNS(GML_NS, "Polygon");
		for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
			const rings = parsePolygon(polygons[polygonIndex]);
			if (rings.length) surfaces.push({ semantic, rings });
		}
	}
	return surfaces;
}

function normalize3(vector) {
	const length = Math.hypot(vector.x, vector.y, vector.z);
	if (!(length > 1e-12)) return null;
	return {
		x: vector.x / length,
		y: vector.y / length,
		z: vector.z / length
	};
}

function cross3(a, b) {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x
	};
}

function sub3(a, b) {
	return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot3(a, b) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

function newellNormal(ring) {
	if (!ring || ring.length < 3) return null;
	let x = 0;
	let y = 0;
	let z = 0;
	for (let index = 0; index < ring.length; index += 1) {
		const current = ring[index];
		const next = ring[(index + 1) % ring.length];
		x += (current.y - next.y) * (current.z + next.z);
		y += (current.z - next.z) * (current.x + next.x);
		z += (current.x - next.x) * (current.y + next.y);
	}
	return normalize3({ x, y, z });
}

function worldX(lng, zoom) {
	return (lng + 180) / 360 * 2 ** zoom;
}

function worldY(lat, zoom) {
	const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
	const radians = clamped * Math.PI / 180;
	return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * 2 ** zoom;
}

function sourcePointToLngLat(point) {
	const [lng, lat] = proj4(SOURCE_CRS, TARGET_CRS, [point.x, point.y]);
	return { lng, lat, z: point.z };
}

function haversineMeters(a, b) {
	const toRadians = (value) => value * Math.PI / 180;
	const lat1 = toRadians(a.lat);
	const lat2 = toRadians(b.lat);
	const deltaLat = lat2 - lat1;
	const deltaLng = toRadians(b.lng - a.lng);
	const sinLat = Math.sin(deltaLat / 2);
	const sinLng = Math.sin(deltaLng / 2);
	const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getSurfacePoints(surfaces) {
	return surfaces.flatMap((surface) => surface.rings.flat());
}

function boundsCenter(points) {
	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const zs = points.map((point) => point.z);
	return {
		x: (Math.min(...xs) + Math.max(...xs)) / 2,
		y: (Math.min(...ys) + Math.max(...ys)) / 2,
		z: (Math.min(...zs) + Math.max(...zs)) / 2
	};
}

function tileCoordinateForPoint(point, zoom) {
	const projected = sourcePointToLngLat(point);
	return {
		z: zoom,
		x: Math.floor(worldX(projected.lng, zoom)),
		y: Math.floor(worldY(projected.lat, zoom))
	};
}

function tileKey(tile) {
	return `${tile.z}/${tile.x}/${tile.y}`;
}

function metersPerRenderUnit(tile, extent) {
	const n = 2 ** tile.z;
	const worldYCenter = (tile.y + 0.5) / n;
	const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * worldYCenter)));
	const earthCircumference = 40_075_016.68557849;
	return earthCircumference * Math.cos(lat) / n / extent;
}

function snapTilePoint(point) {
	return {
		x: Math.round(point.x * XY_QUANTIZATION) / XY_QUANTIZATION,
		y: Math.round(point.y * XY_QUANTIZATION) / XY_QUANTIZATION,
		z: Math.round(point.z * 100) / 100
	};
}

function transformRingToTile(ring, tile, extent, baseZ) {
	return ring.map((point) => {
		const { lng, lat } = sourcePointToLngLat(point);
		return snapTilePoint({
			x: (worldX(lng, tile.z) - tile.x) * extent,
			y: (worldY(lat, tile.z) - tile.y) * extent,
			z: point.z - baseZ
		});
	}).reverse();
}

function repairSemanticOrientation(rings, semantic, metersPerUnit) {
	const toMetric = (point) => ({
		x: point.x * metersPerUnit,
		y: point.y * metersPerUnit,
		z: point.z
	});
	let metric = rings[0].map(toMetric);
	let normal = newellNormal(metric);
	if (!normal) return null;

	const wrongRoof = semantic === "roof" && normal.z < 0;
	const wrongGround = semantic === "ground" && normal.z > 0;
	if (wrongRoof || wrongGround) {
		for (const ring of rings) ring.reverse();
		metric = rings[0].map(toMetric);
		normal = newellNormal(metric);
	}
	return normal;
}

function projectRings(rings, normal, metersPerUnit) {
	const reference = Math.abs(normal.z) < 0.9
		? { x: 0, y: 0, z: 1 }
		: { x: 1, y: 0, z: 0 };
	const axisU = normalize3(cross3(reference, normal));
	if (!axisU) return null;
	const axisV = normalize3(cross3(normal, axisU));
	if (!axisV) return null;

	const vertices = [];
	const flat = [];
	const holes = [];
	let vertexCount = 0;
	for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
		if (ringIndex > 0) holes.push(vertexCount);
		for (const point of rings[ringIndex]) {
			const metric = {
				x: point.x * metersPerUnit,
				y: point.y * metersPerUnit,
				z: point.z
			};
			vertices.push(point);
			flat.push(dot3(metric, axisU), dot3(metric, axisV));
			vertexCount += 1;
		}
	}
	return { vertices, flat, holes };
}

function surfaceKind(semantic, normal) {
	if (semantic === "wall" || semantic === "ground") return 0;
	const up = Math.abs(normal.z);
	if (semantic !== "roof" && up < ROOF_MIN_UP_NORMAL) return 0;
	return up >= FLAT_ROOF_MIN_UP_NORMAL ? 2 : 1;
}

function triangulateSurface(surface, tile, extent, baseZ) {
	const metersPerUnit = metersPerRenderUnit(tile, extent);
	const rings = surface.rings
		.map((ring) => transformRingToTile(ring, tile, extent, baseZ))
		.filter((ring) => ring.length >= 3);
	if (!rings.length) return null;

	const normal = repairSemanticOrientation(rings, surface.semantic, metersPerUnit);
	if (!normal) return null;
	const projected = projectRings(rings, normal, metersPerUnit);
	if (!projected) return null;

	const rawIndices = earcut(projected.flat, projected.holes, 2);
	if (rawIndices.length < 3) return null;
	const indices = [];
	for (let offset = 0; offset < rawIndices.length; offset += 3) {
		let a = rawIndices[offset];
		let b = rawIndices[offset + 1];
		let c = rawIndices[offset + 2];
		const pa = projected.vertices[a];
		const pb = projected.vertices[b];
		const pc = projected.vertices[c];
		const va = {
			x: pa.x * metersPerUnit,
			y: pa.y * metersPerUnit,
			z: pa.z
		};
		const vb = {
			x: pb.x * metersPerUnit,
			y: pb.y * metersPerUnit,
			z: pb.z
		};
		const vc = {
			x: pc.x * metersPerUnit,
			y: pc.y * metersPerUnit,
			z: pc.z
		};
		const triangleNormal = cross3(sub3(vb, va), sub3(vc, va));
		const triangleLength = Math.hypot(
			triangleNormal.x,
			triangleNormal.y,
			triangleNormal.z
		);
		if (triangleLength <= 1e-8) continue;
		if (dot3(triangleNormal, normal) < 0) {
			const swap = b;
			b = c;
			c = swap;
		}
		indices.push(a, b, c);
	}
	return {
		vertices: projected.vertices,
		indices,
		normal,
		kind: surfaceKind(surface.semantic, normal)
	};
}

function nodeAttribute(node, namespace, name) {
	return String(node?.getAttributeNS?.(namespace, name) || node?.getAttribute?.(`gml:${name}`) || "");
}

function buildingName(building) {
	const direct = directChildByName(building, "name");
	if (direct) return textContent(direct);
	return textContent(descendantByName(building, GML_NS, "name"));
}

function buildingRoofType(building) {
	return textContent(descendantByName(building, BLDG_NS, "roofType"));
}

function buildingCreationDate(building) {
	if (!building?.getElementsByTagNameNS) return "";
	const elements = building.getElementsByTagNameNS(
		"http://www.opengis.net/citygml/1.0",
		"creationDate"
	);
	return textContent(elements?.[0]);
}

function extractEnvelopeSrsName(xml) {
	const match = String(xml).match(
		/<(?:[A-Za-z_][\w.-]*:)?Envelope\b[^>]*\bsrsName=(["'])(.*?)\1/i
	);
	return String(match?.[2] || "");
}

function extractFirstLocalTagText(xml, name) {
	const escaped = String(name).replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
	const expression = new RegExp(
		"<(?:[A-Za-z_][\\w.-]*:)?" + escaped
		+ "\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?"
		+ escaped + ">",
		"i"
	);
	const match = String(xml).match(expression);
	return match ? String(match[1]).replace(/<[^>]+>/g, "").trim() : "";
}

function *buildingXmlMatches(xml) {
	const expression = /<(?:[A-Za-z_][\w.-]*:)?Building\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?Building>/g;
	let match;
	while ((match = expression.exec(String(xml)))) {
		yield match[0];
	}
}

function parseBuildingFragment(buildingXml, filePath) {
	const wrapped = [
		'<ks:root xmlns:ks="urn:kartensammlung:wien-lod21"',
		' xmlns:gml="http://www.opengis.net/gml"',
		' xmlns:bldg="http://www.opengis.net/citygml/building/1.0"',
		' xmlns:core="http://www.opengis.net/citygml/1.0"',
		' xmlns:xlink="http://www.w3.org/1999/xlink"',
		' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
		buildingXml,
		"</ks:root>"
	].join("");
	const document = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: (message) => {
				throw new Error(`CityGML building parse error in ${filePath}: ${message}`);
			},
			fatalError: (message) => {
				throw new Error(`CityGML building fatal parse error in ${filePath}: ${message}`);
			}
		}
	}).parseFromString(wrapped, "application/xml");
	return document.getElementsByTagNameNS(BLDG_NS, "Building")[0] || null;
}

async function listFilesRecursive(root) {
	const result = [];
	async function visit(directory) {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await visit(fullPath);
			} else if (/\.gml$/i.test(entry.name)) {
				result.push(fullPath);
			}
		}
	}
	await visit(root);
	return result.sort();
}

function sourceSheetFromPath(filePath) {
	const base = path.basename(filePath, path.extname(filePath));
	return /^\d{6}$/.test(base) ? base : "";
}

function ensureQuantizedVertex(vertex, extent) {
	const origin = extent / 2;
	const x = Math.round((vertex.x - origin) * XY_QUANTIZATION);
	const y = Math.round((vertex.y - origin) * XY_QUANTIZATION);
	const zCm = Math.round(vertex.z * 100);
	if (x < -32768 || x > 32767 || y < -32768 || y > 32767) {
		throw new Error(
			`LOD2.1 vertex exceeds signed tile-local range after `
			+ `1/${XY_QUANTIZATION} quantization: ${vertex.x}, ${vertex.y}`
		);
	}
	if (zCm < 0 || zCm > 65535) {
		throw new Error(`LOD2.1 relative height exceeds UInt16 centimetres: ${zCm}`);
	}
	return { x, y, zCm };
}

function vertexCount(tileData) {
	return tileData.vertices.length / 7;
}

function pushVertex(tileData, vertex) {
	tileData.vertices.push(
		vertex.x,
		vertex.y,
		vertex.z,
		vertex.nx,
		vertex.ny,
		vertex.nz,
		vertex.kind
	);
}

function encodeTile(tile, tileData, extent) {
	const metadata = {
		schemaVersion: 1,
		tile,
		extent,
		vertexStride: VERTEX_STRIDE,
		quantization: {
			xyRenderUnits: 1 / XY_QUANTIZATION,
			xyOrigin: extent / 2,
			zMeters: 0.01,
			normalScale: 32767
		},
		buildings: tileData.buildings
	};
	const metadataBytes = Buffer.from(JSON.stringify(metadata), "utf8");
	const metadataPadding = (4 - (metadataBytes.length % 4)) % 4;
	const headerBytes = 32;
	const totalVertices = vertexCount(tileData);
	const vertexBytes = totalVertices * VERTEX_STRIDE;
	const indexBytes = tileData.indices.length * 4;
	const output = Buffer.alloc(
		headerBytes + metadataBytes.length + metadataPadding + vertexBytes + indexBytes
	);

	output.write(MAGIC, 0, 8, "ascii");
	output.writeUInt32LE(FORMAT_VERSION, 8);
	output.writeUInt32LE(extent, 12);
	output.writeUInt32LE(totalVertices, 16);
	output.writeUInt32LE(tileData.indices.length, 20);
	output.writeUInt32LE(tileData.buildings.length, 24);
	output.writeUInt32LE(metadataBytes.length, 28);
	metadataBytes.copy(output, headerBytes);

	let offset = headerBytes + metadataBytes.length + metadataPadding;
	for (let index = 0; index < tileData.vertices.length; index += 7) {
		const vertex = {
			x: tileData.vertices[index],
			y: tileData.vertices[index + 1],
			z: tileData.vertices[index + 2],
			nx: tileData.vertices[index + 3],
			ny: tileData.vertices[index + 4],
			nz: tileData.vertices[index + 5],
			kind: tileData.vertices[index + 6]
		};
		const quantized = ensureQuantizedVertex(vertex, extent);
		output.writeInt16LE(quantized.x, offset);
		output.writeInt16LE(quantized.y, offset + 2);
		output.writeUInt16LE(quantized.zCm, offset + 4);
		output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, vertex.nx)) * 32767), offset + 6);
		output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, vertex.ny)) * 32767), offset + 8);
		output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, vertex.nz)) * 32767), offset + 10);
		output.writeUInt8(vertex.kind, offset + 12);
		output.writeUInt8(0, offset + 13);
		output.writeUInt16LE(0, offset + 14);
		offset += VERTEX_STRIDE;
	}
	for (const index of tileData.indices) {
		output.writeUInt32LE(index, offset);
		offset += 4;
	}
	return output;
}


function closeSourceRing(ring) {
	const coordinates = (ring || []).map((point) => [Number(point.x), Number(point.y)]);
	if (
		coordinates.length
		&& (
			coordinates[0][0] !== coordinates[coordinates.length - 1][0]
			|| coordinates[0][1] !== coordinates[coordinates.length - 1][1]
		)
	) {
		coordinates.push([...coordinates[0]]);
	}
	return coordinates;
}

function repairJstsGeometry(geometry) {
	if (!geometry || geometry.isEmpty()) return null;
	try {
		return BufferOp.bufferOp(geometry, 0);
	} catch {
		return geometry;
	}
}

function unionJstsGeometries(geometries) {
	let result = null;
	for (const geometry of geometries || []) {
		const repaired = repairJstsGeometry(geometry);
		if (!repaired || repaired.isEmpty()) continue;
		try {
			result = result ? UnionOp.union(result, repaired) : repaired;
		} catch {
			const repairedResult = repairJstsGeometry(result);
			result = repairedResult ? UnionOp.union(repairedResult, repaired) : repaired;
		}
	}
	return result;
}

function differenceJstsGeometry(current, historical, context = "") {
	try {
		return OverlayOp.overlayOp(current, historical, OverlayOp.DIFFERENCE);
	} catch (error) {
		const repairedCurrent = repairJstsGeometry(current);
		const repairedHistorical = repairJstsGeometry(historical);
		if (!repairedCurrent || !repairedHistorical) return null;
		try {
			console.warn(
				"Hybrid difference uses snap overlay"
				+ (context ? " for " + context : "")
				+ ": " + (error?.message || error)
			);
			return SnapIfNeededOverlayOp.overlayOp(
				repairedCurrent,
				repairedHistorical,
				OverlayOp.DIFFERENCE
			);
		} catch (snapError) {
			const precision = new PrecisionModel(1000);
			const preciseCurrent = GeometryPrecisionReducer.reduce(
				repairedCurrent,
				precision
			);
			const preciseHistorical = GeometryPrecisionReducer.reduce(
				repairedHistorical,
				precision
			);
			console.warn(
				"Hybrid difference uses 1 mm precision reduction"
				+ (context ? " for " + context : "")
				+ ": " + (snapError?.message || snapError)
			);
			return SnapIfNeededOverlayOp.overlayOp(
				preciseCurrent,
				preciseHistorical,
				OverlayOp.DIFFERENCE
			);
		}
	}
}

function intersectionJstsGeometry(a, b, context = "") {
	try {
		return OverlayOp.overlayOp(a, b, OverlayOp.INTERSECTION);
	} catch (error) {
		const repairedA = repairJstsGeometry(a);
		const repairedB = repairJstsGeometry(b);
		if (!repairedA || !repairedB) return null;
		try {
			console.warn(
				"Hybrid intersection uses snap overlay"
				+ (context ? " for " + context : "")
				+ ": " + (error?.message || error)
			);
			return SnapIfNeededOverlayOp.overlayOp(
				repairedA,
				repairedB,
				OverlayOp.INTERSECTION
			);
		} catch (snapError) {
			const precision = new PrecisionModel(1000);
			const preciseA = GeometryPrecisionReducer.reduce(repairedA, precision);
			const preciseB = GeometryPrecisionReducer.reduce(repairedB, precision);
			console.warn(
				"Hybrid intersection uses 1 mm precision reduction"
				+ (context ? " for " + context : "")
				+ ": " + (snapError?.message || snapError)
			);
			return SnapIfNeededOverlayOp.overlayOp(
				preciseA,
				preciseB,
				OverlayOp.INTERSECTION
			);
		}
	}
}

function groundGeometryFromSurfaces(surfaces, reader) {
	const geometries = [];
	for (const surface of surfaces || []) {
		if (surface.semantic !== "ground" || !surface.rings?.length) continue;
		const coordinates = surface.rings
			.map(closeSourceRing)
			.filter((ring) => ring.length >= 4);
		if (!coordinates.length) continue;
		try {
			geometries.push(reader.read({
				type: "Polygon",
				coordinates
			}));
		} catch {}
	}
	return unionJstsGeometries(geometries);
}

function jstsGeometryParts(geometry) {
	if (!geometry || geometry.isEmpty()) return [];
	const count = Number(geometry.getNumGeometries?.() || 1);
	const result = [];
	for (let index = 0; index < count; index += 1) {
		const part = count === 1 ? geometry : geometry.getGeometryN(index);
		if (!part || part.isEmpty()) continue;
		result.push(part);
	}
	return result;
}

function polygonGeoJsonParts(geometry, writer) {
	if (!geometry || geometry.isEmpty()) return [];
	const geojson = writer.write(geometry);
	if (!geojson) return [];
	if (geojson.type === "Polygon") return [geojson.coordinates];
	if (geojson.type === "MultiPolygon") return geojson.coordinates;
	if (geojson.type === "GeometryCollection") {
		return (geojson.geometries || []).flatMap((item) => {
			if (item.type === "Polygon") return [item.coordinates];
			if (item.type === "MultiPolygon") return item.coordinates;
			return [];
		});
	}
	return [];
}

function polygonalJstsGeometry(geometry, reader, writer) {
	const polygons = [];
	for (const coordinates of polygonGeoJsonParts(geometry, writer)) {
		try {
			const polygon = reader.read({
				type: "Polygon",
				coordinates
			});
			if (polygon && !polygon.isEmpty()) polygons.push(polygon);
		} catch {}
	}
	return unionJstsGeometries(polygons);
}

function signedArea2D(ring) {
	let area = 0;
	for (let index = 0; index + 1 < ring.length; index += 1) {
		area += ring[index][0] * ring[index + 1][1]
			- ring[index + 1][0] * ring[index][1];
	}
	return area / 2;
}

function normalizeOpen2DRing(ring, ccw) {
	const points = [];
	for (const coordinate of ring || []) {
		const point = [Number(coordinate[0]), Number(coordinate[1])];
		if (
			!points.length
			|| points[points.length - 1][0] !== point[0]
			|| points[points.length - 1][1] !== point[1]
		) {
			points.push(point);
		}
	}
	if (
		points.length > 1
		&& points[0][0] === points[points.length - 1][0]
		&& points[0][1] === points[points.length - 1][1]
	) {
		points.pop();
	}
	if (points.length < 3) return [];
	const closed = [...points, points[0]];
	const isCcw = signedArea2D(closed) > 0;
	if (isCcw !== ccw) points.reverse();
	return points;
}

function boundarySegmentIndexFromGeometry(
	geometry,
	writer,
	cellSizeM = 5
) {
	const segments = [];
	const cells = new Map();
	const geojson = writer.write(geometry);
	const polygons = geojson?.type === "Polygon"
		? [geojson.coordinates]
		: geojson?.type === "MultiPolygon"
			? geojson.coordinates
			: [];

	const cellKey = (x, y) => x + ":" + y;
	const addSegment = (a, b) => {
		const segmentIndex = segments.length;
		segments.push([a, b]);
		const minCellX = Math.floor(Math.min(a[0], b[0]) / cellSizeM);
		const maxCellX = Math.floor(Math.max(a[0], b[0]) / cellSizeM);
		const minCellY = Math.floor(Math.min(a[1], b[1]) / cellSizeM);
		const maxCellY = Math.floor(Math.max(a[1], b[1]) / cellSizeM);
		for (let x = minCellX; x <= maxCellX; x += 1) {
			for (let y = minCellY; y <= maxCellY; y += 1) {
				const key = cellKey(x, y);
				if (!cells.has(key)) cells.set(key, []);
				cells.get(key).push(segmentIndex);
			}
		}
	};

	for (const polygon of polygons) {
		for (const ring of polygon || []) {
			for (let index = 0; index + 1 < ring.length; index += 1) {
				const a = ring[index];
				const b = ring[index + 1];
				if (
					!Number.isFinite(Number(a?.[0]))
					|| !Number.isFinite(Number(a?.[1]))
					|| !Number.isFinite(Number(b?.[0]))
					|| !Number.isFinite(Number(b?.[1]))
				) continue;
				addSegment(
					[Number(a[0]), Number(a[1])],
					[Number(b[0]), Number(b[1])]
				);
			}
		}
	}
	return { segments, cells, cellSizeM };
}

function pointToSegmentDistance(point, a, b) {
	const vx = b[0] - a[0];
	const vy = b[1] - a[1];
	const lengthSquared = vx * vx + vy * vy;
	if (!(lengthSquared > 0)) {
		return Math.hypot(point[0] - a[0], point[1] - a[1]);
	}
	const t = Math.max(0, Math.min(
		1,
		((point[0] - a[0]) * vx + (point[1] - a[1]) * vy)
			/ lengthSquared
	));
	return Math.hypot(
		point[0] - (a[0] + t * vx),
		point[1] - (a[1] + t * vy)
	);
}

function nearbyBoundarySegments(point, index) {
	if (!index?.segments?.length) return [];
	const cellX = Math.floor(point[0] / index.cellSizeM);
	const cellY = Math.floor(point[1] / index.cellSizeM);
	const indices = new Set();
	for (let dx = -1; dx <= 1; dx += 1) {
		for (let dy = -1; dy <= 1; dy += 1) {
			for (
				const segmentIndex
				of index.cells.get((cellX + dx) + ":" + (cellY + dy)) || []
			) {
				indices.add(segmentIndex);
			}
		}
	}
	return [...indices].map((segmentIndex) => index.segments[segmentIndex]);
}

function edgeLiesOnBoundary(a, b, boundaryIndex, toleranceM = 0.01) {
	if (!boundaryIndex?.segments?.length) return false;
	const samples = [0.25, 0.5, 0.75].map((t) => [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t
	]);
	return samples.every((point) => (
		nearbyBoundarySegments(point, boundaryIndex).some(([start, end]) => (
			pointToSegmentDistance(point, start, end) <= toleranceM
		))
	));
}

function currentFeatureLevels(properties = {}) {
	const roofZ = finiteNumber(properties.O_KOTE);
	const terrainZ = finiteNumber(properties.T_KOTE)
		?? finiteNumber(properties.HOEHE_DGM);
	const undersideZ = finiteNumber(properties.U_KOTE);
	if (roofZ === null || terrainZ === null || !(roofZ > terrainZ + 0.1)) {
		return null;
	}
	const bottomZ = (
		undersideZ !== null
		&& undersideZ > terrainZ
		&& undersideZ < roofZ
	)
		? undersideZ
		: terrainZ;
	return { roofZ, terrainZ, bottomZ };
}

function extrusionSurfacesFromPolygon(
	coordinates,
	levels,
	{ seamBoundaryIndex = null } = {}
) {
	const rings2D = (coordinates || [])
		.map((ring, index) => normalizeOpen2DRing(ring, index === 0))
		.filter((ring) => ring.length >= 3);
	if (!rings2D.length) return [];

	const toRing = (ring, z) => ring.map(([x, y]) => ({ x, y, z }));
	const surfaces = [{
		semantic: "ground",
		rings: rings2D.map((ring) => toRing(ring, levels.terrainZ))
	}, {
		semantic: "roof",
		rings: rings2D.map((ring) => toRing(ring, levels.roofZ))
	}];

	for (const ring of rings2D) {
		for (let index = 0; index < ring.length; index += 1) {
			const a = ring[index];
			const b = ring[(index + 1) % ring.length];
			if (edgeLiesOnBoundary(a, b, seamBoundaryIndex)) continue;
			surfaces.push({
				semantic: "wall",
				rings: [[
					{ x: a[0], y: a[1], z: levels.bottomZ },
					{ x: b[0], y: b[1], z: levels.bottomZ },
					{ x: b[0], y: b[1], z: levels.roofZ },
					{ x: a[0], y: a[1], z: levels.roofZ }
				]]
			});
		}
	}
	return surfaces;
}

function sourceSurfaceGeometry(surface, reader) {
	const coordinates = (surface?.rings || [])
		.map(closeSourceRing)
		.filter((ring) => ring.length >= 4);
	if (!coordinates.length) return null;
	try {
		return repairJstsGeometry(reader.read({
			type: "Polygon",
			coordinates
		}));
	} catch {
		return null;
	}
}

function surfacePlane(surface) {
	const ring = surface?.rings?.[0] || [];
	const normal = newellNormal(ring);
	if (!normal || Math.abs(normal.z) <= 1e-8 || !ring.length) return null;
	const origin = ring[0];
	return { normal, origin };
}

function planeZ(plane, x, y) {
	const { normal, origin } = plane;
	return origin.z - (
		normal.x * (x - origin.x)
		+ normal.y * (y - origin.y)
	) / normal.z;
}

function openGeoJsonRing3D(ring, plane, zFallback) {
	const points = (ring || [])
		.map((coordinate) => {
			const x = Number(coordinate?.[0]);
			const y = Number(coordinate?.[1]);
			if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
			const z = plane ? planeZ(plane, x, y) : zFallback;
			return Number.isFinite(z) ? { x, y, z } : null;
		})
		.filter(Boolean);
	if (
		points.length > 1
		&& points[0].x === points[points.length - 1].x
		&& points[0].y === points[points.length - 1].y
	) {
		points.pop();
	}
	return points;
}

function sourceEdgeKey(a, b, precision = 1000) {
	const pointKey = (point) => (
		Math.round(point.x * precision)
		+ ":"
		+ Math.round(point.y * precision)
		+ ":"
		+ Math.round(point.z * precision)
	);
	const ka = pointKey(a);
	const kb = pointKey(b);
	return ka < kb ? ka + "|" + kb : kb + "|" + ka;
}

function isHistoricalClipTarget(target) {
	const mode = String(target?.rolloutMode || "");
	return (
		mode === "hybrid-clip-pilot"
		|| mode === "hybrid-b-clip"
		|| mode === "hybrid-c-clip"
		|| mode === "hybrid-d-clip"
	);
}

function closedRingMetrics(coordinates) {
	if (!Array.isArray(coordinates) || coordinates.length < 4) {
		return { areaM2: 0, perimeterM: 0, meanWidthM: null };
	}
	let twiceArea = 0;
	let perimeterM = 0;
	for (let index = 0; index < coordinates.length - 1; index += 1) {
		const a = coordinates[index];
		const b = coordinates[index + 1];
		const ax = Number(a?.[0]);
		const ay = Number(a?.[1]);
		const bx = Number(b?.[0]);
		const by = Number(b?.[1]);
		if (
			!Number.isFinite(ax)
			|| !Number.isFinite(ay)
			|| !Number.isFinite(bx)
			|| !Number.isFinite(by)
		) continue;
		twiceArea += ax * by - bx * ay;
		perimeterM += Math.hypot(bx - ax, by - ay);
	}
	const areaM2 = Math.abs(twiceArea) / 2;
	return {
		areaM2,
		perimeterM,
		meanWidthM: perimeterM > 0
			? (2 * areaM2) / perimeterM
			: null
	};
}

function removeInteriorSliverHoles(
	geometry,
	reader,
	writer,
	maxMeanWidthM = HYBRID_MAX_SLIVER_MEAN_WIDTH_M
) {
	if (!geometry || geometry.isEmpty()) {
		return {
			geometry,
			removedHoles: 0,
			removedAreaM2: 0,
			maxRemovedMeanWidthM: 0
		};
	}
	const geojson = writer.write(geometry);
	const stats = {
		removedHoles: 0,
		removedAreaM2: 0,
		maxRemovedMeanWidthM: 0
	};
	const cleanPolygon = (coordinates) => {
		if (!Array.isArray(coordinates) || !coordinates.length) {
			return coordinates;
		}
		const kept = [coordinates[0]];
		for (const hole of coordinates.slice(1)) {
			const metrics = closedRingMetrics(hole);
			if (
				metrics.meanWidthM !== null
				&& metrics.meanWidthM <= maxMeanWidthM
			) {
				stats.removedHoles += 1;
				stats.removedAreaM2 += metrics.areaM2;
				stats.maxRemovedMeanWidthM = Math.max(
					stats.maxRemovedMeanWidthM,
					metrics.meanWidthM
				);
				continue;
			}
			kept.push(hole);
		}
		return kept;
	};
	let cleanedGeoJson;
	if (geojson?.type === "Polygon") {
		cleanedGeoJson = {
			...geojson,
			coordinates: cleanPolygon(geojson.coordinates)
		};
	} else if (geojson?.type === "MultiPolygon") {
		cleanedGeoJson = {
			...geojson,
			coordinates: (geojson.coordinates || []).map(cleanPolygon)
		};
	} else {
		return { geometry, ...stats };
	}
	let cleaned = geometry;
	try {
		cleaned = repairJstsGeometry(reader.read(cleanedGeoJson)) || geometry;
	} catch {}
	return {
		geometry: cleaned,
		removedHoles: stats.removedHoles,
		removedAreaM2: stats.removedAreaM2,
		maxRemovedMeanWidthM: stats.maxRemovedMeanWidthM
	};
}

function clipHistoricalSurfacesToFootprint(
	surfaces,
	clipFootprint,
	wallBoundaryGeometry,
	reader,
	writer,
	context = "",
	sharedWallKeys = null
) {
	if (!clipFootprint || clipFootprint.isEmpty()) return null;
	const wallBoundary = wallBoundaryGeometry || clipFootprint;
	if (!wallBoundary || wallBoundary.isEmpty()) return null;

	const groundPoints = (surfaces || [])
		.filter((surface) => surface.semantic === "ground")
		.flatMap((surface) => surface.rings?.flat?.() || []);
	const allPoints = groundPoints.length
		? groundPoints
		: getSurfacePoints(surfaces || []);
	if (!allPoints.length) return null;
	const baseZ = Math.min(
		...allPoints.map((point) => Number(point.z)).filter(Number.isFinite)
	);
	if (!Number.isFinite(baseZ)) return null;

	const clipped = [];
	for (const coordinates of polygonGeoJsonParts(clipFootprint, writer)) {
		const rings = (coordinates || [])
			.map((ring) => openGeoJsonRing3D(ring, null, baseZ))
			.filter((ring) => ring.length >= 3);
		if (rings.length) clipped.push({ semantic: "ground", rings });
	}

	const boundaryIndex = boundarySegmentIndexFromGeometry(wallBoundary, writer);
	const roofGeometries = [];
	const boundaryWalls = [];
	const wallLineGeometries = [];
	const wallKeys = sharedWallKeys || new Set();
	let generatedWallBoundaryLengthM = 0;
	let sourceRoofSurfaces = 0;
	let clippedRoofSurfaces = 0;

	for (const surface of surfaces || []) {
		if (surface.semantic !== "roof") continue;
		sourceRoofSurfaces += 1;
		const plane = surfacePlane(surface);
		const geometry = sourceSurfaceGeometry(surface, reader);
		if (!plane || !geometry) continue;

		const intersection = intersectionJstsGeometry(
			geometry,
			clipFootprint,
			context + " roof"
		);
		if (!intersection || intersection.isEmpty()) continue;
		roofGeometries.push(intersection);

		for (const coordinates of polygonGeoJsonParts(intersection, writer)) {
			const rings = (coordinates || [])
				.map((ring) => openGeoJsonRing3D(ring, plane, baseZ))
				.filter((ring) => ring.length >= 3);
			if (!rings.length) continue;
			clipped.push({ semantic: "roof", rings });
			clippedRoofSurfaces += 1;

			for (const ring of rings) {
				for (let index = 0; index < ring.length; index += 1) {
					const a = ring[index];
					const b = ring[(index + 1) % ring.length];
					if (!edgeLiesOnBoundary(
						[a.x, a.y],
						[b.x, b.y],
						boundaryIndex,
						HYBRID_MAX_SLIVER_MEAN_WIDTH_M
					)) continue;
					const key = sourceEdgeKey(a, b);
					if (wallKeys.has(key)) continue;
					wallKeys.add(key);
					boundaryWalls.push({
						semantic: "wall",
						rings: [[
							{ x: a.x, y: a.y, z: baseZ },
							{ x: b.x, y: b.y, z: baseZ },
							{ x: b.x, y: b.y, z: b.z },
							{ x: a.x, y: a.y, z: a.z }
						]]
					});
					try {
						wallLineGeometries.push(reader.read({
							type: "LineString",
							coordinates: [
								[a.x, a.y],
								[b.x, b.y]
							]
						}));
					} catch {}
					generatedWallBoundaryLengthM += Math.hypot(
						b.x - a.x,
						b.y - a.y
					);
				}
			}
		}
	}
	clipped.push(...boundaryWalls);

	const roofUnion = unionJstsGeometries(roofGeometries);
	const footprintAreaM2 = Number(clipFootprint.getArea?.() || 0);
	const roofAreaM2 = Number(roofUnion?.getArea?.() || 0);

	return {
		surfaces: clipped,
		stats: {
			footprintAreaM2: Number(footprintAreaM2.toFixed(3)),
			roofProjectedAreaM2: Number(roofAreaM2.toFixed(3)),
			roofCoverageRatio: footprintAreaM2 > 0
				? Number((roofAreaM2 / footprintAreaM2).toFixed(6))
				: null,
			generatedWallBoundaryLengthM:
				Number(generatedWallBoundaryLengthM.toFixed(3)),
			wallLineGeometries,
			sourceRoofSurfaces,
			clippedRoofSurfaces,
			generatedWallSurfaces: boundaryWalls.length
		}
	};
}

function addBuildingToTile(tileData, {
	building,
	surfaces,
	target,
	sourceSheet,
	extent,
	zoom,
	recordKind = "lod21",
	recordOverrides = {}
}) {
	const points = getSurfacePoints(surfaces);
	if (!points.length) return null;
	const groundPoints = surfaces
		.filter((surface) => surface.semantic === "ground")
		.flatMap((surface) => surface.rings.flat());
	const basePoints = groundPoints.length ? groundPoints : points;
	const baseZ = Math.min(...basePoints.map((point) => point.z));
	const anchorSource = boundsCenter(points);
	const tile = tileCoordinateForPoint(anchorSource, zoom);
	const anchorLngLat = sourcePointToLngLat(anchorSource);
	const distance = haversineMeters(anchorLngLat, target);

	const key = tileKey(tile);
	let data = tileData.get(key);
	if (!data) {
		data = { tile, vertices: [], indices: [], buildings: [] };
		tileData.set(key, data);
	}

	const vertexStart = vertexCount(data);
	const indexStart = data.indices.length;
	let roofSurfaces = 0;
	let wallSurfaces = 0;
	let groundSurfaces = 0;

	for (const surface of surfaces) {
		if (surface.semantic === "ground") {
			groundSurfaces += 1;
			continue;
		}
		const triangulated = triangulateSurface(surface, tile, extent, baseZ);
		if (!triangulated) continue;
		if (surface.semantic === "roof") roofSurfaces += 1;
		else if (surface.semantic === "wall") wallSurfaces += 1;

		const surfaceVertexStart = vertexCount(data);
		for (const point of triangulated.vertices) {
			pushVertex(data, {
				x: point.x,
				y: point.y,
				z: point.z,
				nx: triangulated.normal.x,
				ny: triangulated.normal.y,
				nz: triangulated.normal.z,
				kind: triangulated.kind
			});
		}
		for (const index of triangulated.indices) {
			data.indices.push(surfaceVertexStart + index);
		}
	}

	const buildingVertexCount = vertexCount(data) - vertexStart;
	const indexCount = data.indices.length - indexStart;
	if (!buildingVertexCount || !indexCount) return null;

	const anchorWorldX = worldX(anchorLngLat.lng, zoom);
	const anchorWorldY = worldY(anchorLngLat.lat, zoom);
	const record = {
		bwGebId: Number(target.bwGebId),
		historicalCode: String(target.historicalCode),
		ogdKsIds: [...new Set(
			(target.ksIds || [])
				.map((value) => String(value || "").trim())
				.filter(Boolean)
		)].sort(),
		name: String(target.name),
		rolloutMode: String(target.rolloutMode || "unspecified"),
		cityGmlId: String(
			recordOverrides.cityGmlId
			?? nodeAttribute(building, GML_NS, "id")
			?? ""
		),
		roofType: String(
			recordOverrides.roofType
			?? buildingRoofType(building)
			?? ""
		),
		creationDate: String(
			recordOverrides.creationDate
			?? buildingCreationDate(building)
			?? ""
		),
		sourceSheet: String(recordOverrides.sourceSheet ?? sourceSheet ?? ""),
		recordKind,
		vertexStart,
		vertexCount: buildingVertexCount,
		indexStart,
		indexCount,
		anchorX: Number(((anchorWorldX - tile.x) * extent).toFixed(3)),
		anchorY: Number(((anchorWorldY - tile.y) * extent).toFixed(3)),
		sourceBaseZ: Number(baseZ.toFixed(3)),
		roofSurfaces,
		wallSurfaces,
		groundSurfaces
	};
	data.buildings.push(record);
	return { tile, record, distance };
}

async function main() {
	const args = parseArgs(process.argv);
	const targetsConfig = JSON.parse(await fs.readFile(args.targets, "utf8"));
	const zoom = Number(targetsConfig.zoom);
	const extent = Number(targetsConfig.extent);
	if (!Number.isInteger(zoom) || zoom !== 15) throw new Error("Pilot zoom must be 15.");
	if (!Number.isInteger(extent) || extent !== 8192) throw new Error("Pilot extent must be 8192.");

	const targets = targetsConfig.buildings || [];
	if (!targets.length) throw new Error("No LOD2.1 pilot targets configured.");
	const targetByCode = new Map(targets.map((target) => [String(target.historicalCode), target]));
	if (targetByCode.size !== targets.length) throw new Error("Duplicate historicalCode in pilot targets.");

	const hybridTargets = targets.filter((target) => (
		String(target.rolloutMode || "").includes("hybrid")
	));
	let hybridCurrent = { type: "FeatureCollection", features: [] };
	if (args.hybridCurrent) {
		hybridCurrent = JSON.parse(await fs.readFile(args.hybridCurrent, "utf8"));
		if (!Array.isArray(hybridCurrent?.features)) {
			throw new Error("Hybrid current geometry is not a FeatureCollection.");
		}
	}
	if (hybridTargets.length && !args.hybridCurrent) {
		console.warn(
			"Hybrid targets configured without --hybrid-current; "
			+ "building only historical LOD2.1 geometry."
		);
	}

	const geoReader = new GeoJSONReader();
	const geoWriter = new GeoJSONWriter();

	const hybridCurrentByKsId = new Map();
	for (const feature of hybridCurrent.features || []) {
		const ksId = String(feature?.properties?.KS_ID || "").trim();
		if (ksId) hybridCurrentByKsId.set(ksId, feature);
	}

	const currentGeometryByCode = new Map();
	for (const target of hybridTargets) {
		const geometries = [];
		for (const ksId of target.ksIds || []) {
			const feature = hybridCurrentByKsId.get(String(ksId));
			if (!feature?.geometry) continue;
			try {
				geometries.push(geoReader.read(feature.geometry));
			} catch {}
		}
		const currentGeometry = unionJstsGeometries(geometries);
		if (currentGeometry) {
			currentGeometryByCode.set(String(target.historicalCode), currentGeometry);
		}
	}

	const historicalGroundByCode = new Map();
	const clipStatsByCode = new Map();
	const clipPendingByCode = new Map();

	const files = await listFilesRecursive(args.input);
	if (!files.length) throw new Error(`No CityGML files found below ${args.input}`);

	const tileData = new Map();
	const found = new Map(targets.map((target) => [String(target.historicalCode), []]));
	const seenCityObjects = new Set();
	let parsedBuildings = 0;

	for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
		const filePath = files[fileIndex];
		const sourceSheet = sourceSheetFromPath(filePath);
		let xml = await fs.readFile(filePath, "utf8");
		const srsName = extractEnvelopeSrsName(xml);
		if (!/31256/.test(srsName)) {
			throw new Error(`Unexpected CityGML CRS in ${filePath}: ${srsName || "(missing)"}`);
		}

		let buildingIndex = 0;
		for (const buildingXml of buildingXmlMatches(xml)) {
			const index = buildingIndex;
			buildingIndex += 1;
			parsedBuildings += 1;
			const code = extractFirstLocalTagText(buildingXml, "name");
			const target = targetByCode.get(code);
			if (!target) continue;
			if (target.sheet && sourceSheet && String(target.sheet) !== sourceSheet) continue;

			const building = parseBuildingFragment(buildingXml, filePath);
			if (!building) {
				throw new Error(`Target ${code} could not be parsed from ${filePath}.`);
			}
			const cityGmlId = nodeAttribute(building, GML_NS, "id") || `${sourceSheet}:${index}`;
			if (seenCityObjects.has(cityGmlId)) continue;
			seenCityObjects.add(cityGmlId);

			const surfaces = parseSemanticSurfaces(building);
			if (!surfaces.length) {
				throw new Error(`Target ${code} has no semantic LOD2.1 boundary surfaces.`);
			}

			if (isHistoricalClipTarget(target)) {
				if (!clipPendingByCode.has(code)) clipPendingByCode.set(code, []);
				clipPendingByCode.get(code).push({
					building,
					surfaces,
					sourceSheet
				});
				continue;
			}

			if (String(target.rolloutMode || "").includes("hybrid")) {
				const groundGeometry = groundGeometryFromSurfaces(surfaces, geoReader);
				if (groundGeometry) {
					if (!historicalGroundByCode.has(code)) {
						historicalGroundByCode.set(code, []);
					}
					historicalGroundByCode.get(code).push(groundGeometry);
				}
			}
			const added = addBuildingToTile(tileData, {
				building,
				surfaces,
				target,
				sourceSheet,
				extent,
				zoom
			});
			if (added) found.get(code).push(added);
		}
		xml = null;
		if (typeof global.gc === "function" && (fileIndex + 1) % 10 === 0) {
			global.gc();
		}
		if ((fileIndex + 1) % 25 === 0 || fileIndex + 1 === files.length) {
			const memory = process.memoryUsage();
			console.log(JSON.stringify({
				progress: `${fileIndex + 1}/${files.length}`,
				parsedBuildings,
				matchedTargets: [...found.values()].filter((matches) => matches.length).length,
				heapUsedMiB: Number((memory.heapUsed / 1048576).toFixed(1)),
				rssMiB: Number((memory.rss / 1048576).toFixed(1))
			}));
		}
	}


	for (const target of hybridTargets.filter(isHistoricalClipTarget)) {
		const code = String(target.historicalCode);
		const entries = clipPendingByCode.get(code) || [];
		if (!entries.length) {
			throw new Error("Hybrid clip target " + code + " has no CityGML objects.");
		}
		const currentGeometry = currentGeometryByCode.get(code);
		if (!currentGeometry) {
			throw new Error("Hybrid clip target " + code + " has no current geometry.");
		}

		const objectGrounds = entries.map((entry) => (
			groundGeometryFromSurfaces(entry.surfaces, geoReader)
		)).filter(Boolean);
		const historicalGround = unionJstsGeometries(objectGrounds);
		if (!historicalGround) {
			throw new Error("Hybrid clip target " + code + " has no historical footprint.");
		}
		let clippedHistoricalGround = intersectionJstsGeometry(
			historicalGround,
			currentGeometry,
			code + " target footprint clip"
		);
		clippedHistoricalGround = polygonalJstsGeometry(
			clippedHistoricalGround,
			geoReader,
			geoWriter
		);
		if (!clippedHistoricalGround || clippedHistoricalGround.isEmpty()) {
			throw new Error("Hybrid clip target " + code + " has empty target footprint.");
		}
		const sliverHoleCleanup = removeInteriorSliverHoles(
			clippedHistoricalGround,
			geoReader,
			geoWriter
		);
		clippedHistoricalGround = sliverHoleCleanup.geometry;
		historicalGroundByCode.set(code, [clippedHistoricalGround]);

		const boundaryLengthM = Number(
			clippedHistoricalGround.getBoundary?.()?.getLength?.() || 0
		);
		const sharedWallKeys = new Set();
		const stats = {
			objects: entries.length,
			originalHistoricalAreaM2: Number(
				historicalGround.getArea?.() || 0
			),
			clippedHistoricalAreaM2: Number(
				clippedHistoricalGround.getArea?.() || 0
			),
			removedHistoricalAreaM2: Math.max(
				0,
				Number(historicalGround.getArea?.() || 0)
					- Number(clippedHistoricalGround.getArea?.() || 0)
			),
			minRoofCoverageRatio: 1,
			boundaryLengthM,
			generatedWallBoundaryLengthM: 0,
			geometricWallBoundaryCoverageRatio: 0,
			uncoveredWallBoundaryLengthM: boundaryLengthM,
			wallLineGeometries: [],
			minWallBoundaryCoverageRatio: 0,
			sourceRoofSurfaces: 0,
			clippedRoofSurfaces: 0,
			generatedWallSurfaces: 0,
			removedInteriorSliverHoles: sliverHoleCleanup.removedHoles,
			removedInteriorSliverHoleAreaM2:
				sliverHoleCleanup.removedAreaM2,
			maxRemovedInteriorSliverHoleMeanWidthM:
				sliverHoleCleanup.maxRemovedMeanWidthM
		};

		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			const objectGround = objectGrounds[index];
			if (!objectGround) continue;
			let objectClip = intersectionJstsGeometry(
				objectGround,
				currentGeometry,
				code + " object footprint clip"
			);
			objectClip = polygonalJstsGeometry(
				objectClip,
				geoReader,
				geoWriter
			);
			if (
				!objectClip
				|| objectClip.isEmpty()
				|| Number(objectClip.getArea?.() || 0) <= 1e-6
			) continue;

			const clipped = clipHistoricalSurfacesToFootprint(
				entry.surfaces,
				objectClip,
				clippedHistoricalGround,
				geoReader,
				geoWriter,
				code,
				sharedWallKeys
			);
			if (!clipped?.surfaces?.length) {
				throw new Error(
					"Hybrid clip target " + code
					+ " produced no clipped surfaces for object " + index
				);
			}

			stats.minRoofCoverageRatio = Math.min(
				stats.minRoofCoverageRatio,
				Number(clipped.stats.roofCoverageRatio || 0)
			);
			stats.generatedWallBoundaryLengthM += Number(
				clipped.stats.generatedWallBoundaryLengthM || 0
			);
			stats.wallLineGeometries.push(
				...(clipped.stats.wallLineGeometries || [])
			);
			stats.sourceRoofSurfaces += clipped.stats.sourceRoofSurfaces;
			stats.clippedRoofSurfaces += clipped.stats.clippedRoofSurfaces;
			stats.generatedWallSurfaces += clipped.stats.generatedWallSurfaces;

			const added = addBuildingToTile(tileData, {
				building: entry.building,
				surfaces: clipped.surfaces,
				target,
				sourceSheet: entry.sourceSheet,
				extent,
				zoom
			});
			if (added) found.get(code).push(added);
		}

		stats.minWallBoundaryCoverageRatio = boundaryLengthM > 0
			? stats.generatedWallBoundaryLengthM / boundaryLengthM
			: 0;

		const wallBuffers = stats.wallLineGeometries
			.map((line) => {
				try {
					return BufferOp.bufferOp(
						line,
						HYBRID_MAX_SLIVER_MEAN_WIDTH_M
					);
				} catch {
					return null;
				}
			})
			.filter(Boolean);
		const wallBuffer = unionJstsGeometries(wallBuffers);
		if (wallBuffer && boundaryLengthM > 0) {
			const coveredBoundary = intersectionJstsGeometry(
				clippedHistoricalGround.getBoundary(),
				wallBuffer,
				code + " wall boundary coverage"
			);
			const coveredLengthM = Number(
				coveredBoundary?.getLength?.() || 0
			);
			stats.geometricWallBoundaryCoverageRatio =
				coveredLengthM / boundaryLengthM;
			stats.uncoveredWallBoundaryLengthM = Math.max(
				0,
				boundaryLengthM - coveredLengthM
			);
		}
		delete stats.wallLineGeometries;
		clipStatsByCode.set(code, stats);
	}

	const hybridStats = [];
	for (const target of hybridTargets) {
		const code = String(target.historicalCode);
		const historicalGround = unionJstsGeometries(
			historicalGroundByCode.get(code) || []
		);
		if (!historicalGround) {
			throw new Error("Hybrid target " + code + " has no historical ground geometry.");
		}
		const bufferedHistorical = BufferOp.bufferOp(
			historicalGround,
			HYBRID_HISTORY_BUFFER_M
		);
		const historicalBoundaryIndex = boundarySegmentIndexFromGeometry(
			historicalGround,
			geoWriter
		);
		let rawRemainderAreaM2 = 0;
		let remainderAreaM2 = 0;
		let remainderParts = 0;
		let syntheticObjects = 0;
		let discardedSliverAreaM2 = 0;
		let discardedSliverParts = 0;
		let maxDiscardedSliverWidthM = 0;

		for (const ksId of target.ksIds || []) {
			const feature = hybridCurrentByKsId.get(String(ksId));
			if (!feature?.geometry) {
				throw new Error("Hybrid target " + code + " is missing current " + ksId);
			}
			const levels = currentFeatureLevels(feature.properties || {});
			if (!levels) {
				throw new Error("Hybrid current feature has invalid height levels: " + ksId);
			}
			const currentGeometry = repairJstsGeometry(
				geoReader.read(feature.geometry)
			);
			if (!currentGeometry) continue;
			const remainder = differenceJstsGeometry(
				currentGeometry,
				bufferedHistorical,
				code + " / " + String(ksId)
			);
			if (!remainder || remainder.isEmpty()) continue;

			let partIndex = 0;
			for (const part of jstsGeometryParts(remainder)) {
				const area = Number(part.getArea?.() || 0);
				if (!(area > 0)) continue;
				rawRemainderAreaM2 += area;
				const perimeter = Number(part.getLength?.() || 0);
				const meanWidthM = perimeter > 0
					? (2 * area) / perimeter
					: Number.POSITIVE_INFINITY;
				if (meanWidthM <= HYBRID_MAX_SLIVER_MEAN_WIDTH_M) {
					discardedSliverAreaM2 += area;
					discardedSliverParts += 1;
					maxDiscardedSliverWidthM = Math.max(
						maxDiscardedSliverWidthM,
						meanWidthM
					);
					continue;
				}
				const geojson = geoWriter.write(part);
				const polygons = geojson?.type === "Polygon"
					? [geojson.coordinates]
					: geojson?.type === "MultiPolygon"
						? geojson.coordinates
						: [];
				for (const coordinates of polygons) {
					const surfaces = extrusionSurfacesFromPolygon(
						coordinates,
						levels,
						{ seamBoundaryIndex: historicalBoundaryIndex }
					);
					if (!surfaces.length) continue;
					const added = addBuildingToTile(tileData, {
						building: null,
						surfaces,
						target,
						sourceSheet: "current-ogd",
						extent,
						zoom,
						recordKind: "ogd-remainder",
						recordOverrides: {
							cityGmlId:
								"ogd-remainder:"
								+ String(feature.properties?.FMZK_ID || ksId)
								+ ":"
								+ partIndex,
							roofType: "current-lod1-remainder",
							creationDate: ""
						}
					});
					if (added) {
						syntheticObjects += 1;
						remainderAreaM2 += area;
					}
					partIndex += 1;
				}
				remainderParts += 1;
			}
		}

		hybridStats.push({
			historicalCode: code,
			rawRemainderAreaM2: Number(rawRemainderAreaM2.toFixed(3)),
			remainderAreaM2: Number(remainderAreaM2.toFixed(3)),
			remainderParts,
			syntheticObjects,
			discardedSliverAreaM2: Number(discardedSliverAreaM2.toFixed(3)),
			discardedSliverParts,
			maxDiscardedSliverWidthM: Number(
				maxDiscardedSliverWidthM.toFixed(4)
			)
		});
	}

	for (const target of targets) {
		const matches = found.get(String(target.historicalCode)) || [];
		if (!matches.length) {
			throw new Error(
				`Required LOD2.1 building not found: ${target.name} (${target.historicalCode})`
			);
		}
	}

	await fs.rm(args.output, { recursive: true, force: true });
	await fs.mkdir(args.output, { recursive: true });

	const presentTilesZ15 = [];
	let totalVertices = 0;
	let totalTriangles = 0;
	let totalBuildingObjects = 0;
	for (const [key, data] of [...tileData.entries()].sort()) {
		const outputPath = path.join(
			args.output,
			"tiles",
			String(data.tile.z),
			String(data.tile.x),
			`${data.tile.y}.bin`
		);
		await fs.mkdir(path.dirname(outputPath), { recursive: true });
		const encoded = encodeTile(data.tile, data, extent);
		await fs.writeFile(outputPath, encoded);
		presentTilesZ15.push(key);
		totalVertices += vertexCount(data);
		totalTriangles += data.indices.length / 3;
		totalBuildingObjects += data.buildings.length;
	}

	const generatedAt = new Date().toISOString();
	const status = String(targetsConfig.status || "pilot");
	const targetManifest = {
		schemaVersion: 1,
		generatedAt,
		status,
		counts: {
			targets: targets.length,
			directStrong: targets.filter(
				(target) => target.rolloutMode === "direct-strong"
			).length,
			hybridA: targets.filter(
				(target) => target.rolloutMode === "hybrid-a"
			).length,
			hybridBAbsolute: targets.filter(
				(target) => target.rolloutMode === "hybrid-b-absolute"
			).length,
			hybridBThin: targets.filter(
				(target) => target.rolloutMode === "hybrid-b-thin"
			).length,
			hybridBClip: targets.filter(
				(target) => target.rolloutMode === "hybrid-b-clip"
			).length,
			hybridCClip: targets.filter(
				(target) => target.rolloutMode === "hybrid-c-clip"
			).length,
			hybridDClip: targets.filter(
				(target) => target.rolloutMode === "hybrid-d-clip"
			).length,
			manualPilotStrong: targets.filter(
				(target) => target.rolloutMode === "manual-pilot-strong"
			).length,
			manualPilotHybrid: targets.filter(
				(target) => target.rolloutMode === "manual-pilot-hybrid"
			).length,
			hybridRemainderTargets: hybridStats.filter(
				(item) => item.syntheticObjects > 0
			).length
		},
		targets: targets.map((target) => ({
			...target,
			hybridRemainder: hybridStats.find(
				(item) => item.historicalCode === String(target.historicalCode)
			) || null,
			historicalClip: (() => {
				const stats = clipStatsByCode.get(String(target.historicalCode));
				if (!stats) return null;
				return {
					...stats,
					originalHistoricalAreaM2:
						Number(stats.originalHistoricalAreaM2.toFixed(3)),
					clippedHistoricalAreaM2:
						Number(stats.clippedHistoricalAreaM2.toFixed(3)),
					removedHistoricalAreaM2:
						Number(stats.removedHistoricalAreaM2.toFixed(3)),
					minRoofCoverageRatio:
						Number(stats.minRoofCoverageRatio.toFixed(6)),
					minWallBoundaryCoverageRatio:
						Number(stats.minWallBoundaryCoverageRatio.toFixed(6)),
					geometricWallBoundaryCoverageRatio:
						Number(
							stats.geometricWallBoundaryCoverageRatio.toFixed(6)
						),
					uncoveredWallBoundaryLengthM:
						Number(stats.uncoveredWallBoundaryLengthM.toFixed(3)),
					boundaryLengthM:
						Number(stats.boundaryLengthM.toFixed(3)),
					generatedWallBoundaryLengthM:
						Number(stats.generatedWallBoundaryLengthM.toFixed(3)),
					removedInteriorSliverHoles:
						Number(stats.removedInteriorSliverHoles || 0),
					removedInteriorSliverHoleAreaM2:
						Number(
							Number(
								stats.removedInteriorSliverHoleAreaM2 || 0
							).toFixed(6)
						),
					maxRemovedInteriorSliverHoleMeanWidthM:
						Number(
							Number(
								stats.maxRemovedInteriorSliverHoleMeanWidthM || 0
							).toFixed(6)
						)
				};
			})(),
			matches: found.get(String(target.historicalCode)).map((match) => ({
				tile: tileKey(match.tile),
				cityGmlId: match.record.cityGmlId,
				roofType: match.record.roofType,
				creationDate: match.record.creationDate,
				distanceToExpectedM: Number(match.distance.toFixed(2)),
				roofSurfaces: match.record.roofSurfaces,
				wallSurfaces: match.record.wallSurfaces,
				groundSurfaces: match.record.groundSurfaces
			}))
		}))
	};
	const release = {
		schemaVersion: 1,
		generatedAt,
		status,
		source: {
			product: "Stadt Wien – Generalisiertes Dachmodell (LOD2.1)",
			crs: SOURCE_CRS,
			license: "CC BY 4.0",
			downloadTemplate: "https://www.wien.gv.at/MA41datenviewer/downloads/geodaten/lod2_gml/{sheet}_lod2_gml.zip",
			sheets: [...new Set(targets.map((target) => String(target.sheet)))].sort()
		},
		binary: {
			magic: MAGIC,
			version: FORMAT_VERSION,
			zoom,
			extent,
			vertexStride: VERTEX_STRIDE,
			positions: "Int16 x/y at 1/4 render unit relative to tile centre; UInt16 z in centimetres above source building base",
			normals: "Int16 normalized vector / 32767",
			indices: "UInt32 little-endian",
			surfaceKinds: {
				0: "wall-or-ground",
				1: "pitched-roof",
				2: "flat-roof"
			}
		},
		tiles: {
			urlTemplate: "tiles/{z}/{x}/{y}.bin",
			presentTilesZ15
		},
		counts: {
			sourceGmlFiles: files.length,
			parsedBuildings,
			targets: targets.length,
			directStrong: targetManifest.counts.directStrong,
			hybridA: targetManifest.counts.hybridA,
			hybridBAbsolute: targetManifest.counts.hybridBAbsolute,
			hybridBThin: targetManifest.counts.hybridBThin,
			hybridBClip: targetManifest.counts.hybridBClip,
			hybridCClip: targetManifest.counts.hybridCClip,
			hybridDClip: targetManifest.counts.hybridDClip,
			manualPilotStrong: targetManifest.counts.manualPilotStrong,
			manualPilotHybrid: targetManifest.counts.manualPilotHybrid,
			hybridRemainderTargets: targetManifest.counts.hybridRemainderTargets,
			cityGmlBuildingObjects: totalBuildingObjects,
			vertices: totalVertices,
			triangles: totalTriangles,
			tiles: presentTilesZ15.length
		},
		targetsUrl: "targets.json"
	};

	await fs.writeFile(
		path.join(args.output, "release.json"),
		JSON.stringify(release, null, "\t") + "\n",
		"utf8"
	);
	await fs.writeFile(
		path.join(args.output, "targets.json"),
		JSON.stringify(targetManifest, null, "\t") + "\n",
		"utf8"
	);

	console.log(JSON.stringify(release.counts));
	for (const target of targetManifest.targets) {
		console.log(
			`${target.historicalCode} ${target.name}: `
			+ target.matches.map((match) => (
				`${match.tile} ${match.roofType || "?"} `
				+ `${match.roofSurfaces}/${match.wallSurfaces}/${match.groundSurfaces}`
			)).join(", ")
		);
	}
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
