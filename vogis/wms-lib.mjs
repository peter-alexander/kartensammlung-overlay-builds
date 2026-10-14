import { DOMParser } from "@xmldom/xmldom";

export const VOGIS_SERVICES = Object.freeze([
	{ id: "themen", title: "Themen", url: "https://vogis.cnv.at/geoserver/vogis/wms", kind: "overlays" },
	{ id: "luftbilder", title: "Luftbilder", url: "https://vogis.cnv.at/mapserver/mapserv?map=i_luftbilder_r_wms.map", kind: "imagery" },
	{ id: "topokarte", title: "Topografische Karte", url: "https://vogis.cnv.at/mapserver/mapserv?map=i_topokarte_isoli_text_20t_r_wms.map", kind: "basemaps" },
	{ id: "gelaende", title: "Höhen und Gelände", url: "https://vogis.cnv.at/mapserver/mapserv?map=i_hoehen_und_gelaende_r_wms.map", kind: "terrain" },
	{ id: "relief", title: "Relief", url: "https://vogis.cnv.at/mapserver/mapserv?map=i_relief_r_wms.map", kind: "terrain" },
	{ id: "flaechenwidmung", title: "Flächenwidmung", url: "https://vogis.cnv.at/mapserver/mapserv?map=i_flaechenwidmung_v_wms.map", kind: "overlays" }
]);

function children(node, name) {
	const result = [];
	for (let item = node?.firstChild; item; item = item.nextSibling) {
		if (item.nodeType === 1 && (item.localName || item.nodeName) === name) result.push(item);
	}
	return result;
}
function value(node, name) { return String(children(node, name)[0]?.textContent || "").trim(); }

export function parseVogisWms(xml, service) {
	const errors = [];
	const document = new DOMParser({
		errorHandler: { warning: () => {}, error: e => errors.push(e), fatalError: e => errors.push(e) }
	}).parseFromString(String(xml || ""), "text/xml");
	if (errors.length || !document?.documentElement || !["WMS_Capabilities", "WMT_MS_Capabilities"].includes(document.documentElement.localName || document.documentElement.nodeName)) {
		throw new Error(`VoGIS ${service.id}: ungültige WMS-Capabilities (${errors.join(", ")})`);
	}
	const request = children(document.documentElement, "Capability")[0];
	const root = children(request, "Layer")[0];
	if (!root) throw new Error(`VoGIS ${service.id}: kein WMS-Layerbaum`);
	const formats = children(children(request, "Request")[0], "GetMap")
		.flatMap(entry => children(entry, "Format").map(f => String(f.textContent).trim()));
	const format = ["image/png", "image/jpeg", "image/jpg"].find(f => formats.includes(f));
	if (!format) throw new Error(`VoGIS ${service.id}: kein unterstütztes Rasterbildformat`);
	const layers = [];
	const seen = new Set();
	function walk(node, path = [], inheritedCrs = []) {
		const name = value(node, "Name");
		const title = value(node, "Title");
		const ownCrs = [...children(node, "CRS"), ...children(node, "SRS")]
			.flatMap(x => String(x.textContent || "").split(/\s+/)).filter(Boolean);
		const crs = ownCrs.length ? [...new Set([...ownCrs, ...inheritedCrs])] : inheritedCrs;
		if (name && !seen.has(name) && crs.includes("EPSG:3857")) {
			seen.add(name);
			layers.push({
				id: name, name: title || name,
				path: path.filter(Boolean).slice(-3),
				queryable: node.getAttribute("queryable") === "1"
			});
		}
		const next = name ? path : (title ? [...path, title] : path);
		for (const child of children(node, "Layer")) walk(child, next, crs);
	}
	walk(root);
	if (!layers.length) throw new Error(`VoGIS ${service.id}: keine EPSG:3857-Layer`);
	return {
		id: service.id,
		url: service.url,
		title: service.title,
		format,
		layers: layers.sort((a, b) => a.id.localeCompare(b.id, "de"))
	};
}

export function buildVogisCatalog(results) {
	const services = {};
	for (const descriptor of VOGIS_SERVICES) {
		const input = results?.[descriptor.id];
		if (!input) throw new Error(`VoGIS: fehlende Capabilities ${descriptor.id}; Katalog nicht aktualisiert`);
		services[descriptor.id] = parseVogisWms(input, descriptor);
	}
	return {
		version: 1,
		attribution: "Land Vorarlberg – VoGIS",
		services
	};
}
