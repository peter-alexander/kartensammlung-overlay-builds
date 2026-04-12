export function transformExtentToBbox(extent, geo) {
	const [minX, minY, maxX, maxY] = extent;
	const bl = geo.toLonLat([minX, minY], 'EPSG:3857');
	const tr = geo.toLonLat([maxX, maxY], 'EPSG:3857');
	return `${bl[1]},${bl[0]},${tr[1]},${tr[0]}`;
}

export function coordToId(coord) {
	return `${coord[0].toFixed(4)},${coord[1].toFixed(4)}`;
}

export function distance(a, b, geo) {
	return geo.getLength(
		new geo.LineString([a, b]),
		{ projection: 'EPSG:3857' }
	);
}

export function coordsEqual(a, b, eps = 1e-9) {
	return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

export function getClosestPointOnSegment(p, a, b) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len2 = dx * dx + dy * dy;

	if (len2 === 0) return a;

	const t = Math.max(
		0,
		Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)
	);

	return [
		a[0] + t * dx,
		a[1] + t * dy
	];
}

export function getRoadType(props) {
	const hw = props?.highway || '';
	return hw;
}

export function getFreeOffsetForRoadType(roadType) {
	switch (roadType) {
		case 'footway':
		case 'path':
		case 'cycleway':
		case 'track':
		case 'pedestrian':
			return 2.0;

		case 'service':
		case 'living_street':
		case 'residential':
		case 'unclassified':
			return 3.0;

		case 'tertiary':
			return 4.0;

		case 'secondary':
			return 5.0;

		case 'primary':
			return 6.0;

		default:
			return 2.5;
	}
}

export function colorFor(d) {
	if (d < 25) return 25;
	if (d < 50) return 50;
	if (d < 75) return 75;
	return 0;
}

export function zindexFor(d) {
	if (d < 25) return 40;
	if (d < 50) return 30;
	if (d < 75) return 20;
	return 10;
}

export function splitEdgeByThresholds(A, B, dA, dB, thresholds, geo, step = 10) {
	const len = distance(A, B, geo);
	const n = Math.ceil(len / step);

	function f(t) {
		return Math.min(
			dA + t * len,
			dB + (1 - t) * len
		);
	}

	const pts = [{ coord: A, d: dA, t: 0 }];

	for (let i = 1; i < n; ++i) {
		const t = i / n;
		const P = [
			A[0] + t * (B[0] - A[0]),
			A[1] + t * (B[1] - A[1])
		];
		pts.push({ coord: P, d: f(t), t });
	}

	pts.push({ coord: B, d: dB, t: 1 });

	thresholds.forEach((T) => {
		let i = 0;

		while (i < pts.length - 1) {
			const p = pts[i];
			const q = pts[i + 1];

			if ((p.d < T && q.d > T) || (q.d < T && p.d > T)) {
				const frac = (T - p.d) / (q.d - p.d);
				const t = p.t + frac * (q.t - p.t);
				const P = [
					p.coord[0] + frac * (q.coord[0] - p.coord[0]),
					p.coord[1] + frac * (q.coord[1] - p.coord[1])
				];

				pts.splice(i + 1, 0, { coord: P, d: T, t });
			} else {
				++i;
			}
		}
	});

	return pts.sort((a, b) => a.t - b.t);
}