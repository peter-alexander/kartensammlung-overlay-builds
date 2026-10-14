import { DOMParser } from "@xmldom/xmldom";

const NOE_WMS = "https://sdi.noe.gv.at/at.gv.noe.geoserver/ows";
const NOE_WFS = "https://sdi.noe.gv.at/at.gv.noe.geoserver/ows";
const NOE_WMTS = "https://sdi.noe.gv.at/at.gv.noe.geoserver/gwc/service/wmts";

function children(node, name) {
	const result = [];
	for (let child = node?.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === 1 && String(child.localName || child.nodeName).toLowerCase() === name.toLowerCase()) {
			result.push(child);
		}
	}
	return result;
}

function child(node, name) {
	return children(node, name)[0] || null;
}

function value(node, name) {
	return String(child(node, name)?.textContent || "").trim();
}

function descendants(node, name) {
	const result = [];
	for (const item of Array.from(node.getElementsByTagName("*"))) {
		if (String(item.localName || item.nodeName).toLowerCase() === name.toLowerCase()) {
			result.push(item);
		}
	}
	return result;
}

function parse(xml, label) {
	const errors = [];
	const doc = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: (error) => errors.push(String(error)),
			fatalError: (error) => errors.push(String(error))
		}
	}).parseFromString(xml, "application/xml");
	if (!doc?.documentElement || errors.length || descendants(doc, "parsererror").length) {
		throw new Error(`${label}: ungültiges XML (${errors.join("; ")})`);
	}
	return doc;
}

const OMIT = /(?:blatt(?:schnitt|index)|^metadaten?$|^metadata$|^legend(?:e)?$|^service[_-]?info$)/i;
const TITLES = new Map([
	["noe_edge", "GIP – Abschnitte"],
	["noe_linearuse", "GIP – Nutzungsstreifen"],
	["noe_node", "GIP – Knoten"],
	["noe_plateau", "GIP – Kreuzungsflächen"],
	["noe_turnuse", "GIP – Abbiegerelationen"],
	["VIS_EDGE_INFOLIEFER", "GIP – Abschnitte nach Informationslieferant"],
	["LINIEN_3857", "Verwaltungsgrenzen – Linien"]
]);

function titleFor(name, title) {
	const local = name.split(":").pop();
	return TITLES.get(local) || String(title || local)
		.replaceAll(" in Niederösterreich", "")
		.replaceAll(" Niederösterreich", "")
		.replaceAll(" NÖ", "")
		.replaceAll("NÖ ", "")
		.replaceAll("Intermodales Verkehrsreferenzsystem (GIP.at)", "GIP")
		.replaceAll("Sieldungsgrenzen", "Siedlungsgrenzen")
		.replaceAll(" - ", " – ").trim();
}

function readWms(xml) {
	const doc = parse(xml, "NÖ WMS");
	const capability = descendants(doc, "Capability")[0];
	const root = child(capability, "Layer");
	if (!root) throw new Error("NÖ WMS: Root-Layer fehlt");
	const operation = descendants(child(capability, "Request") || capability, "GetFeatureInfo")[0];
	const infoFormats = children(operation, "Format").map((x) => String(x.textContent).trim());
	const layers = new Map();

	function visit(parent, inheritedQueryable = false) {
		for (const layer of children(parent, "Layer")) {
			const attr = layer.getAttribute("queryable");
			const queryable = attr === null ? inheritedQueryable : attr === "1" || attr === "true";
			const name = value(layer, "Name");
			if (/^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(name)) {
				const title = titleFor(name, value(layer, "Title"));
				const local = name.split(":")[1];
				if (!OMIT.test(local) && !OMIT.test(title)) {
					const text = value(layer, "Abstract");
					layers.set(name, {
						name, title,
						abstract: text.slice(0, 800),
						queryable: queryable && infoFormats.length > 0,
						infoFormat: infoFormats.includes("application/json") ? "application/json"
							: infoFormats.includes("text/plain") ? "text/plain"
								: infoFormats.includes("text/xml") ? "text/xml" : null
					});
				}
			}
			visit(layer, queryable);
		}
	}
	visit(root, root.getAttribute("queryable") === "1");
	if (layers.size < 20) throw new Error(`NÖ WMS: nur ${layers.size} Layer`);
	return layers;
}

function readWfs(xml) {
	if (!xml) return new Set();
	const doc = parse(xml, "NÖ WFS");
	return new Set(descendants(doc, "FeatureType")
		.map((node) => value(node, "Name")).filter(Boolean));
}

function readWmts(xml) {
	const doc = parse(xml, "NÖ WMTS");
	const contents = descendants(doc, "Contents")[0];
	if (!contents) throw new Error("NÖ WMTS: Contents fehlt");
	const cache = new Map();
	for (const layer of children(contents, "Layer")) {
		const name = value(layer, "Identifier");
		const formats = children(layer, "Format").map((f) => String(f.textContent).trim());
		const matrixSets = children(layer, "TileMatrixSetLink")
			.map((link) => value(link, "TileMatrixSet"));
		const mercator = matrixSets.some((name) => /(?:900913|3857|googlemapscompatible)/i.test(name));
		if (name && formats.includes("image/png") && mercator) {
			cache.set(name, { format: "png" });
		}
	}
	return cache;
}

export function buildNoeCatalog({ wmsXml, wfsXml, wmtsXml = null }) {
	const wms = readWms(wmsXml);
	let wfs = new Set();
	let cached = new Map();
	try {
		if (wfsXml) wfs = readWfs(wfsXml);
	} catch (error) {
		console.warn("NÖ WFS-Capabilities fehlerhaft:", error.message);
	}
	// No valid WMTS capabilities means we cannot assume the TMS cache exists.
	try {
		if (wmtsXml) cached = readWmts(wmtsXml);
	} catch (error) {
		console.warn("NÖ WMTS-Capabilities fehlerhaft:", error.message);
	}
	const layers = [...wms.values()].map((layer) => ({
		...layer,
		wfs: wfs.has(layer.name),
		cache: cached.get(layer.name) || null
	})).sort((a, b) => a.name.localeCompare(b.name, "de"));

	return {
		version: 2,
		generatedAt: new Date().toISOString(),
		services: { wms: NOE_WMS, wfs: NOE_WFS, wmts: NOE_WMTS },
		counts: {
			wms: layers.length,
			wfs: layers.filter((layer) => layer.wfs).length,
			cached: layers.filter((layer) => layer.cache).length,
			queryable: layers.filter((layer) => layer.queryable).length
		},
		layers
	};
}
