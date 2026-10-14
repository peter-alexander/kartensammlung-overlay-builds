// Inventory-only probe for the public NÖ Atlas data interfaces.
// No data is downloaded beyond the public landing pages and Capabilities headers.
const urls = [
	"https://atlas.noe.gv.at/",
	"https://atlas.noe.gv.at/atlas/portal/noe-atlas",
	"https://atlas.noe.gv.at/atlas/portal/noe-atlas/map/Planung%20und%20Kataster/Grundst%C3%BCcke",
	"https://atlas.noe.gv.at/atlas/portal/noe-atlas?f=json",
	"https://atlas.noe.gv.at/atlas/portal/noe-atlas/map/Planung%20und%20Kataster/Grundst%C3%BCcke?f=json",
	"https://atlas.noe.gv.at/atlas/portal/scripts/webgis-map.min.js?8.26.3101",
	"https://atlas.noe.gv.at/atlas/portal/scripts/webgis-portal-cloud.js?8.26.3101",
	"https://atlas.noe.gv.at/atlas/api/rest/services?f=json",
	"https://atlas.noe.gv.at/atlas/api/rest/services/ags_adressen?f=json",
	"https://atlas.noe.gv.at/atlas/api/rest/services/ags_bahn?f=json",
	"https://atlas.noe.gv.at/atlas/api/rest/services/ags_atlas__burgen_und_schloesser?f=json",
	"https://atlas.noe.gv.at/atlas/api/rest/services/wms_flaechenwidmung@atlas_raumordnung?f=json",
	"https://atlas.noe.gv.at/atlas/api/rest/services/tc_gefahrenhinweiskarten_rutschprozesse?f=json",
	"https://atlas.noe.gv.at/atlas/api/rest/services/ags_adressen/metadata?f=json",
	"https://atlas.noe.gv.at/atlas/api/rest/services/ags_adressen/layers?f=json",
	"https://geo.noe.gv.at/public/rest/services?f=pjson",
	"https://geo.noe.gv.at/public/services/wms/geoland_wms_noe/MapServer/WmsServer?SERVICE=WMS&REQUEST=GetCapabilities",
	"https://sdi2.noe.gv.at/at.gv.noe.geoserver/ows?service=WMS&version=1.1.1&request=GetCapabilities",
	"https://sdi.noe.gv.at/at.gv.noe.geoserver/ows?service=WMS&version=1.1.1&request=GetCapabilities"
];
for (const url of urls) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 13000);
	try {
		const result = await fetch(url, {
			signal: controller.signal,
			headers: { "User-Agent": "Kartensammlung-NOe-Atlas-catalog-audit/1.0" }
		});
		const body = await result.text();
		const contentType = result.headers.get("content-type") || "";
		const scripts = [...body.matchAll(/<script\b[^>]*src=["']([^"']+)/gi)].map(x => x[1]).slice(0, 14);
		if (contentType.includes("javascript")) {
			const urls = [...new Set([...body.matchAll(/.{0,50}(?:rest\/|api\/|webgis\.init|mapInitializer|portalpage).{0,70}/gi)].map(x => x[0]))].slice(0, 40);
			console.log("ATLAS_SCRIPT " + JSON.stringify({url, snippets: urls, sample: body.slice(0, 1100)}));
		}
		if (url === "https://atlas.noe.gv.at/atlas/api/rest/services?f=json") {
			const services = JSON.parse(body).services;
			console.log("ATLAS_INDEX_SUMMARY " + JSON.stringify({
				total: services.length,
				imageOverlays: services.filter(x => x.type === "image" && !x.isbasemap).length,
				tileOverlays: services.filter(x => x.type === "tile" && !x.isbasemap)
					.map(x => ({id: x.id, name: x.name, supportedCrs: x.supportedCrs}))
			}));
		}
		if (url.includes("?f=json")) {
			console.log("ATLAS_JSON " + JSON.stringify({url, sample: body.slice(0, 4500)}));
		}

		const links = [...body.matchAll(/<a\b[^>]*href=["']([^"']+)/gi)].map(x => x[1]).slice(0, 14);
		const layerNames = [...body.matchAll(/<Name>([^<]+)<\/Name>/gi)].map(x => x[1]);
		const restKeys = (() => { try { return Object.keys(JSON.parse(body)); } catch { return []; } })();
		console.log(JSON.stringify({
			url, status: result.status, redirectedUrl: result.url, bytes: body.length,
			contentType, scripts, links, layerNames: {
				total: layerNames.length, examples: layerNames.slice(0, 20)
			}, restKeys, sample: body.slice(0, 550).replace(/\s+/g, " ")
		}));
	} catch (error) {
		console.log(JSON.stringify({url, error: error.message}));
	} finally {
		clearTimeout(timeout);
	}
}

const tileTemplate = "https://maps.noe.gv.at/tilecache/bmap/epsg3857/gefahrenhinweiskarten_rutschprozesse/L{z_}/R{y_}/C{x_}.png";
for (const z of [7, 10, 12]) {
	const lng = 15.62, lat = 48.2;
	const n = 2 ** z, x = Math.floor((lng + 180) / 360 * n);
	const rad = lat * Math.PI / 180;
	const y = Math.floor((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2 * n);
	const url = tileTemplate.replace("{z_}", String(z).padStart(2, "0"))
		.replace("{x_}", x.toString(16).padStart(8, "0"))
		.replace("{y_}", y.toString(16).padStart(8, "0"));
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(9000),
			headers: {Origin: "https://fahrrad.lima-city.de"}
		});
		console.log("ATLAS_TILE_PROBE " + JSON.stringify({
			url, status: response.status, type: response.headers.get("content-type"),
			cors: response.headers.get("access-control-allow-origin"),
			contentLength: response.headers.get("content-length")
		}));
		await response.arrayBuffer();
	} catch (error) {
		console.log("ATLAS_TILE_PROBE " + JSON.stringify({url, error: error.message}));
	}
}
