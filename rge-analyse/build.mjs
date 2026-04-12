// npm i ol proj4 jsts rbush
// Optional für PMTiles-Output: tippecanoe >= 2.17 lokal installieren
// Offiziell unterstützter PMTiles-Build-Schritt:
// tippecanoe --projection=EPSG:4326 -o out.pmtiles -l rge_analyse input.geojson

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';

import Feature from 'ol/Feature.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import LinearRing from 'ol/geom/LinearRing.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import MultiLineString from 'ol/geom/MultiLineString.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import { register } from 'ol/proj/proj4.js';
import { get as getProjection } from 'ol/proj.js';
import proj4 from 'proj4';
import OL3Parser from 'jsts/org/locationtech/jts/io/OL3Parser.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
import RBush from 'rbush';

const execFileP = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
	outDir: path.join(__dirname, 'build'),
	outGeoJSON: path.join(__dirname, 'build', 'rge_analyse.geojson'),
	outPMTiles: path.join(__dirname, 'build', 'rge_analyse.pmtiles'),
	layerName: 'rge_analyse',
	tippecanoeBin: 'tippecanoe',
	buildPMTiles: true,
	minZoom: 8,
	maxZoom: 17,
	// Falls du doch eine feste Wien-BBOX verwenden willst, hier ergänzen.
	// Aktuell werden die Wien-OGD-Daten komplett geladen.
};

////////////////////////////////////////////////////////////////////////////////
// Parameter aus dem Worker
////////////////////////////////////////////////////////////////////////////////
const BBOX_BUFFER = 100;
const RTREE_SEARCH_BUFFER = 5;
const ALIGN_TOLERANCE = 2;
const MIN_RATIO_STRASSE = 0.6;
const MIN_RATIO_EINBAHN = 0.85;
const MAX_REST_RATIO = 0.36;
const FIND_NODE_TOLERANCE = 1.5;
const EINBAHN_TOLERANCE = 0.5;
const STRASSEN_TOLERANCE = 0.5;
const WOHNSTR_BUFFER = 5;
const RGE_BUFFER = 5;

const submerkmaleAusschluss = {
	'Radfahren in Wohnstraße': 20,
	'Radfahren in Fußgängerzone': 20,
	'Baulicher Radweg': 20,
	'Getrennter Geh- und Radweg': 20,
	'Gemischter Geh- und Radweg': 20,
	'Radfahren gegen die Einbahn': 5,
};

const MASKEN_SEARCH_BUFFER = Math.max(
	...Object.values(submerkmaleAusschluss),
	WOHNSTR_BUFFER,
	RGE_BUFFER
) + 5;

const STRASSEN_ATTR_MAP = {
	FEATURENAME: 'Straßenname',
	EDGECATEGORY_NAME: 'Kategorie',
	FRC_NAME: 'Funktionale Straßenklasse',
	FOW_NAME: 'Wegetyp',
	DEDICATEDWIDTH: 'Straßenbreite_m',
	LEVELINTERMEDIATE: 'Ebene',
	BEZIRK: 'Bezirk',
	BEZIRK_RECHTS: 'Bezirk rechts',
	BEZIRK_LINKS: 'Bezirk links',
};

const MERGE_KEYS = [
	'Straßenname',
	'Bezirk',
	'RgE',
	'Funktionale Straßenklasse',
	'Wegetyp',
	'Kategorie',
];

////////////////////////////////////////////////////////////////////////////////
// Projektionen
////////////////////////////////////////////////////////////////////////////////
proj4.defs(
	'EPSG:31256',
	'+proj=tmerc +lat_0=0 +lon_0=16.3333333333333 +k=1 +x_0=0 +y_0=-5000000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs +type=crs'
);
register(proj4);
getProjection('EPSG:31256');

////////////////////////////////////////////////////////////////////////////////
// WFS-URLs: kompletter Wien-Datensatz
////////////////////////////////////////////////////////////////////////////////
const MASK_TYPES = [
	'ogdwien:RADWEGEOGD',
	'ogdwien:WOHNSTRASSEOGD',
	'ogdwien:RADGEGENEINBAHNOG',
].join(',');

const urlMasken = `https://data.wien.gv.at/daten/geo?service=WFS&version=1.0.0&request=GetFeature&typeName=${MASK_TYPES}&outputFormat=json&SRS=EPSG:31256`;
const urlEinbahn = 'https://data.wien.gv.at/daten/geo?service=WFS&version=1.0.0&request=GetFeature&typeName=ogdwien:EINBAHNOGD&outputFormat=json&SRS=EPSG:31256';
const urlStrassen =
	'https://data.wien.gv.at/daten/geo?service=WFS&version=1.1.0&request=GetFeature&typeName=ogdwien:STRASSENGRAPHOGD&outputFormat=json&SRSNAME=EPSG:31256&CQL_FILTER=' +
	encodeURIComponent(`FRC > 2 AND NOT FOW = 1 AND NOT FOW = 2 AND NOT FOW = 4 AND NOT EDGECATEGORY = 'B'`);

////////////////////////////////////////////////////////////////////////////////
// Formate / Parser
////////////////////////////////////////////////////////////////////////////////
const format31256to3857 = new GeoJSON({
	dataProjection: 'EPSG:31256',
	featureProjection: 'EPSG:3857',
});

const format3857to4326 = new GeoJSON({
	dataProjection: 'EPSG:4326',
	featureProjection: 'EPSG:3857',
});

const jstsParser = new OL3Parser();
jstsParser.inject(
	Point,
	LineString,
	LinearRing,
	Polygon,
	MultiPoint,
	MultiLineString,
	MultiPolygon
);

const toJsts = (g) => jstsParser.read(g);
const jstsBuffer = (geom, distance) => BufferOp.bufferOp(geom, distance);
const jstsDistance = (a, b) => DistanceOp.distance(a, b);
const jstsIntersection = (a, b) => OverlayOp.intersection(a, b);
const jstsDifference = (a, b) => OverlayOp.difference(a, b);
const jstsUnion = (a, b) => OverlayOp.union(a, b);
const jstsIntersects = (a, b) => RelateOp.intersects(a, b);

////////////////////////////////////////////////////////////////////////////////
// Hilfsfunktionen
////////////////////////////////////////////////////////////////////////////////
async function fetchJson(url) {
	const res = await fetch(url, {
		headers: {
			'User-Agent': 'Kartensammlung-RgE-Build/1.0',
			'Accept': 'application/json',
		},
	});

	if (!res.ok) {
		throw new Error(`Fetch failed (${res.status}) for ${url}`);
	}

	return await res.json();
}

async function ensureDir(dir) {
	await fs.mkdir(dir, { recursive: true });
}

function isValidLineString(geom) {
	if (!geom) return false;

	if (geom.getType() === 'LineString') {
		return geom.getCoordinates().length >= 2;
	}
	if (geom.getType() === 'MultiLineString') {
		return geom.getLineStrings().some((ls) => ls.getCoordinates().length >= 2);
	}
	return false;
}

function isUiRelevant(key, val) {
	if (key === 'Straßenbreite_m' && val === -1) return false;
	if (key === 'Bezirk rechts' && val == null) return false;
	if (key === 'Bezirk links' && val == null) return false;
	if (key === 'Ebene' && val === 0) return false;
	return true;
}

function fixBezirkCode(key, val) {
	if (
		['Bezirk', 'Bezirk rechts', 'Bezirk links'].includes(key) &&
		typeof val === 'string' &&
		val.startsWith('AT')
	) {
		return Number(val.slice(3, 5));
	}
	return val;
}

function cropLeadingNumber(key, val) {
	if (
		['Funktionale Straßenklasse', 'Wegetyp'].includes(key) &&
		typeof val === 'string'
	) {
		return val.replace(/^\s*\d+\s*[-–—]\s*/, '');
	}
	return val;
}

function mergeStrassenPropsIntoEinbahn(einbahn, strasse) {
	const src = { ...strasse.getProperties() };
	delete src.geometry;

	for (const [origKey, destKey] of Object.entries(STRASSEN_ATTR_MAP)) {
		if (!(origKey in src)) continue;

		let val = fixBezirkCode(destKey, src[origKey]);
		val = cropLeadingNumber(destKey, val);
		if (!isUiRelevant(destKey, val)) continue;

		if (einbahn.get(destKey) == null) {
			einbahn.set(destKey, val);
		}
	}

	const geom = einbahn.getGeometry();
	einbahn.set('RgE', '-');

	const unsorted = einbahn.getProperties();
	delete unsorted.geometry;

	const sorted = {};
	Object.keys(unsorted)
		.sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }))
		.forEach((k) => {
			einbahn.unset(k, true);
			sorted[k] = unsorted[k];
		});

	einbahn.setProperties(sorted, true);
	einbahn.setGeometry(geom);
}

function findAllNodes(lines, tolerance) {
	const nodes = [];
	const nodeToLines = [];
	const Q = tolerance;
	const hash = (x, y) => `${Math.round(x / Q)}|${Math.round(y / Q)}`;
	const nodeMap = new Map();

	function findOrCreate([x, y]) {
		const key = hash(x, y);
		if (nodeMap.has(key)) return nodeMap.get(key);
		const id = nodes.push([x, y]) - 1;
		nodeMap.set(key, id);
		nodeToLines[id] = new Set();
		return id;
	}

	lines.forEach((f) => {
		const geom = f.getGeometry();
		const lineStrings = geom.getType() === 'MultiLineString' ? geom.getLineStrings() : [geom];
		lineStrings.forEach((ls) => {
			ls.getCoordinates().forEach((pt) => {
				const idx = findOrCreate(pt);
				if (idx !== -1) nodeToLines[idx].add(f);
			});
		});
	});

	return { nodes, nodeToLines };
}

function isValidIntersection(center, lineFeatures, minArms = 3, threshDeg = 30) {
	const dirs = [];
	lineFeatures.forEach((f) => {
		let coords = f.getGeometry().getCoordinates();
		if (Array.isArray(coords[0]?.[0])) coords = coords[0];
		const end =
			Math.hypot(center[0] - coords[0][0], center[1] - coords[0][1]) <
			Math.hypot(center[0] - coords.at(-1)[0], center[1] - coords.at(-1)[1])
				? coords.at(-1)
				: coords[0];
		const dx = end[0] - center[0];
		const dy = end[1] - center[1];
		const len = Math.hypot(dx, dy);
		if (len < 1) return;
		const a = Math.atan2(dy, dx);
		if (!dirs.some((d) => Math.abs(Math.atan2(Math.sin(d - a), Math.cos(d - a))) < (threshDeg * Math.PI) / 180)) {
			dirs.push(a);
		}
	});
	return dirs.length >= minArms;
}

function findStrassenAlongEinbahn(
	strassenAllFeatures,
	einbahnFeatures,
	{ searchBuffer, alignTolerance, minRatioStrasse, minRatioEinbahn }
) {

	const tree = new RBush();
	tree.load(
		strassenAllFeatures.map((f) => {
			const e = f.getGeometry().getExtent();
			return { minX: e[0], minY: e[1], maxX: e[2], maxY: e[3], feature: f };
		})
	);

	const matchedStrassen = new Set();
	const matchedEinbahnen = new Set();
	const matchedPairs = [];

	for (const einbahn of einbahnFeatures) {
		const einJ = toJsts(einbahn.getGeometry());
		const einLen = einJ.getLength();
		const einBuffer = jstsBuffer(einJ, alignTolerance);
		const env = einBuffer.getEnvelopeInternal();

		const cand = tree.search({
			minX: env.getMinX() - searchBuffer,
			minY: env.getMinY() - searchBuffer,
			maxX: env.getMaxX() + searchBuffer,
			maxY: env.getMaxY() + searchBuffer,
		});

		let bestStrasse = null;
		let bestOverlap = 0;

		for (const { feature: strF } of cand) {
			if (!isValidLineString(strF.getGeometry())) continue;

			const strJ = toJsts(strF.getGeometry());
			const strLen = strJ.getLength();
			if (strLen === 0) continue;

			const strEnv = strJ.getEnvelopeInternal();
			if (!strEnv.intersects(env)) continue;

			const interDiag = Math.hypot(
				Math.min(strEnv.getMaxX(), env.getMaxX()) - Math.max(strEnv.getMinX(), env.getMinX()),
				Math.min(strEnv.getMaxY(), env.getMaxY()) - Math.max(strEnv.getMinY(), env.getMinY())
			);
			if (interDiag / strLen + 0.05 < minRatioStrasse) continue;

			const intersects = jstsIntersects(einBuffer, strJ);
			if (!intersects) continue;

			const overlapLen = jstsIntersection(strJ, einBuffer).getLength();
			const ratioS = overlapLen / strLen;
			if (ratioS < minRatioStrasse) continue;

			if (jstsDistance(einJ, strJ) > alignTolerance) continue;

			const ratioE = jstsIntersection(einJ, jstsBuffer(strJ, alignTolerance)).getLength() / einLen;
			if (ratioE < minRatioEinbahn) continue;

			matchedStrassen.add(strF);
			matchedEinbahnen.add(einbahn);

			if (overlapLen > bestOverlap) {
				bestOverlap = overlapLen;
				bestStrasse = strF;
			}
		}

		if (bestStrasse) {
			mergeStrassenPropsIntoEinbahn(einbahn, bestStrasse);
			matchedPairs.push({ einbahn, strasse: bestStrasse });
		}
	}

	return {
		strassen: Array.from(matchedStrassen),
		einbahnen: Array.from(matchedEinbahnen),
		pairs: matchedPairs,
	};
}

function syncNodesBetweenLayers(sourceFeatures, targetFeatures, tolerance) {
	const tree = new RBush();
	const segIndex = [];
	const pendingSplits = [];

	targetFeatures.forEach((f) => {
		const geom = f.getGeometry();
		const parts = geom.getType() === 'MultiLineString' ? geom.getLineStrings() : [geom];

		parts.forEach((ls, part) => {
			const coords = ls.getCoordinates();
			for (let i = 0; i < coords.length - 1; i++) {
				const c0 = coords[i];
				const c1 = coords[i + 1];
				tree.insert({
					minX: Math.min(c0[0], c1[0]),
					minY: Math.min(c0[1], c1[1]),
					maxX: Math.max(c0[0], c1[0]),
					maxY: Math.max(c0[1], c1[1]),
					feature: f,
					part,
					idx0: i,
					idx1: i + 1,
				});
				segIndex.push({ feature: f, part, idx0: i, idx1: i + 1, ls });
			}
		});
	});

	function dist2(a, b) {
		const dx = a[0] - b[0];
		const dy = a[1] - b[1];
		return dx * dx + dy * dy;
	}

	const tol2 = tolerance * tolerance;

	function trySplit(segment, snapPoint) {
		const { feature, idx0, idx1, ls } = segment;
		const coords = ls.getCoordinates();

		for (let i = idx0; i <= idx1; i++) {
			if (dist2(coords[i], snapPoint) < 1e-4) return;
		}

		const newCoords1 = coords.slice(0, idx1 + 1);
		const newCoords2 = coords.slice(idx1);
		newCoords1.push(snapPoint);
		newCoords2[0] = snapPoint;

		targetFeatures.splice(targetFeatures.indexOf(feature), 1);

		const props = { ...feature.getProperties() };
		delete props.geometry;

		function pushIfValid(c) {
			if (c.length < 2) return;
			targetFeatures.push(new Feature({ ...props, geometry: new LineString(c) }));
		}

		pushIfValid(newCoords1);
		pushIfValid(newCoords2);
	}

	sourceFeatures.forEach((sf) => {
		const sGeom = sf.getGeometry();
		const sParts = sGeom.getType() === 'MultiLineString' ? sGeom.getLineStrings() : [sGeom];

		sParts.forEach((ls) => {
			ls.getCoordinates().forEach((pt) => {
				const cand = tree.search({
					minX: pt[0] - tolerance,
					minY: pt[1] - tolerance,
					maxX: pt[0] + tolerance,
					maxY: pt[1] + tolerance,
				});

				cand.forEach((seg) => {
					const c0 = segIndex.find(
						(s) => s.feature === seg.feature && s.idx0 === seg.idx0 && s.idx1 === seg.idx1
					);
					if (!c0) return;

					const p0 = c0.ls.getCoordinates()[seg.idx0];
					const p1 = c0.ls.getCoordinates()[seg.idx1];
					const vx = p1[0] - p0[0];
					const vy = p1[1] - p0[1];
					const vlen2 = vx * vx + vy * vy;
					if (vlen2 === 0) return;

					const t = ((pt[0] - p0[0]) * vx + (pt[1] - p0[1]) * vy) / vlen2;
					if (t < 0 || t > 1) return;

					const proj = [p0[0] + t * vx, p0[1] + t * vy];
					if (dist2(pt, proj) > tol2) return;

					pendingSplits.push({ segment: c0, proj });
				});
			});
		});
	});

	pendingSplits.forEach(({ segment, proj }) => {
		trySplit(segment, proj);
	});
}

function propsSignature(feature) {
	const obj = {};
	MERGE_KEYS.forEach((k) => {
		obj[k] = feature.get(k);
	});
	return JSON.stringify(obj);
}

function dissolveConnectedLines(features, tol = 1.0) {
	const hash = (c) => `${Math.round(c[0] / tol)}|${Math.round(c[1] / tol)}`;
	const nodeToFeat = new Map();

	function addEndNodes(f) {
		const g = f.getGeometry();
		const parts = g.getType() === 'MultiLineString' ? g.getLineStrings() : [g];
		parts.forEach((ls) => {
			const c = ls.getCoordinates();
			[c[0], c[c.length - 1]].forEach((pt) => {
				const h = hash(pt);
				if (!nodeToFeat.has(h)) nodeToFeat.set(h, new Set());
				nodeToFeat.get(h).add(f);
			});
		});
	}

	features.forEach(addEndNodes);

	const visited = new Set();
	const groups = [];

	function dfs(start, sig) {
		const stack = [start];
		const group = new Set();

		while (stack.length) {
			const f = stack.pop();
			if (visited.has(f)) continue;
			visited.add(f);
			group.add(f);

			const g = f.getGeometry();
			const parts = g.getType() === 'MultiLineString' ? g.getLineStrings() : [g];
			parts.forEach((ls) => {
				const c = ls.getCoordinates();
				[c[0], c[c.length - 1]].forEach((pt) => {
					const h = hash(pt);
					(nodeToFeat.get(h) || []).forEach((nb) => {
						if (!visited.has(nb) && propsSignature(nb) === sig) {
							stack.push(nb);
						}
					});
				});
			});
		}

		return group;
	}

	features.forEach((f) => {
		if (visited.has(f)) return;
		const sig = propsSignature(f);
		groups.push(dfs(f, sig));
	});

	const merged = [];
	groups.forEach((featSet) => {
		if (featSet.size === 1) {
			merged.push([...featSet][0]);
			return;
		}

		let geomUnion = null;
		featSet.forEach((f) => {
			const j = jstsParser.read(f.getGeometry());
			geomUnion = geomUnion ? jstsUnion(geomUnion, j) : j;
		});
		const mergedGeom = jstsParser.write(geomUnion);

		const base = [...featSet][0];
		const props = { ...base.getProperties() };
		delete props.geometry;

		merged.push(
			new Feature({
				...props,
				geometry: mergedGeom,
			})
		);
	});

	return merged;
}

function splitAtIntersections(coords, nodeSet, keyFn) {
	const idx = [];
	coords.forEach((pt, i) => {
		if (nodeSet.has(keyFn(pt))) idx.push(i);
	});

	if (idx[0] !== 0) idx.unshift(0);
	if (idx.at(-1) !== coords.length - 1) idx.push(coords.length - 1);

	const segs = [];
	for (let k = 0; k < idx.length - 1; k++) {
		const seg = coords.slice(idx[k], idx[k + 1] + 1);
		segs.push({
			coords: seg,
			trimStart: nodeSet.has(keyFn(seg[0])),
			trimEnd: nodeSet.has(keyFn(seg.at(-1))),
		});
	}
	return segs;
}

function buildTileJSONMetadata() {
	return {
		vector_layers: [
			{
				id: CONFIG.layerName,
				fields: {
					RgE: 'String',
					Straßenname: 'String',
					Kategorie: 'String',
					'Funktionale Straßenklasse': 'String',
					Wegetyp: 'String',
					Straßenbreite_m: 'Number',
					Ebene: 'Number',
					Bezirk: 'Number',
					'Bezirk rechts': 'Number',
					'Bezirk links': 'Number',
					layername: 'String',
				},
			},
		],
	};
}

async function buildPMTilesIfPossible() {
	if (!CONFIG.buildPMTiles) return false;

	try {
		await execFileP(CONFIG.tippecanoeBin, ['--version']);
	} catch {
		console.warn('[PMTILES] tippecanoe nicht gefunden – PMTiles-Build übersprungen.');
		return false;
	}

	const args = [
		'--projection=EPSG:4326',
		'-o',
		CONFIG.outPMTiles,
		'-l',
		CONFIG.layerName,
		'-Z',
		String(CONFIG.minZoom),
		'-z',
		String(CONFIG.maxZoom),
		'--force',
		'--read-parallel',
		CONFIG.outGeoJSON,
	];

	console.log(`[PMTILES] ${CONFIG.tippecanoeBin} ${args.join(' ')}`);
	await execFileP(CONFIG.tippecanoeBin, args, {
		maxBuffer: 1024 * 1024 * 64,
	});
	return true;
}

async function main() {
	await ensureDir(CONFIG.outDir);

	const t0 = performance.now();
	console.log('[RGE] Starte Ganz-Wien-Build …');

	const [maskenRaw, einbahnRaw, strassenRaw] = await Promise.all([
		fetchJson(urlMasken),
		fetchJson(urlEinbahn),
		fetchJson(urlStrassen),
	]);

	console.log('[RGE] Downloads abgeschlossen.');

	const maskAllFeatures = format31256to3857.readFeatures(maskenRaw);
	const radnetzAllFeatures = maskAllFeatures.filter((f) => String(f.getId() || '').includes('RADWEGE'));
	const wohnstrAllFeatures = maskAllFeatures.filter((f) => String(f.getId() || '').includes('WOHNSTRASSE'));
	const RgEAllFeatures = maskAllFeatures.filter((f) => String(f.getId() || '').includes('RADGEGENEINBAHN'));
	const einbahnAllFeatures = format31256to3857.readFeatures(einbahnRaw);
	const strassenAllFeatures = format31256to3857.readFeatures(strassenRaw);

	console.log(
		`[RGE] Input: mask=${maskAllFeatures.length}, einbahn=${einbahnAllFeatures.length}, strassen=${strassenAllFeatures.length}`
	);

	syncNodesBetweenLayers(einbahnAllFeatures, strassenAllFeatures, EINBAHN_TOLERANCE);
	syncNodesBetweenLayers(strassenAllFeatures, einbahnAllFeatures, STRASSEN_TOLERANCE);
	console.log('[RGE] Node-Synchronisierung fertig.');

	const { nodes, nodeToLines } = findAllNodes(strassenAllFeatures, FIND_NODE_TOLERANCE);
	const intersections = nodes
		.map((coord, i) => ({ coord, lines: Array.from(nodeToLines[i]) }))
		.filter((i) => i.lines.length >= 3 && isValidIntersection(i.coord, i.lines));

	const tol = 1.0;
	const key = (c) => `${Math.round(c[0] / tol)}|${Math.round(c[1] / tol)}`;
	const hiDegSet = new Set(intersections.map((i) => key(i.coord)));

	const einbahnSplitRaw = [];
	einbahnAllFeatures.forEach((orig) => {
		const geom = orig.getGeometry();
		const parts = geom.getType() === 'MultiLineString' ? geom.getLineStrings() : [geom];
		parts.forEach((ls) => {
			const segs = splitAtIntersections(ls.getCoordinates(), hiDegSet, key);
			segs.forEach((seg) => {
				const origProps = { ...orig.getProperties() };
				delete origProps.geometry;
				delete origProps.OBJECTID;
				delete origProps.SE_ANNO_CAD_DATA;
				einbahnSplitRaw.push(
					new Feature({
						...origProps,
						geometry: new LineString(seg.coords),
					})
				);
			});
		});
	});

	console.log(`[RGE] Einbahnen gesplittet: ${einbahnSplitRaw.length}`);

	const { einbahnen: matchedEinbahnen } = findStrassenAlongEinbahn(strassenAllFeatures, einbahnSplitRaw, {
		searchBuffer: RTREE_SEARCH_BUFFER,
		alignTolerance: ALIGN_TOLERANCE,
		minRatioStrasse: MIN_RATIO_STRASSE,
		minRatioEinbahn: MIN_RATIO_EINBAHN,
	});

	console.log(`[RGE] Gematchte Einbahnen: ${matchedEinbahnen.length}`);

	const MaskenFeatures = [];
	function addFeaturesWithBuffer(source, getBuf) {
		source.forEach((f) => {
			const d = typeof getBuf === 'function' ? getBuf(f) : getBuf;
			if (d == null) return;
			f.set('_buf', d);
			MaskenFeatures.push(f);
		});
	}

	addFeaturesWithBuffer(radnetzAllFeatures, (f) => {
		const sm = f.get('SUBMERKMAL');
		if (!(sm in submerkmaleAusschluss)) return null;
		return submerkmaleAusschluss[sm];
	});
	addFeaturesWithBuffer(wohnstrAllFeatures, WOHNSTR_BUFFER);
	addFeaturesWithBuffer(RgEAllFeatures, RGE_BUFFER);

	MaskenFeatures.forEach((f) => {
		const dist = f.get('_buf');
		const bufGeom = jstsBuffer(toJsts(f.getGeometry()), dist);
		f.set('_bufGeom', bufGeom);
		const env = bufGeom.getEnvelopeInternal();
		f.set('_bufExtent', [env.getMinX(), env.getMinY(), env.getMaxX(), env.getMaxY()]);
	});

	const maskTree = new RBush();
	maskTree.load(
		MaskenFeatures.map((f) => {
			const e = f.get('_bufExtent');
			return { minX: e[0], minY: e[1], maxX: e[2], maxY: e[3], feature: f };
		})
	);

	const offeneEinbahnFeatures = [];
	const freizugebendeEinbahnFeatures = [];

	for (const feature of matchedEinbahnen) {
		let jstsEinbahnGeom = toJsts(feature.getGeometry());
		const bb = feature.getGeometry().getExtent();
		const searchExtent = [
			bb[0] - MASKEN_SEARCH_BUFFER,
			bb[1] - MASKEN_SEARCH_BUFFER,
			bb[2] + MASKEN_SEARCH_BUFFER,
			bb[3] + MASKEN_SEARCH_BUFFER,
		];

		const candidates = maskTree
			.search({
				minX: searchExtent[0],
				minY: searchExtent[1],
				maxX: searchExtent[2],
				maxY: searchExtent[3],
			})
			.map((item) => item.feature);

		const originalArea = jstsEinbahnGeom.getLength();

		for (const maskFeature of candidates) {
			const maskBuffer = maskFeature.get('_bufGeom');
			if (jstsIntersects(jstsEinbahnGeom, maskBuffer)) {
				jstsEinbahnGeom = jstsDifference(jstsEinbahnGeom, maskBuffer);
				if (jstsEinbahnGeom.isEmpty()) break;
			}
		}

		const restArea = jstsEinbahnGeom.getLength();
		const restRatio = restArea / originalArea;

		feature.set('layername', 'RgE-Analyse');
		if (restRatio <= MAX_REST_RATIO) {
			feature.set('RgE', 'ja');
			offeneEinbahnFeatures.push(feature);
		} else {
			feature.set('RgE', 'nein');
			freizugebendeEinbahnFeatures.push(feature);
		}
	}

	const alleEinbahnenFinal = [...freizugebendeEinbahnFeatures, ...offeneEinbahnFeatures];
	const dissolved = dissolveConnectedLines(alleEinbahnenFinal, 1);

	console.log(`[RGE] Finale Features nach dissolve: ${dissolved.length}`);

	const geojsonString = format3857to4326.writeFeatures(dissolved, {
		decimals: 6,
	});

	await fs.writeFile(CONFIG.outGeoJSON, geojsonString, 'utf8');
	await fs.writeFile(
		path.join(CONFIG.outDir, 'rge_analyse.tilejson-metadata.json'),
		JSON.stringify(buildTileJSONMetadata(), null, '\t'),
		'utf8'
	);

	console.log(`[RGE] GeoJSON geschrieben: ${CONFIG.outGeoJSON}`);

	const builtPMTiles = await buildPMTilesIfPossible();
	if (builtPMTiles) {
		console.log(`[RGE] PMTiles geschrieben: ${CONFIG.outPMTiles}`);
	}

	const ms = Math.round(performance.now() - t0);
	console.log(`[RGE] Fertig in ${ms} ms`);
}

main().catch((err) => {
	console.error('[RGE] FEHLER');
	console.error(err);
	process.exitCode = 1;
});
