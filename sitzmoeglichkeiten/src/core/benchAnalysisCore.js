import { buildOverpassQuery } from './buildOverpassQuery.js';
import { buildGraphFromRoads, mergeSameColorSegments, multiSourceDijkstra } from './graphUtils.js';
import {
	colorFor,
	coordToId,
	coordsEqual,
	distance,
	getClosestPointOnSegment,
	getFreeOffsetForRoadType,
	getRoadType,
	splitEdgeByThresholds,
	zindexFor
} from './geometryUtils.js';

function pushSplit(splitMap, pIdx, segIdx, t, pt) {
	if (t <= 1e-9 || t >= 1 - 1e-9) return;

	const arr = splitMap.get(pIdx) || [];

	if (!arr.some((s) => s.segIdx === segIdx && Math.abs(s.t - t) < 1e-6)) {
		arr.push({ segIdx, t, pt });
		splitMap.set(pIdx, arr);
	}
}

function getTagValue(feature, key) {
	const tags = feature.get('tags');

	if (tags && typeof tags === 'object' && !Array.isArray(tags)) {
		return tags[key];
	}

	return feature.get(key);
}

function hasTagValue(feature, key, value) {
	return getTagValue(feature, key) === value;
}

export async function runBenchAnalysisCore({
	extent3857,
	includeBenches = true,
	deps,
	fetchJson,
	logger = console,
	options = {}
}) {
	if (!extent3857 || extent3857.length !== 4) {
		throw new Error('extent3857 must be an array [minX, minY, maxX, maxY].');
	}

	if (!deps) {
		throw new Error('deps is required.');
	}

	if (typeof fetchJson !== 'function') {
		throw new Error('fetchJson is required.');
	}

	const {
		pad = 50,
		benchSearchRadius = 20,
		simplifyTolerance = 8,
		thresholds = [25, 50, 75],
		step = 10
	} = options;

	const geo = {
		LineString: deps.LineString,
		getLength: deps.getLength,
		toLonLat: deps.toLonLat
	};

	const geoJsonFmt = new deps.GeoJSON({
		featureProjection: 'EPSG:3857'
	});

	const { query, seatKeyVals } = buildOverpassQuery({
		extent3857,
		pad,
		geo
	});

	const json = await fetchJson(query);

	const allFeat = geoJsonFmt.readFeatures(osmGeoJson, {
		dataProjection: 'EPSG:4326',
		featureProjection: 'EPSG:3857'
	});

	const benches = [];
	const roads = [];

	allFeat.forEach((f) => {
		const isSitz = seatKeyVals.some(([k, v]) => hasTagValue(f, k, v));

		if (isSitz) {
			benches.push({ feature: f });
		} else {
			roads.push({ feature: f });
		}
	});

	const benchpoints = benches.map(({ feature }) => {
		const geom = feature.getGeometry();
		const type = geom.getType();

		if (type === 'LineString' || type === 'Polygon' || type === 'MultiPolygon') {
			const extent = geom.getExtent();
			const center = [
				(extent[0] + extent[2]) / 2,
				(extent[1] + extent[3]) / 2
			];

			const point = new deps.Feature(new deps.Point(center));
			point.set('color', 'black');
			return point;
		}

		feature.set('color', 'black');
		return feature;
	});

	const benchCoords = benchpoints.map((f) => f.getGeometry().getCoordinates());

	const groupedLines = new Map();

	roads.forEach(({ feature }) => {
		const geom = feature.getGeometry();
		const coords = geom.getCoordinates();

		const roadType = getTagValue(feature, 'highway') || '';

		const addLine = (ls) => {
			if (!groupedLines.has(roadType)) groupedLines.set(roadType, []);
			groupedLines.get(roadType).push(ls);
		};

		if (Array.isArray(coords[0]?.[0])) {
			coords.forEach(addLine);
		} else {
			addLine(coords);
		}
	});

	const lineStrings = [];
	const lineTypeByPath = [];

	const gf = new deps.GeometryFactory();
	const toJstsLineString = (coords) =>
		gf.createLineString(coords.map((c) => new deps.Coordinate(c[0], c[1])));

	groupedLines.forEach((lines, roadType) => {
		const merger = new deps.LineMerger();

		lines.forEach((ls) => merger.add(toJstsLineString(ls)));

		Array.from(merger.getMergedLineStrings()).forEach((ls) => {
			const coords = ls.getCoordinates().map((c) => [c.x, c.y]);
			lineStrings.push(coords);
			lineTypeByPath.push(roadType);
		});
	});

	const segIndex = new deps.RBush();
	const segMeta = [];

	lineStrings.forEach((coords, pIdx) => {
		for (let i = 0; i < coords.length - 1; ++i) {
			const a = coords[i];
			const b = coords[i + 1];

			segMeta.push({
				a,
				b,
				parentIdx: pIdx,
				segIdx: i,
				minX: Math.min(a[0], b[0]),
				minY: Math.min(a[1], b[1]),
				maxX: Math.max(a[0], b[0]),
				maxY: Math.max(a[1], b[1])
			});
		}
	});

	segIndex.load(segMeta);

	const lineIntersector = new deps.RobustLineIntersector();
	const nSplit = new Map();

	segMeta.forEach((s1) => {
		segIndex.search(s1).forEach((s2) => {
			if (s1 === s2) return;
			if (s1.parentIdx > s2.parentIdx) return;
			if (s1.parentIdx === s2.parentIdx && s1.segIdx >= s2.segIdx) return;
			if (s1.parentIdx === s2.parentIdx && Math.abs(s1.segIdx - s2.segIdx) <= 1) return;

			lineIntersector.computeIntersection(
				new deps.Coordinate(s1.a[0], s1.a[1]),
				new deps.Coordinate(s1.b[0], s1.b[1]),
				new deps.Coordinate(s2.a[0], s2.a[1]),
				new deps.Coordinate(s2.b[0], s2.b[1])
			);

			if (!lineIntersector.hasIntersection()) return;

			const ip = lineIntersector.getIntersection(0);
			const pt = [ip.x, ip.y];

			const addT = (seg, pIdx) => {
				const { a, b, segIdx } = seg;
				const dx = b[0] - a[0];
				const dy = b[1] - a[1];
				const len2 = dx * dx + dy * dy;
				const t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2;
				pushSplit(nSplit, pIdx, segIdx, t, pt);
			};

			addT(s1, s1.parentIdx);
			addT(s2, s2.parentIdx);
		});
	});

	nSplit.forEach((arr, pIdx) => {
		arr.sort((u, v) => (u.segIdx + u.t) - (v.segIdx + v.t));
		const coords = lineStrings[pIdx];
		let offset = 0;

		arr.forEach(({ segIdx, pt }) => {
			coords.splice(segIdx + 1 + offset, 0, pt);
			offset++;
		});
	});

	const indexBuffered = new deps.RBush();
	segMeta.length = 0;

	lineStrings.forEach((coords, pIdx) => {
		for (let i = 0; i < coords.length - 1; ++i) {
			const a = coords[i];
			const b = coords[i + 1];

			segMeta.push({
				a,
				b,
				parentIdx: pIdx,
				segIdx: i,
				roadType: lineTypeByPath[pIdx],
				minX: Math.min(a[0], b[0]) - benchSearchRadius,
				minY: Math.min(a[1], b[1]) - benchSearchRadius,
				maxX: Math.max(a[0], b[0]) + benchSearchRadius,
				maxY: Math.max(a[1], b[1]) + benchSearchRadius
			});
		}
	});

	indexBuffered.load(segMeta);

	const benchesWithinRadius = [];
	const benchSplits = new Map();

	benchCoords.forEach((coord) => {
		const hits = indexBuffered.search({
			minX: coord[0] - benchSearchRadius,
			minY: coord[1] - benchSearchRadius,
			maxX: coord[0] + benchSearchRadius,
			maxY: coord[1] + benchSearchRadius
		});

		const bestByLine = new Map();

		for (const seg of hits) {
			const cp = getClosestPointOnSegment(coord, seg.a, seg.b);
			const d = distance(coord, cp, geo);

			if (d > benchSearchRadius + 1e-6) continue;

			const prev = bestByLine.get(seg.parentIdx);
			if (!prev || d < prev.d) {
				bestByLine.set(seg.parentIdx, { ...seg, cp, d, bench: coord });
			}
		}

		if (bestByLine.size === 0) return;

		bestByLine.forEach((best) => {
			const A = lineStrings[best.parentIdx][best.segIdx];
			const B = lineStrings[best.parentIdx][best.segIdx + 1];

			const dx = B[0] - A[0];
			const dy = B[1] - A[1];
			const len = Math.hypot(dx, dy);

			const tRaw = ((best.bench[0] - A[0]) * dx + (best.bench[1] - A[1]) * dy) / (len * len);
			const t = Math.max(0, Math.min(1, tRaw));
			const cp = [
				A[0] + t * dx,
				A[1] + t * dy
			];

			const rawDist = distance(best.bench, cp, geo);
			const freeOffset = getFreeOffsetForRoadType(best.roadType);
			const offsetDist = Math.max(0, rawDist - freeOffset);

			benchesWithinRadius.push({
				segment: best,
				bestPoint: cp,
				rawDist,
				freeOffset,
				offsetDist
			});

			const arr = benchSplits.get(best.parentIdx) ?? [];

			if (!arr.some((s) => s.segIdx === best.segIdx && Math.abs(s.t - t) < 1e-6)) {
				arr.push({
					segIdx: best.segIdx,
					bestPoint: cp,
					t
				});
			}

			benchSplits.set(best.parentIdx, arr);
		});
	});

	const benchFeatures = [];

	if (includeBenches) {
		benchesWithinRadius.forEach((bench) => {
			const f = new deps.Feature(new deps.Point(bench.bestPoint));
			f.set('color', 'white');
			f.set('roadType', bench.segment.roadType);
			f.set('rawDist', bench.rawDist);
			f.set('freeOffset', bench.freeOffset);
			f.set('offsetDist', bench.offsetDist);
			benchFeatures.push(f);
		});

		benchCoords.forEach((coord) => {
			const f = new deps.Feature(new deps.Point(coord));
			f.set('color', 'black');
			benchFeatures.push(f);
		});
	}

	benchSplits.forEach((arr, pIdx) => {
		arr.sort((u, v) => (u.segIdx + u.t) - (v.segIdx + v.t));
		const coords = lineStrings[pIdx];
		let off = 0;

		arr.forEach(({ segIdx, bestPoint }) => {
			coords.splice(segIdx + 1 + off, 0, bestPoint);
			off++;
		});
	});

	const graph = buildGraphFromRoads(lineStrings, lineTypeByPath, geo);

	const sourceInit = new Map();

	benchesWithinRadius.forEach(({ bestPoint, offsetDist }) => {
		const id = coordToId(bestPoint);

		if (!graph.has(id)) graph.set(id, []);

		const prev = sourceInit.get(id);
		if (prev === undefined || offsetDist < prev) {
			sourceInit.set(id, offsetDist);
		}
	});

	const startSources = Array.from(sourceInit, ([id, d0]) => ({ id, d0 }));
	const distMap = multiSourceDijkstra(graph, startSources);

	const coloredFeatures = [];

	graph.forEach((edges, idA) => {
		const dA = distMap.get(idA);

		edges.forEach((e) => {
			const idB = e.target;
			if (idA > idB) return;

			const dB = distMap.get(idB);

			if ((dA == null || !isFinite(dA)) && (dB == null || !isFinite(dB))) {
				coloredFeatures.push(new deps.Feature({
					geometry: new deps.LineString([e.coordA, e.coordB]),
					color: 0,
					zindex: 10,
					width: 30,
					dMid: 'inf'
				}));
				return;
			}

			if (dA == null || !isFinite(dA) || dB == null || !isFinite(dB)) {
				return;
			}

			const pts = splitEdgeByThresholds(
				e.coordA,
				e.coordB,
				dA,
				dB,
				thresholds,
				geo,
				step
			);

			for (let i = 0; i < pts.length - 1; ++i) {
				const dMid = (pts[i].d + pts[i + 1].d) / 2;

				const feat = new deps.Feature({
					geometry: new deps.LineString([pts[i].coord, pts[i + 1].coord]),
					color: colorFor(dMid),
					zindex: zindexFor(dMid),
					width: 30,
					dMid: dMid.toFixed(1)
				});

				for (const [key, val] of Object.entries(e)) {
					if (key !== 'coordA' && key !== 'coordB' && key !== 'target' && key !== 'distance') {
						feat.set(key, val);
					}
				}

				coloredFeatures.push(feat);
			}
		});
	});

	function minzoomForRoadType(roadType) {
		switch (roadType) {
			case 'track':
				return 13;

			case 'footway':
			case 'path':
			case 'cycleway':
				return 14;

			case 'unclassified':
			case 'service':
			case 'living_street':
			case 'pedestrian':
			case 'residential':
			case 'tertiary':
			case 'secondary':
			case 'primary':
				return 0;
			default:
				return 30;
		}
	}

	function toPlainFeature(feature, geoJsonFmt) {
		const roadType = feature.get('roadType');
		const color = feature.get('color');
		const minzoom = minzoomForRoadType(roadType);

		return {
			type: 'Feature',
			tippecanoe: {
				minzoom
			},
			properties: {
				color,
				roadType
			},
			geometry: geoJsonFmt.writeGeometryObject(feature.getGeometry(), {
				featureProjection: 'EPSG:3857',
				dataProjection: 'EPSG:4326'
			})
		};
	}

	const merged = mergeSameColorSegments(coloredFeatures, coordsEqual);

	const simplified = merged.map((f) => {
		const simple = f.getGeometry().simplify(simplifyTolerance);
		f.setGeometry(simple);
		return f;
	});

	logger?.debug?.('Bench analysis finished', {
		roads: roads.length,
		benches: benches.length,
		lineStrings: lineStrings.length,
		startSources: startSources.length
	});

	return {
		type: 'FeatureCollection',
		features: simplified.map((f) => toPlainFeature(f, geoJsonFmt))
	};
}
