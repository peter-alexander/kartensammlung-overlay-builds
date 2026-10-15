const HALF = 20037508.342789244;
function mercator(lon, lat) {
	const safe = Math.max(-85.05112878, Math.min(85.05112878, lat));
	const x = lon * HALF / 180;
	const y = HALF * Math.log(Math.tan(Math.PI / 4 + safe * Math.PI / 360)) / Math.PI;
	return [x, y];
}

const tests = [
	{
		label: "Top Radrouten Thermenradweg",
		service: "ags_radwege",
		query: "top_radroute2",
		lon: 16.34616272,
		lat: 48.13329272,
		radius: 150
	},
	{
		label: "BH St. Pölten",
		service: "ags_dienststellen",
		query: "bezirkshauptmannschaft_bh",
		lon: 15.625,
		lat: 48.205,
		radius: 5000
	},
	{
		label: "Fließgewässernetz St. Pölten",
		service: "ags_fliessgewaesser@atlas_wasser",
		query: "gewaessernetz",
		lon: 15.62,
		lat: 48.20,
		radius: 1000
	}
];

for (const test of tests) {
	const [x, y] = mercator(test.lon, test.lat);
	const params = new URLSearchParams({
		f: "json",
		hmac: "false",
		shape: `POINT (${x} ${y})`,
		shape_srs: "3857",
		calc_srs: "3857",
		shape_buffer: String(test.radius),
		geometry: "none",
		_limit: "8"
	});
	const url = "https://atlas.noe.gv.at/atlas/api/rest/services/"
		+ encodeURIComponent(test.service)
		+ "/queries/" + encodeURIComponent(test.query)
		+ "/identify?" + params;
	const response = await fetch(url, {
		signal: AbortSignal.timeout(20000),
		headers: {
			Accept: "application/json",
			"User-Agent": "Kartensammlung-NOE-Atlas-query-probe/1.0"
		}
	});
	const text = await response.text();
	let data = null;
	try { data = JSON.parse(text); } catch {}
	console.log("ATLAS_IDENTIFY_RESULT " + JSON.stringify({
		label: test.label,
		status: response.status,
		contentType: response.headers.get("content-type"),
		url,
		featureCount: Array.isArray(data?.features) ? data.features.length : null,
		sample: data?.features?.slice(0, 2) || data || text.slice(0, 1200)
	}));
}
