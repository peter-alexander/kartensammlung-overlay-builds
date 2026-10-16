import fs from "node:fs";
import crypto from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { buildNoeCatalog } from "./noe-catalog.mjs";
import { buildNoeAtlasCatalog } from "./noe-atlas-catalog.mjs";

const OUTPUT_DIR = new URL("./build/", import.meta.url);

const SOURCES = Object.freeze({
	wienWfs: "https://data.wien.gv.at/daten/geo?version=1.1.0&service=WFS&request=GetCapabilities",
	wienWms: "https://data.wien.gv.at/daten/wms?service=WMS&request=GetCapabilities&version=1.1.1",
	wienWmts: "https://mapsneu.wien.gv.at/wmtsneu/1.0.0/WMTSCapabilities.xml",
	laermkarte: "https://inspire.lfrz.gv.at/000804/wms?version=1.3.0&request=GetCapabilities",
	noeWms: "https://sdi.noe.gv.at/at.gv.noe.geoserver/ows?service=WMS&version=1.1.1&request=GetCapabilities",
	noeWfs: "https://sdi.noe.gv.at/at.gv.noe.geoserver/OGD/wfs?service=WFS&version=1.1.0&request=GetCapabilities",
	noeWmts: "https://sdi.noe.gv.at/at.gv.noe.geoserver/gwc/service/wmts?service=WMTS&version=1.0.0&request=GetCapabilities",
	stadtplan: "https://www.wien.gv.at/spezial/stadtplan/json/themes.json",
	arcgisStyles: "https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/self",
	bevWms: "https://data.bev.gv.at/geoserver/ows?service=WMS&request=GetCapabilities&version=1.3.0"
});

const BEV_SKIP_WORKSPACES = new Set([
	"BEVdataGGS",
	"BEVdataKAT",
	"BEVdataURMAPPE",
	"INSdataAD",
	"INSdataAU",
	"INSdataCP"
]);

const BEV_KNOWN_WORKSPACES = [
	"BEVdataCRS",
	"BEVdataDLM",
	"BEVdataGGS",
	"BEVdataKAT",
	"BEVdataURMAPPE",
	"INSdataAD",
	"INSdataAU",
	"INSdataCP",
	"INSdataEL",
	"INSdataGN",
	"INSdataLC",
	"myworkspace"
];

const WIEN_TITLE_REPLACEMENTS = new Map([
	["BAUSTELLENLINOGD", "Baustellen – Linien"],
	["BAUSTELLENPKTOGD", "Baustellen – Punkte"],
	["BEWEGTEAPOTHEKEOGD", "Bewegte Apotheke"],
	["DONAUINSFLOGD", "Donauinsel – Flächen"],
	["DONAUINSPKTOGD", "Donauinsel – Punkte"],
	["FOERDERUNGGEBAEUDEOGD", "Geförderte Gebäudebegrünungen"],
	["GENFLWOGD", "Generalisierte Flächenwidmung mit vier Kategorien"],
	["LADEZONEOGD", "Ladezone"]
]);

const WIEN_TITLE_SUFFIXES = new Map([
	["FFHBACHOGD", " nach Flora-Fauna-Habitat-Richtlinie"],
	["UBABACHOGD", " nach „Roter Liste“"],
	["VOTEBACHOGD", " nach VOTE"],
	["FFHGESAMTOGD", " Flora-Fauna-Habitat-Richtlinie Typ 1"],
	["FFHMISCHTYP2OGD", " Flora-Fauna-Habitat-Richtlinie Typ 2"],
	["FFHMISCHTYP3OGD", " Flora-Fauna-Habitat-Richtlinie Typ 3"],
	["UBAGEWAESSEROGD", " „Rote Liste“ Gewässer"],
	["UBAKLASSENOGD", " „Rote Liste“ Typ 1"],
	["UBAMISCHTYPENOGD", " „Rote Liste“ Mischtypen"],
	["VOTEKLASSENOGD", " VOTE Typ 1"],
	["VOTEMISCHTYPENOGD", " VOTE Mischtypen"],
	["VOTEQUELLENORTOGD", " VOTE Quellstandorte"],
	["HISTWASSERLTGOGD", " (BLAU)"],
	["HISTWASSERLDETOGD", " (KOMP)"],
	["ENINNOVPRJV2OGD", " 2"],
	["WERBETRAEGERLINOGD", " – Linien"],
	["WERBETRAEGERPKTOGD", " – Punkte"]
]);

async function fetchWithRetry(url, { attempts = 3, timeoutMs = 45_000, accept = "*/*" } = {}) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(url, {
				redirect: "follow",
				signal: controller.signal,
				headers: {
					Accept: accept,
					"User-Agent": "Kartensammlung server catalog builder"
				}
			});

			clearTimeout(timer);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} bei ${url}`);
			}

			return response;
		} catch (error) {
			clearTimeout(timer);
			lastError = error;

			if (attempt < attempts) {
				await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
			}
		}
	}

	throw lastError;
}

async function fetchText(url, options = {}) {
	return (await fetchWithRetry(url, options)).text();
}

async function fetchJson(url, options = {}) {
	return (await fetchWithRetry(url, {
		accept: "application/json,*/*;q=0.8",
		...options
	})).json();
}


const NOE_ATLAS_ERROR_IMAGE_SHA256
	= "ddb92949e3acd503e3efc2900b31c7aa861c22c3a84994290aee5c9a959b5b48";

function noeAtlasProbeBbox() {
	const halfWorld = 20037508.342789244;
	const z = 14;
	const x = 8939;
	const y = 5681;
	const span = halfWorld * 2 / (1 << z);
	return [
		-halfWorld + x * span,
		halfWorld - (y + 1) * span,
		-halfWorld + (x + 1) * span,
		halfWorld - y * span
	].join(",");
}

async function validateNoeAtlasAutoRaster(item) {
	const params = new URLSearchParams({
		f: "bin",
		width: "256",
		height: "256",
		bbox: noeAtlasProbeBbox(),
		crs: "3857",
		hmac: "false",
		layers: (item.layers || []).join(",")
	});
	try {
		const response = await fetchWithRetry(
			"https://atlas.noe.gv.at/atlas/api/rest/services/"
				+ encodeURIComponent(item.service)
				+ "/getmap?"
				+ params,
			{
				attempts: 2,
				timeoutMs: 30000,
				accept: "image/png,image/jpeg,*/*;q=0.5"
			}
		);
		const contentType = String(
			response.headers.get("content-type") || ""
		).toLowerCase();
		const bytes = Buffer.from(await response.arrayBuffer());
		if (!contentType.startsWith("image/") || bytes.length === 0) {
			return {
				ok: false,
				reason: "Atlas getmap lieferte kein Bild."
			};
		}
		const sha = crypto
			.createHash("sha256")
			.update(bytes)
			.digest("hex");
		if (sha === NOE_ATLAS_ERROR_IMAGE_SHA256) {
			return {
				ok: false,
				reason: "Atlas lieferte die bekannte HTTP-200-Fehlergrafik."
			};
		}
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			reason: String(error?.message || error)
		};
	}
}

async function validateNoeAtlasAutoRasters(catalog) {
	const candidates = [
		...(catalog.datasets || [])
			.filter((item) => item?.source !== "legacy")
			.map((item) => ({ kind: "dataset", item })),
		...(catalog.basemaps || [])
			.filter((item) => item?.source !== "legacy")
			.map((item) => ({ kind: "basemap", item }))
	];
	const results = await mapConcurrent(
		candidates,
		4,
		async (candidate) => ({
			...candidate,
			validation:
				await validateNoeAtlasAutoRaster(candidate.item)
		})
	);
	const rejected = results
		.filter((result) => !result.validation.ok)
		.map((result) => ({
			kind: result.kind,
			id: result.item.id,
			name: result.item.name,
			service: result.item.service,
			reason: result.validation.reason
		}));
	const rejectedDatasetIds = new Set(
		rejected
			.filter((item) => item.kind === "dataset")
			.map((item) => item.id)
	);
	const rejectedBasemapIds = new Set(
		rejected
			.filter((item) => item.kind === "basemap")
			.map((item) => item.id)
	);
	catalog.datasets = catalog.datasets.filter(
		(item) => !rejectedDatasetIds.has(item.id)
	);
	catalog.basemaps = catalog.basemaps.filter(
		(item) => !rejectedBasemapIds.has(item.id)
	);
	catalog.rejected = {
		autoRasters: rejected
	};
	catalog.counts.datasets = catalog.datasets.length;
	catalog.counts.autoDatasets = catalog.datasets.filter(
		(item) => item.source !== "legacy"
	).length;
	catalog.counts.queryableDatasets = catalog.datasets.filter(
		(item) => Array.isArray(item.queries) && item.queries.length
	).length;
	catalog.counts.basemaps = catalog.basemaps.length;
	catalog.counts.autoBasemaps = catalog.basemaps.filter(
		(item) => item.source !== "legacy"
	).length;
	return catalog;
}

function parseXml(xml, label) {
	const errors = [];
	const doc = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: (message) => errors.push(message),
			fatalError: (message) => errors.push(message)
		}
	}).parseFromString(xml, "application/xml");

	if (!doc?.documentElement || errors.length) {
		throw new Error(`${label}: ungültiges XML: ${errors.join("; ")}`);
	}

	return doc;
}

function childElements(element, localName) {
	const result = [];

	for (let node = element?.firstChild; node; node = node.nextSibling) {
		if (node.nodeType === 1 && String(node.localName || node.nodeName).toLowerCase() === localName.toLowerCase()) {
			result.push(node);
		}
	}

	return result;
}

function firstChild(element, localName) {
	return childElements(element, localName)[0] || null;
}

function firstChildText(element, localName) {
	return String(firstChild(element, localName)?.textContent || "").trim();
}

function allElements(doc, localName) {
	const result = [];
	const nodes = doc.getElementsByTagName("*");

	for (let index = 0; index < nodes.length; index++) {
		const node = nodes.item(index);
		if (node && String(node.localName || node.nodeName).toLowerCase() === localName.toLowerCase()) {
			result.push(node);
		}
	}

	return result;
}

function sortObject(object) {
	return Object.fromEntries(
		Object.entries(object).sort(([a], [b]) => a.localeCompare(b, "de", {
			numeric: true,
			sensitivity: "base"
		}))
	);
}

function cleanWienTitle(name, rawTitle) {
	let title = String(rawTitle || "")
		.trim()
		.replaceAll(" - ", " – ");

	for (const suffix of [" in Wien", " der Stadt Wien", " Wien"]) {
		if (title.endsWith(suffix)) {
			title = title.slice(0, -suffix.length);
		}
	}

	if (WIEN_TITLE_REPLACEMENTS.has(name)) {
		title = WIEN_TITLE_REPLACEMENTS.get(name);
	}

	if (WIEN_TITLE_SUFFIXES.has(name)) {
		title += WIEN_TITLE_SUFFIXES.get(name);
	}

	return title;
}

function buildWienWfsNames(xml) {
	const doc = parseXml(xml, "Wien WFS");
	const result = {};

	for (const featureType of allElements(doc, "FeatureType")) {
		const name = firstChildText(featureType, "Name");
		if (!name || name === "WCANLAGEOGD") continue;

		result[name] = cleanWienTitle(name, firstChildText(featureType, "Title"));
	}

	if (Object.keys(result).length < 100) {
		throw new Error(`Wien WFS: unplausibel wenige Layer: ${Object.keys(result).length}`);
	}

	return sortObject(result);
}

function topLevelWmsLayers(doc) {
	const capability = allElements(doc, "Capability")[0];
	const rootLayer = capability ? firstChild(capability, "Layer") : null;
	return rootLayer ? childElements(rootLayer, "Layer") : [];
}

function buildWienWmsNames(xml, label = "Wien WMS") {
	const doc = parseXml(xml, label);
	const result = {};

	for (const layer of topLevelWmsLayers(doc)) {
		const name = firstChildText(layer, "Name");
		if (!name || name === "WCANLAGEOGD") continue;

		result[name] = cleanWienTitle(name, firstChildText(layer, "Title"));
	}

	if (Object.keys(result).length < 10) {
		throw new Error(`${label}: unplausibel wenige Layer: ${Object.keys(result).length}`);
	}

	return sortObject(result);
}

function buildWienWmtsNames(xml) {
	const doc = parseXml(xml, "Wien WMTS");
	const result = [];

	for (const layer of allElements(doc, "Layer")) {
		const identifier = firstChildText(layer, "Identifier");
		const rawTitle = firstChildText(layer, "Title");
		if (!identifier || !rawTitle) continue;

		const styleNode = firstChild(layer, "Style");
		const matrixLink = firstChild(layer, "TileMatrixSetLink");
		const resource = childElements(layer, "ResourceURL")
			.find((node) => String(node.getAttribute("resourceType") || "").toLowerCase() === "tile")
			|| firstChild(layer, "ResourceURL");

		const style = styleNode ? firstChildText(styleNode, "Identifier") : "";
		const tileMatrixSet = matrixLink ? firstChildText(matrixLink, "TileMatrixSet") : "";
		let template = String(resource?.getAttribute("template") || "").trim();

		if (!style || !tileMatrixSet || !template) continue;

		template = template
			.replace("{Style}", style)
			.replace("{TileMatrixSet}", tileMatrixSet)
			.replace("{TileMatrix}", "{z}")
			.replace("{TileRow}", "{y}")
			.replace("{TileCol}", "{x}");

		result.push([
			identifier,
			rawTitle === "Stadtplan Beschriftung" ? "Beschriftung" : rawTitle,
			template
		]);
	}

	if (result.length < 5) {
		throw new Error(`Wien WMTS: unplausibel wenige Layer: ${result.length}`);
	}

	result.sort((a, b) => String(a[0]).localeCompare(String(b[0]), "de", {
		numeric: true,
		sensitivity: "base"
	}));

	return result;
}

function normalizeStadtplanThemes(data) {
	const themes = Array.isArray(data) ? data : data?.themes;

	if (!Array.isArray(themes) || themes.length < 5) {
		throw new Error("Stadtplan Wien: themes fehlt oder ist unplausibel leer.");
	}

	return { themes };
}

function buildArcGisStyles(data) {
	if (!Array.isArray(data?.styles)) {
		throw new Error("ArcGIS styles/self: styles fehlt.");
	}

	const lines = [];
	let count = 0;

	const skipNames = new Set([
		"ArcGIS Charted Territory",
		"ArcGIS Outdoor",
		"ArcGIS Streets Relief",
		"ArcGIS Streets Relief Base",
		"ArcGIS Topographic Base",
		"Open Basemaps OpenStreetMap Style Relief",
		"Open Basemaps OpenStreetMap Style Relief Base",
		"Open Basemaps Streets Relief",
		"Open Basemaps Streets Relief Base",
		"ArcGIS Dark Gray",
		"ArcGIS Human Geography",
		"ArcGIS Human Geography Base",
		"ArcGIS Human Geography Dark",
		"ArcGIS Human Dark",
		"ArcGIS Human Dark Base",
		"ArcGIS Light Gray",
		"Open Basemaps Dark Gray",
		"Open Basemaps Light Gray"
	]);

	const rename = new Map([
		["ArcGIS Charted Territory Base", "ArcGIS Charted Territory"],
		["ArcGIS Dark Gray Base", "ArcGIS Dark Gray"],
		["ArcGIS Human Geography Dark Base", "ArcGIS Human Geography Dark"],
		["ArcGIS Imagery", "ArcGIS Imagery Hybrid"],
		["ArcGIS Imagery Standard", "ArcGIS Imagery"],
		["ArcGIS Light Gray Base", "ArcGIS Light Gray"],
		["ArcGIS Oceans Base", "ArcGIS Oceans"],
		["Open Basemaps Dark Gray Base", "Open Basemaps Dark Gray Base"],
		["Open Basemaps Light Gray Base", "Open Basemaps Light Gray"]
	]);

	for (const sourceStyle of data.styles) {
		if (!sourceStyle || typeof sourceStyle !== "object") continue;
		if (skipNames.has(sourceStyle.name)) continue;

		const style = { ...sourceStyle };
		style.name = rename.get(style.name) || style.name;

		const path = String(style.path || "");
		if (style.provider === "osm" || path.includes("navigation") || path.includes("terrain")) continue;

		const key = path.replaceAll("/", "_");
		if (!key || key === "arcgis_imagery_labels") continue;

		let target = "BASEMAPS";
		let cat = "Karten";
		let sec = "Esri";
		let arcgisRole = "basemap";
		let arcgisKind = "basemap-style";
		let subsec = null;
		let opacity = null;

		if (path.includes("labels") || path.includes("open/hybrid/detail")) {
			target = "OVERLAYS";
			cat = "Overlays";
			sec = "Beschriftungen";
			style.name = String(style.name || "")
				.replace(/ Labels$/, "")
				.replace(/ Detail$/, "");
			arcgisRole = "overlay";
			arcgisKind = "basemap-style-overlay";
		} else if (path.includes("hillshade")) {
			target = "OVERLAYS";
			cat = "Overlays";
			sec = "Höhe & Relief";
			style.name = String(style.name || "").startsWith("ArcGIS ")
				? String(style.name).slice(7)
				: style.name;
			arcgisRole = "overlay";
			arcgisKind = "basemap-style-overlay";
			subsec = "ArcGIS";
			opacity = 0.4;
		} else if (path.includes("arcgis/oceans/base")) {
			cat = "Hintergrundkarten";
		} else if (style.group === "satellite") {
			cat = "Luft- & Satellitenbilder";
		} else if (style.group === "reference") {
			cat = "Hintergrundkarten";
		} else if (style.group === "creative") {
			if (path.includes("charted-territory")) cat = "Karten";
			else continue;
		}

		const item = {
			cat,
			sec,
			name: style.name,
			key,
			type: target === "BASEMAPS" ? "arcgis_basemap" : "arcgis_overlay",
			style: path,
			arcgis: {
				role: arcgisRole,
				kind: arcgisKind,
				path,
				provider: style.provider ?? null,
				group: style.group ?? null
			},
			preferences: {
				language: "de"
			}
		};

		if (subsec) item.subsec = subsec;
		if (opacity !== null) item.opacity = opacity;

		lines.push(`${target}[${JSON.stringify(key)}] = ${JSON.stringify(item)};`);
		lines.push(`${target}[${JSON.stringify(key)}].getToken = () => ESRI_API_KEY;`);
		count++;
	}

	if (count < 10) {
		throw new Error(`ArcGIS Styles: unplausibel wenige verwendete Styles: ${count}`);
	}

	return {
		code: lines.join("\n") + "\n",
		count
	};
}

function bevDiscoveredWorkspaces(xml) {
	const doc = parseXml(xml, "BEV global WMS");
	const workspaces = new Set();

	for (const layer of allElements(doc, "Layer")) {
		const fullName = firstChildText(layer, "Name");
		if (!fullName || !fullName.includes(":")) continue;

		const workspace = fullName.split(":", 1)[0];
		if (workspace) workspaces.add(workspace);
	}

	return [...workspaces];
}

const BEV_TITLE_REPLACEMENTS = new Map([
	["Grid Coverage 5m", "Höhenraster 5 m"],
	["Grid Coverage 25m", "Höhenraster 25 m"],
	["Grid Coverage 50m", "Höhenraster 50 m"],
	["Grid Coverage 100m", "Höhenraster 100 m"],
	["Grid Coverage 250m", "Höhenraster 250 m"],
	["Grid Coverage 500m", "Höhenraster 500 m"],
	["Spot Height", "Höhenpunkt"],
	["Contour Line", "Höhenlinie"]
]);

function buildBevWorkspace(xml, workspace) {
	const doc = parseXml(xml, `BEV ${workspace}`);
	const layers = {};

	for (const layer of allElements(doc, "Layer")) {
		const rawName = firstChildText(layer, "Name");
		if (!rawName) continue;

		const fullName = rawName.includes(":") ? rawName : `${workspace}:${rawName}`;
		let title = firstChildText(layer, "Title") || rawName;

		if (title === "Digitales Landschaftsmodell - Geographische Namen INSPIRE") {
			title = "DLM Geographische Namen INSPIRE";
		}

		title = BEV_TITLE_REPLACEMENTS.get(title) || title;
		layers[fullName] = title;
	}

	return {
		name: workspace,
		title: workspace,
		layers: sortObject(layers)
	};
}

async function mapConcurrent(items, concurrency, fn) {
	const results = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	}

	await Promise.all(
		Array.from(
			{ length: Math.min(concurrency, items.length) },
			() => worker()
		)
	);

	return results;
}

async function buildBevCatalog(globalXml) {
	const workspaces = [...new Set([
		...BEV_KNOWN_WORKSPACES,
		...bevDiscoveredWorkspaces(globalXml)
	])]
		.filter((workspace) => !BEV_SKIP_WORKSPACES.has(workspace))
		.sort((a, b) => a.localeCompare(b, "de", { numeric: true }));

	if (workspaces.length < 3) {
		throw new Error(`BEV: unplausibel wenige Workspaces: ${workspaces.length}`);
	}

	const entries = await mapConcurrent(workspaces, 5, async (workspace) => {
		const url = `https://data.bev.gv.at/geoserver/${encodeURIComponent(workspace)}/ows?service=WMS&request=GetCapabilities&version=1.3.0`;
		const xml = await fetchText(url, {
			accept: "application/xml,text/xml,*/*;q=0.8",
			timeoutMs: 60_000
		});

		return [workspace, buildBevWorkspace(xml, workspace)];
	});

	const catalog = sortObject(Object.fromEntries(entries));
	const layerCount = Object.values(catalog)
		.reduce((sum, workspace) => sum + Object.keys(workspace.layers || {}).length, 0);

	if (layerCount < 20) {
		throw new Error(`BEV: unplausibel wenige Layer insgesamt: ${layerCount}`);
	}

	return {
		catalog,
		workspaceCount: Object.keys(catalog).length,
		layerCount
	};
}

function writeJs(name, variableName, value) {
	fs.writeFileSync(
		new URL(`./build/${name}`, import.meta.url),
		`window.${variableName} = ${JSON.stringify(value)};\n`,
		"utf8"
	);
}

function writeJson(name, value) {
	fs.writeFileSync(
		new URL(`./build/${name}`, import.meta.url),
		JSON.stringify(value) + "\n",
		"utf8"
	);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log("Lade öffentliche Serverkataloge ...");
const [
	wienWfsXml,
	wienWmsXml,
	wienWmtsXml,
	laermXml,
	noeXml,
	stadtplanJson,
	arcgisJson,
	bevXml
] = await Promise.all([
	fetchText(SOURCES.wienWfs, { accept: "application/xml,text/xml,*/*;q=0.8" }),
	fetchText(SOURCES.wienWms, { accept: "application/xml,text/xml,*/*;q=0.8" }),
	fetchText(SOURCES.wienWmts, { accept: "application/xml,text/xml,*/*;q=0.8" }),
	fetchText(SOURCES.laermkarte, { accept: "application/xml,text/xml,*/*;q=0.8" }),
	fetchText(SOURCES.noeWms, { accept: "application/xml,text/xml,*/*;q=0.8" }),
	fetchJson(SOURCES.stadtplan),
	fetchJson(SOURCES.arcgisStyles),
	fetchText(SOURCES.bevWms, {
		accept: "application/xml,text/xml,*/*;q=0.8",
		timeoutMs: 60_000
	})
]);

const geoserverNames = buildWienWfsNames(wienWfsXml);
const wmsNames = buildWienWmsNames(wienWmsXml);
const wienWmtsNames = buildWienWmtsNames(wienWmtsXml);
const laermkarteNames = buildWienWmsNames(laermXml, "Lärmkarte WMS");
// WFS/WMTS are optional enhancements. A failed side service must never
// prevent publication of the other, already available public catalogs.
const fetchNoeOptional = async (url, label) => {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 18000);
		try {
			const response = await fetch(url, {
				signal: controller.signal,
				headers: { Accept: "application/xml,text/xml,*/*;q=0.8" }
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return await response.text();
		} finally {
			clearTimeout(timeout);
		}
	} catch (error) {
		console.warn(`NÖ ${label} nicht erreichbar: ${error.message}`);
		return null;
	}
};
const [noeWfsXml, noeWmtsXml] = await Promise.all([
	fetchNoeOptional(SOURCES.noeWfs, "WFS"),
	fetchNoeOptional(SOURCES.noeWmts, "WMTS")
]);
const noeCatalog = buildNoeCatalog({
	wmsXml: noeXml,
	wfsXml: noeWfsXml,
	wmtsXml: noeWmtsXml
});
const stadtplan = normalizeStadtplanThemes(stadtplanJson);
const arcgisStyles = buildArcGisStyles(arcgisJson);
const bev = await buildBevCatalog(bevXml);

writeJs("GeoserverNames.js", "GeoserverNames", geoserverNames);
writeJson("GeoserverNames.json", geoserverNames);
writeJs("WmsNames.js", "WmsNames", wmsNames);
writeJson("WmsNames.json", wmsNames);
writeJs("WienWmtsNames.js", "WienWmtsNames", wienWmtsNames);
writeJson("WienWmtsNames.json", wienWmtsNames);
writeJs("LaermkarteNames.js", "LaermkarteNames", laermkarteNames);
writeJson("LaermkarteNames.json", laermkarteNames);
writeJson("NoeCatalog.json", noeCatalog);
	// Atlas is a separate WebGIS catalog, not part of the SDI GeoServer.
	// Treat outages/schema changes as optional: never jeopardize the daily core catalogs.
	try {
		const index = await fetchJson(
			"https://atlas.noe.gv.at/atlas/api/rest/services?f=json",
			{ attempts: 2, timeoutMs: 20000 }
		);
		const serviceIds = [...new Set(
			(index.services || [])
				.map((service) => String(service?.id || "").trim())
				.filter(Boolean)
		)];
		const detailEntries = await mapConcurrent(
			serviceIds,
			6,
			async (id) => [
				id,
				await fetchJson(
					"https://atlas.noe.gv.at/atlas/api/rest/services/"
						+ encodeURIComponent(id)
						+ "?f=json",
					{ attempts: 2, timeoutMs: 30000 }
				)
			]
		);
		const atlas = await validateNoeAtlasAutoRasters(
			buildNoeAtlasCatalog(
				index,
				Object.fromEntries(detailEntries)
			)
		);
		writeJson("NoeAtlasCatalog.json", atlas);
		for (const rejected of atlas.rejected?.autoRasters || []) {
			console.warn(
				"NÖ Atlas automatisch verworfen: "
					+ rejected.name
					+ " ("
					+ rejected.reason
					+ ")"
			);
		}
		console.log("NÖ Atlas: " + atlas.counts.total + " Dienste, "
			+ atlas.counts.datasets + " Datenoverlays ("
			+ atlas.counts.autoDatasets + " automatisch), "
			+ atlas.counts.basemaps + " Basemaps, "
			+ atlas.counts.tiles + " Tile-Overlays");
	} catch (error) {
		console.warn("NÖ Atlas nicht aktualisiert (anderer Kataloglauf bleibt intakt):", error.message);
	}

writeJs("StadtplanJson.js", "StadtplanJson", stadtplan);
writeJson("StadtplanJson.json", stadtplan);
writeJs("BevGeoserverNames.js", "BevGeoserverNames", bev.catalog);
writeJson("BevGeoserverNames.json", bev.catalog);

fs.writeFileSync(
	new URL("./build/ArcGISStyles.js", import.meta.url),
	arcgisStyles.code,
	"utf8"
);

console.log([
	`Wien WFS: ${Object.keys(geoserverNames).length}`,
	`Wien WMS: ${Object.keys(wmsNames).length}`,
	`Wien WMTS: ${wienWmtsNames.length}`,
	`Lärmkarte: ${Object.keys(laermkarteNames).length}`,
	`NÖ WMS: ${noeCatalog.counts.wms} / WFS: ${noeCatalog.counts.wfs} / Cache: ${noeCatalog.counts.cached}`,
	`Stadtplan-Themes: ${stadtplan.themes.length}`,
	`ArcGIS Styles: ${arcgisStyles.count}`,
	`BEV: ${bev.workspaceCount} Workspaces / ${bev.layerCount} Layer`
].join("\n"));
