import {
	coordToId,
	distance
} from './geometryUtils.js';

export function buildGraphFromRoads(roadCoords, lineTypeByPath, geo) {
	const graph = new Map();

	for (const [pIdx, coords] of roadCoords.entries()) {
		const roadType = lineTypeByPath[pIdx];

		for (let i = 0; i < coords.length - 1; i++) {
			const A = coords[i];
			const B = coords[i + 1];
			const idA = coordToId(A);
			const idB = coordToId(B);
			const dist = distance(A, B, geo);

			if (!graph.has(idA)) graph.set(idA, []);
			if (!graph.has(idB)) graph.set(idB, []);

			const edge = {
				target: idB,
				coordA: A,
				coordB: B,
				distance: dist,
				roadType
			};

			graph.get(idA).push(edge);
			graph.get(idB).push({
				...edge,
				target: idA,
				coordA: B,
				coordB: A
			});
		}
	}

	return graph;
}

export function multiSourceDijkstra(graph, sources) {
	const dist = new Map();
	const pq = [];

	function push(item) {
		pq.push(item);
		let i = pq.length - 1;

		while (i > 0) {
			const p = (i - 1) >> 1;
			if (pq[p].d <= pq[i].d) break;
			[pq[p], pq[i]] = [pq[i], pq[p]];
			i = p;
		}
	}

	function pop() {
		if (!pq.length) return null;

		const top = pq[0];
		const last = pq.pop();

		if (pq.length) {
			pq[0] = last;
			let i = 0;

			while (true) {
				let l = (i << 1) + 1;
				let r = l + 1;
				let s = i;

				if (l < pq.length && pq[l].d < pq[s].d) s = l;
				if (r < pq.length && pq[r].d < pq[s].d) s = r;
				if (s === i) break;

				[pq[i], pq[s]] = [pq[s], pq[i]];
				i = s;
			}
		}

		return top;
	}

	for (const { id, d0 } of sources) {
		dist.set(id, d0);
		push({ id, d: d0 });
	}

	while (pq.length) {
		const cur = pop();
		const u = cur.id;
		const du = cur.d;

		if (du !== dist.get(u)) continue;

		for (const e of graph.get(u) || []) {
			const v = e.target;
			const alt = du + e.distance;

			if (alt < (dist.get(v) ?? Infinity)) {
				dist.set(v, alt);
				push({ id: v, d: alt });
			}
		}
	}

	return dist;
}

export function mergeSameColorSegments(features, coordsEqual) {
	const merged = [];
	let last = null;

	features.sort((a, b) => (a.get('zindex') ?? 0) - (b.get('zindex') ?? 0));

	for (const f of features) {
		if (
			last &&
			last.get('color') === f.get('color') &&
			coordsEqual(
				last.getGeometry().getLastCoordinate(),
				f.getGeometry().getFirstCoordinate()
			)
		) {
			const coords = last.getGeometry().getCoordinates();
			coords.pop();
			last.getGeometry().setCoordinates(
				coords.concat(f.getGeometry().getCoordinates())
			);
		} else {
			merged.push(f);
			last = f;
		}
	}

	return merged;
}