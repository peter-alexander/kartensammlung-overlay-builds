#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import earcut from "earcut";
import proj4 from "proj4";

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
		targets: path.resolve("wien-lod21/targets.pilot.json")
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
	const elements = building.getElementsByTagNameNS(
		"http://www.opengis.net/citygml/1.0",
		"creationDate"
	);
	return textContent(elements?.[0]);
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
	const vertexBytes = tileData.vertices.length * VERTEX_STRIDE;
	const indexBytes = tileData.indices.length * 4;
	const output = Buffer.alloc(
		headerBytes + metadataBytes.length + metadataPadding + vertexBytes + indexBytes
	);

	output.write(MAGIC, 0, 8, "ascii");
	output.writeUInt32LE(FORMAT_VERSION, 8);
	output.writeUInt32LE(extent, 12);
	output.writeUInt32LE(tileData.vertices.length, 16);
	output.writeUInt32LE(tileData.indices.length, 20);
	output.writeUInt32LE(tileData.buildings.length, 24);
	output.writeUInt32LE(metadataBytes.length, 28);
	metadataBytes.copy(output, headerBytes);

	let offset = headerBytes + metadataBytes.length + metadataPadding;
	for (const vertex of tileData.vertices) {
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

function addBuildingToTile(tileData, {
	building,
	surfaces,
	target,
	sourceSheet,
	extent,
	zoom
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

	const vertexStart = data.vertices.length;
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

		const surfaceVertexStart = data.vertices.length;
		for (const point of triangulated.vertices) {
			data.vertices.push({
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

	const vertexCount = data.vertices.length - vertexStart;
	const indexCount = data.indices.length - indexStart;
	if (!vertexCount || !indexCount) return null;

	const anchorWorldX = worldX(anchorLngLat.lng, zoom);
	const anchorWorldY = worldY(anchorLngLat.lat, zoom);
	const record = {
		bwGebId: Number(target.bwGebId),
		historicalCode: String(target.historicalCode),
		name: String(target.name),
		rolloutMode: String(target.rolloutMode || "unspecified"),
		cityGmlId: nodeAttribute(building, GML_NS, "id"),
		roofType: buildingRoofType(building),
		creationDate: buildingCreationDate(building),
		sourceSheet,
		vertexStart,
		vertexCount,
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

	const files = await listFilesRecursive(args.input);
	if (!files.length) throw new Error(`No CityGML files found below ${args.input}`);

	const tileData = new Map();
	const found = new Map(targets.map((target) => [String(target.historicalCode), []]));
	const seenCityObjects = new Set();
	let parsedBuildings = 0;

	for (const filePath of files) {
		const sourceSheet = sourceSheetFromPath(filePath);
		const xml = await fs.readFile(filePath, "utf8");
		const document = new DOMParser({
			errorHandler: {
				warning: () => {},
				error: (message) => {
					throw new Error(`CityGML parse error in ${filePath}: ${message}`);
				},
				fatalError: (message) => {
					throw new Error(`CityGML fatal parse error in ${filePath}: ${message}`);
				}
			}
		}).parseFromString(xml, "application/xml");

		const envelope = document.getElementsByTagNameNS(GML_NS, "Envelope")[0];
		const srsName = String(envelope?.getAttribute?.("srsName") || "");
		if (!/31256/.test(srsName)) {
			throw new Error(`Unexpected CityGML CRS in ${filePath}: ${srsName || "(missing)"}`);
		}

		const buildings = document.getElementsByTagNameNS(BLDG_NS, "Building");
		for (let index = 0; index < buildings.length; index += 1) {
			const building = buildings[index];
			parsedBuildings += 1;
			const code = buildingName(building);
			const target = targetByCode.get(code);
			if (!target) continue;
			if (target.sheet && sourceSheet && String(target.sheet) !== sourceSheet) continue;

			const cityGmlId = nodeAttribute(building, GML_NS, "id") || `${sourceSheet}:${index}`;
			if (seenCityObjects.has(cityGmlId)) continue;
			seenCityObjects.add(cityGmlId);

			const surfaces = parseSemanticSurfaces(building);
			if (!surfaces.length) {
				throw new Error(`Target ${code} has no semantic LOD2.1 boundary surfaces.`);
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
		totalVertices += data.vertices.length;
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
			manualPilotHybrid: targets.filter(
				(target) => target.rolloutMode === "manual-pilot-hybrid"
			).length
		},
		targets: targets.map((target) => ({
			...target,
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
			manualPilotHybrid: targetManifest.counts.manualPilotHybrid,
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
