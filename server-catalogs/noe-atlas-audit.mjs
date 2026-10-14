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
		if (url.includes("?f=json")) {
			console.log("ATLAS_JSON " + JSON.stringify({url, sample: body.slice(0, 5000)}));
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
