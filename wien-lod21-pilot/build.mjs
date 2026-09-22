#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import proj4 from "proj4";
import earcut from "earcut";

const SOURCE_CRS = "EPSG:31256";
const TARGET_CRS = "EPSG:4326";
const SOURCE_CRS_DEF = "+proj=tmerc +lat_0=0 +lon_0=16.3333333333333 +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs +type=crs";
const ZOOM = 15;
const RENDER_EXTENT = 8192;
const MAGIC = "KSL21M01";

const PILOT = Object.freeze([
	{ code: "212535", sheet: "104078", label: "Straußengasse 2–10", target: [16.362449, 48.191404] },
	{ code: "009238", sheet: "104078", label: "Straußengasse 12", target: [16.362021, 48.191684] },
	{ code: "113842", sheet: "104078", label: "Straußengasse 14", target: [16.361881, 48.191824] },
	{ code: "006973", sheet: "105080", label: "TU Wien, Karlsplatz 13", target: [16.369902, 48.198897] }
]);

proj4.defs(SOURCE_CRS, SOURCE_CRS_DEF);

function log(message) {
	console.log("[" + new Date().toISOString() + "] " + message);
}

function escapeRegex(value) {
	return String(value).replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}

function extractBlocks(xml, localTag) {
	const tag = escapeRegex(localTag);
	const expression = new RegExp(
		"<(?:[A-Za-z_][\\\\w.-]*:)?" + tag + "\\\\b[^>]*>[\\\\s\\\\S]*?<\\\\/(?:[A-Za-z_][\\\\w.-]*:)?" + tag + ">",
		"gi"
	);
	return xml.match(expression) || [];
}

function extractFirstText(xml, localTag) {
	const tag = escapeRegex(localTag);
	const expression = new RegExp(
		"<(?:[A-Za-z_][\\\\w.-]*:)?" + tag + "\\\\b[^>]*>([\\\\s\\\\S]*?)<\\\\/(?:[A-Za-z_][\\\\w.-]*:)?" + tag + ">",
		"i"
	);
	const match = xml.match(expression);
	return match ? match[1].replace(/<[^>]+>/g, "").trim() : "";
}

function extractPosLists(xml) {
	const expression = /<(?:[A-Za-z_][\w.-]*:)?posList\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?posList>/gi;
	const rings = [];
	let match;
	while ((match = expression.exec(xml))) {
		const values = match[1].trim().split(/\s+/).map(Number);
		if (values.length < 9 || values.some((value) => !Number.isFinite(value))) continue;
		const ring = [];
		for (let index = 0; index + 2 < values.length; index += 3) {
			ring.push({ x: values[index], y: values[index + 1], z: values[index + 2] });
		}
		if (ring.length >= 3) rings.push(openRing(ring));
	}
	return rings;
}

function openRing(ring) {
	const points = [];
	for (const point of ring || []) {
		if (
			!points.length
			|| points[points.length - 1].x !== point.x
			|| points[points.length - 1].y !== point.y
			|| points[points.length - 1].z !== point.z
		) points.push(point);
	}
	if (
		points.length > 1
		&& points[0].x === points[points.length - 1].x
		&& points[0].y === points[points.length - 1].y
		&& points[0].z === points[points.length - 1].z
	) points.pop();
	return points;
}

function newellNormal(ring) {
	let nx = 0;
	let ny = 0;
	let nz = 0;
	for (let index = 0; index < ring.length; index += 1) {
		const current = ring[index];
		const next = ring[(index + 1) % ring.length];
		nx += (current.y - next.y) * (current.z + next.z);
		ny += (current.z - next.z) * (current.x + next.x);
		nz += (current.x - next.x) * (current.y + next.y);
	}
	const length = Math.hypot(nx, ny, nz);
	if (length < 1e-9) return null;
	return { x: nx / length, y: ny / length, z: nz / length };
}

function dominantProjection(normal) {
	const ax = Math.abs(normal.x);
	const ay = Math.abs(normal.y);
	const az = Math.abs(normal.z);
	if (az >= ax && az >= ay) return "xy";
	if (ay >= ax) return "xz";
	return "yz";
}

function flattenRing(ring, projection) {
	const flat = [];
	for (const point of ring) {
		if (projection === "xy") flat.push(point.x, point.y);
		else if (projection === "xz") flat.push(point.x, point.z);
		else flat.push(point.y, point.z);
	}
	return flat;
}

function triangulatePolygon(rings) {
	const valid = rings.map(openRing).filter((ring) => ring.length >= 3);
	if (!valid.length) return null;
	const normal = newellNormal(valid[0]);
	if (!normal) return null;
	const projection = dominantProjection(normal);
	const flat = [];
	const holes = [];
	const vertices = [];
	let count = 0;
	for (let ringIndex = 0; ringIndex < valid.length; ringIndex += 1) {
		if (ringIndex > 0) holes.push(count);
		const ring = valid[ringIndex];
		flat.push(...flattenRing(ring, projection));
		vertices.push(...ring);
		count += ring.length;
	}
	const indices = earcut(flat, holes, 2);
	if (indices.length < 3) return null;
	return { vertices, indices, normal };
}

function normalizeSurfaceNormal(normal, kind) {
	if (kind === "RoofSurface" && normal.z < 0) {
		return { x: -normal.x, y: -normal.y, z: -normal.z };
	}
	if (kind === "GroundSurface" && normal.z > 0) {
		return { x: -normal.x, y: -normal.y, z: -normal.z };
	}
	return normal;
}

function surfaceKindByte(kind, normal) {
	if (kind === "WallSurface" || Math.abs(normal.z) < 0.2) return 0;
	return Math.abs(normal.z) >= 0.985 ? 2 : 1;
}

function worldPoint(lng, lat) {
	const x = (lng + 180) / 360;
	const radians = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
	const y = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
	return { x, y };
}

function tileForLngLat(lng, lat) {
	const world = worldPoint(lng, lat);
	const n = 2 ** ZOOM;
	return { z: ZOOM, x: Math.floor(world.x * n), y: Math.floor(world.y * n) };
}

function renderPoint(tile, lng, lat) {
	const world = worldPoint(lng, lat);
	const n = 2 ** tile.z;
	return {
		x: (world.x * n - tile.x) * RENDER_EXTENT,
		y: (world.y * n - tile.y) * RENDER_EXTENT
	};
}

function haversineMeters(a, b) {
	const radius = 6371008.8;
	const toRadians = (degrees) => degrees * Math.PI / 180;
	const lat1 = toRadians(a[1]);
	const lat2 = toRadians(b[1]);
	const dLat = lat2 - lat1;
	const dLng = toRadians(b[0] - a[0]);
	const sinLat = Math.sin(dLat / 2);
	const sinLng = Math.sin(dLng / 2);
	const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
	return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function extractBuildingSurfaces(buildingXml) {
	const surfaces = [];
	for (const kind of ["RoofSurface", "WallSurface", "GroundSurface"]) {
		for (const surfaceXml of extractBlocks(buildingXml, kind)) {
			for (const polygonXml of extractBlocks(surfaceXml, "Polygon")) {
				const rings = extractPosLists(polygonXml);
				if (rings.length) surfaces.push({ kind, rings });
			}
		}
	}
	return surfaces;
}

function buildingBaseZ(surfaces) {
	const ground = surfaces
		.filter((surface) => surface.kind === "GroundSurface")
		.flatMap((surface) => surface.rings.flat());
	const candidates = ground.length ? ground : surfaces.flatMap((surface) => surface.rings.flat());
	const values = candidates.map((point) => point.z).filter(Number.isFinite);
	return values.length ? Math.min(...values) : null;
}

function buildingAnchor(surfaces) {
	const points = surfaces.flatMap((surface) => surface.rings.flat());
	if (!points.length) return null;
	const minX = Math.min(...points.map((point) => point.x));
	const maxX = Math.max(...points.map((point) => point.x));
	const minY = Math.min(...points.map((point) => point.y));
	const maxY = Math.max(...points.map((point) => point.y));
	return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function writeAsciiFixed(buffer, offset, value, length) {
	const bytes = Buffer.from(String(value || ""), "ascii");
	bytes.copy(buffer, offset, 0, Math.min(bytes.length, length));
}

function encodeTile(tile, buildings) {
	const positions = [];
	const normals = [];
	const kinds = [];
	const indices = [];
	const records = [];

	for (const building of buildings) {
		const vertexStart = positions.length / 3;
		const indexStart = indices.length;
		for (const surface of building.surfaces) {
			const triangulated = triangulatePolygon(surface.rings);
			if (!triangulated) continue;
			const desiredNormal = normalizeSurfaceNormal(triangulated.normal, surface.kind);
			const kindByte = surfaceKindByte(surface.kind, desiredNormal);
			const surfaceStart = positions.length / 3;

			for (const sourcePoint of triangulated.vertices) {
				const lonLat = proj4(SOURCE_CRS, TARGET_CRS, [sourcePoint.x, sourcePoint.y]);
				const point = renderPoint(tile, lonLat[0], lonLat[1]);
				positions.push(point.x, point.y, sourcePoint.z - building.baseZ);
				normals.push(desiredNormal.x, desiredNormal.y, desiredNormal.z);
				kinds.push(kindByte);
			}

			for (let index = 0; index < triangulated.indices.length; index += 3) {
				let a = surfaceStart + triangulated.indices[index];
				let b = surfaceStart + triangulated.indices[index + 1];
				let c = surfaceStart + triangulated.indices[index + 2];

				const localA = triangulated.vertices[triangulated.indices[index]];
				const localB = triangulated.vertices[triangulated.indices[index + 1]];
				const localC = triangulated.vertices[triangulated.indices[index + 2]];
				const ab = { x: localB.x - localA.x, y: localB.y - localA.y, z: localB.z - localA.z };
				const ac = { x: localC.x - localA.x, y: localC.y - localA.y, z: localC.z - localA.z };
				const triangleNormal = {
					x: ab.y * ac.z - ab.z * ac.y,
					y: ab.z * ac.x - ab.x * ac.z,
					z: ab.x * ac.y - ab.y * ac.x
				};
				const dot = triangleNormal.x * desiredNormal.x
					+ triangleNormal.y * desiredNormal.y
					+ triangleNormal.z * desiredNormal.z;
				if (dot < 0) [b, c] = [c, b];
				indices.push(a, b, c);
			}
		}

		const vertexCount = positions.length / 3 - vertexStart;
		const indexCount = indices.length - indexStart;
		if (!vertexCount || !indexCount) continue;
		records.push({
			code: building.code,
			vertexStart,
			vertexCount,
			indexStart,
			indexCount,
			anchorLng: building.anchorLng,
			anchorLat: building.anchorLat
		});
	}

	const vertexCount = positions.length / 3;
	const indexCount = indices.length;
	const buildingCount = records.length;
	const headerBytes = 8 + 5 * 4;
	const recordBytes = 40;
	const positionBytes = vertexCount * 3 * 4;
	const normalBytes = vertexCount * 3 * 4;
	const kindBytes = vertexCount;
	const kindPadding = (4 - (kindBytes % 4)) % 4;
	const indexBytes = indexCount * 4;
	const totalBytes = headerBytes + buildingCount * recordBytes
		+ positionBytes + normalBytes + kindBytes + kindPadding + indexBytes;

	const buffer = Buffer.alloc(totalBytes);
	let offset = 0;
	writeAsciiFixed(buffer, offset, MAGIC, 8); offset += 8;
	buffer.writeUInt32LE(vertexCount, offset); offset += 4;
	buffer.writeUInt32LE(indexCount, offset); offset += 4;
	buffer.writeUInt32LE(buildingCount, offset); offset += 4;
	buffer.writeUInt32LE(RENDER_EXTENT, offset); offset += 4;
	buffer.writeUInt32LE(0, offset); offset += 4;

	for (const record of records) {
		buffer.writeUInt32LE(record.vertexStart, offset); offset += 4;
		buffer.writeUInt32LE(record.vertexCount, offset); offset += 4;
		buffer.writeUInt32LE(record.indexStart, offset); offset += 4;
		buffer.writeUInt32LE(record.indexCount, offset); offset += 4;
		buffer.writeDoubleLE(record.anchorLng, offset); offset += 8;
		buffer.writeDoubleLE(record.anchorLat, offset); offset += 8;
		writeAsciiFixed(buffer, offset, record.code, 8); offset += 8;
	}

	for (const value of positions) { buffer.writeFloatLE(value, offset); offset += 4; }
	for (const value of normals) { buffer.writeFloatLE(value, offset); offset += 4; }
	for (const value of kinds) { buffer.writeUInt8(value, offset); offset += 1; }
	offset += kindPadding;
	for (const value of indices) { buffer.writeUInt32LE(value, offset); offset += 4; }

	if (offset !== totalBytes) {
		throw new Error("Binary size mismatch: wrote " + offset + ", expected " + totalBytes);
	}
	return { buffer, records, vertexCount, indexCount };
}

async function main() {
	const inputDir = path.resolve(process.argv[2] || "wien-lod21-pilot/input");
	const outputDir = path.resolve(process.argv[3] || "wien-lod21-pilot/build/WienLOD21");
	await fs.rm(outputDir, { recursive: true, force: true });
	await fs.mkdir(path.join(outputDir, "tiles", String(ZOOM)), { recursive: true });

	const selectedBySheet = new Map();
	for (const item of PILOT) {
		if (!selectedBySheet.has(item.sheet)) selectedBySheet.set(item.sheet, []);
		selectedBySheet.get(item.sheet).push(item);
	}

	const extracted = [];
	for (const [sheet, items] of selectedBySheet) {
		const files = (await fs.readdir(inputDir))
			.filter((name) => name.toLowerCase().endsWith(".gml") && name.includes(sheet));
		if (!files.length) throw new Error("No CityGML found for sheet " + sheet + " in " + inputDir);
		const xml = await fs.readFile(path.join(inputDir, files[0]), "utf8");
		const buildingBlocks = extractBlocks(xml, "Building");
		log(sheet + ": " + buildingBlocks.length + " buildings scanned");

		for (const item of items) {
			const matches = buildingBlocks.filter((block) => extractFirstText(block, "name") === item.code);
			if (!matches.length) throw new Error(item.label + ": LOD2.1 code " + item.code + " not found in " + sheet);

			for (let matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
				const surfaces = extractBuildingSurfaces(matches[matchIndex]);
				const baseZ = buildingBaseZ(surfaces);
				const anchor = buildingAnchor(surfaces);
				if (!surfaces.length || !Number.isFinite(baseZ) || !anchor) {
					throw new Error(item.label + ": invalid LOD2.1 geometry");
				}
				const lonLat = proj4(SOURCE_CRS, TARGET_CRS, [anchor.x, anchor.y]);
				const distance = haversineMeters(item.target, lonLat);
				if (distance > 180) {
					throw new Error(item.label + ": LOD2.1 anchor is " + distance.toFixed(1) + " m from control point");
				}
				extracted.push({
					code: item.code,
					label: item.label,
					sheet,
					part: matchIndex + 1,
					surfaces,
					baseZ,
					anchorLng: lonLat[0],
					anchorLat: lonLat[1],
					distanceToControlM: Number(distance.toFixed(2))
				});
			}
		}
	}

	const byTile = new Map();
	for (const building of extracted) {
		const tile = tileForLngLat(building.anchorLng, building.anchorLat);
		const key = [tile.z, tile.x, tile.y].join("/");
		if (!byTile.has(key)) byTile.set(key, { tile, buildings: [] });
		byTile.get(key).buildings.push(building);
	}

	const tileMetadata = [];
	for (const [key, group] of byTile) {
		const encoded = encodeTile(group.tile, group.buildings);
		const tilePath = path.join(outputDir, "tiles", String(group.tile.z), String(group.tile.x), group.tile.y + ".bin");
		await fs.mkdir(path.dirname(tilePath), { recursive: true });
		await fs.writeFile(tilePath, encoded.buffer);
		tileMetadata.push({
			key,
			url: "tiles/" + group.tile.z + "/" + group.tile.x + "/" + group.tile.y + ".bin",
			bytes: encoded.buffer.length,
			vertexCount: encoded.vertexCount,
			triangleCount: encoded.indexCount / 3,
			buildings: encoded.records.map((record) => record.code)
		});
		log(key + ": " + encoded.records.length + " buildings, "
			+ (encoded.indexCount / 3) + " triangles, " + encoded.buffer.length + " bytes");
	}

	tileMetadata.sort((a, b) => a.key.localeCompare(b.key));
	const release = {
		schemaVersion: 1,
		format: MAGIC,
		pilot: true,
		generatedAt: new Date().toISOString(),
		source: {
			dataset: "Generalisiertes Dachmodell (LOD2.1)",
			city: "Wien",
			crs: SOURCE_CRS,
			attribution: "Stadt Wien – data.wien.gv.at, CC BY 4.0",
			sheets: [...new Set(extracted.map((building) => building.sheet))].sort()
		},
		tiles: {
			zoom: ZOOM,
			extent: RENDER_EXTENT,
			urlTemplate: "tiles/{z}/{x}/{y}.bin",
			present: tileMetadata.map((tile) => tile.key)
		},
		buildings: extracted.map((building) => ({
			code: building.code,
			label: building.label,
			sheet: building.sheet,
			part: building.part,
			anchor: [Number(building.anchorLng.toFixed(7)), Number(building.anchorLat.toFixed(7))],
			distanceToControlM: building.distanceToControlM
		})),
		tileMetadata
	};
	await fs.writeFile(path.join(outputDir, "release.json"), JSON.stringify(release, null, "\t") + "\n");
	log("LOD2.1 pilot complete: " + extracted.length + " building parts in "
		+ tileMetadata.length + " Z15 tiles");
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
