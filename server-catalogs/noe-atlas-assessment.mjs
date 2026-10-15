const requests = [
	["Vischer", "wms_iws__historische_karten", "VISCHER|default"],
	["Administrativkarte", "wms_iws__historische_karten", "ADMINK|default"],
	["Franzisco-Josephinische Landesaufnahme", "wms_iws__historische_karten", "SPEZIALK|default"],
	["Luftbild Epoche 1", "wms_iws__luftbild_epochen", "EP01|default"],
	["Luftbild Epoche 2", "wms_iws__luftbild_epochen", "EP02|default"],
	["Luftbild Epoche 3", "wms_iws__luftbild_epochen", "EP03|default"],
	["Luftbild Epoche 4", "wms_iws__luftbild_epochen", "EP04|default"],
	["Luftbild Epoche 5", "wms_iws__luftbild_epochen", "EP05|default"],
	["Luftbild Epoche 6", "wms_iws__luftbild_epochen", "EP06|default"],
	["Luftbild Epoche 7", "wms_iws__luftbild_epochen", "EP07|default"],
	["Luftbild aktuell", "wms_iws__luftbild_epochen", "FAOF|default"],
	["Luftbild aktuell CIR", "wms_iws__luftbild_epochen", "FAOFCIR|default"],
	["Luftbild Epoche 7 CIR", "wms_iws__luftbild_epochen", "EP07CIR|default"]
];

const bbox = "1766991.570302777,6147500.519937721,1770244.689998977,6150270.937520729";

for (const [label, service, layer] of requests) {
	const base = "https://atlas.noe.gv.at/atlas/api/rest/services/" + encodeURIComponent(service) + "/getmap";
	const params = new URLSearchParams({
		f: "bin",
		width: "512",
		height: "436",
		bbox,
		crs: "3857",
		layers: layer,
		hmac: "false"
	});
	try {
		const response = await fetch(base + "?" + params, {
			signal: AbortSignal.timeout(20000),
			headers: {
				Origin: "https://fahrrad.lima-city.de",
				"User-Agent": "Kartensammlung-NOE-historical-raster-probe/1.0"
			}
		});
		const bytes = new Uint8Array(await response.arrayBuffer());
		const png = bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
		const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
		console.log("NOE_HIST_GETMAP " + JSON.stringify({
			label,
			service,
			layer,
			status: response.status,
			contentType: response.headers.get("content-type"),
			cors: response.headers.get("access-control-allow-origin"),
			bytes: bytes.length,
			png,
			jpeg,
			sample: (!png && !jpeg)
				? new TextDecoder().decode(bytes.slice(0, 1000)).replace(/\s+/g, " ")
				: null
		}));
	} catch (error) {
		console.log("NOE_HIST_GETMAP_ERROR " + JSON.stringify({
			label, service, layer, error: error.message
		}));
	}
}
