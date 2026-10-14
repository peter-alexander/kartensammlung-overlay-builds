// Inventory-only probe for the public NÖ Atlas data interfaces.
// No data is downloaded beyond the public landing pages and Capabilities headers.
const urls = [
	"https://atlas.noe.gv.at/",
	"https://atlas.noe.gv.at/atlas/portal/noe-atlas",
	"https://atlas.noe.gv.at/atlas/portal/noe-atlas/map/Planung%20und%20Kataster/Grundst%C3%BCcke",
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
		if (url.startsWith("https://atlas.noe.gv.at/atlas/portal/")) {
			console.log("ATLAS_HTML " + JSON.stringify({url, body: body.slice(0, 14000)}));
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
