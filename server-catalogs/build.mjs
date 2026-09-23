import fs from "node:fs";
import { DOMParser } from "@xmldom/xmldom";

const OUTPUT_DIR = new URL("./build/", import.meta.url);

const SOURCES = Object.freeze({
	wienWfs: "https://data.wien.gv.at/daten/geo?version=1.1.0&service=WFS&request=GetCapabilities",
	wienWms: "https://data.wien.gv.at/daten/wms?service=WMS&request=GetCapabilities&version=1.1.1",
	laermkarte: "https://inspire.lfrz.gv.at/000804/wms?version=1.3.0&request=GetCapabilities",
	noeWms: "https://sdi.noe.gv.at/at.gv.noe.geoserver/ows?service=WMS&version=1.1.1&request=GetCapabilities",
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
	["BAUSTELLENLINOGD", "Baustellen - Linien"],
	["BAUSTELLENPKTOGD", "Baustellen - Punkte"],
	["DONAUINSFLOGD", "Donauinsel - Flächen"],
	["DONAUINSPKTOGD", "Donauinsel - Punkte"],
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
	["WERBETRAEGERLINOGD", " - Linien"],
	["WERBETRAEGERPKTOGD", " - Punkte"]
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
	let title = String(rawTitle || "").trim();

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

function buildNoeWmsNames(xml) {
	const doc = parseXml(xml, "NÖ WMS");
	const result = {};

	for (const layer of topLevelWmsLayers(doc)) {
		const name = firstChildText(layer, "Name");
		if (!name) continue;

		let title = firstChildText(layer, "Title")
			.replaceAll(" in Niederösterreich", "")
			.replaceAll(" Niederösterreich", "")
			.replaceAll(" NÖ", "")
			.replaceAll("NÖ ", "")
			.replaceAll(" 1:1000", "")
			.replaceAll("Intermodales Verkehrsreferenzsystem (GIP.at)", "GIP");

		if (title.includes("lattschnitt") || title.includes(" 1:")) continue;
		result[name] = title;
	}

	if (Object.keys(result).length < 20) {
		throw new Error(`NÖ WMS: unplausibel wenige Layer: ${Object.keys(result).length}`);
	}

	return sortObject(result);
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
			cat = "Luftbilder";
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

		layers[fullName] = title;
	}

	if (!Object.keys(layers).length) {
		throw new Error(`BEV ${workspace}: keine benannten Layer.`);
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

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log("Lade öffentliche Serverkataloge ...");
const [
	wienWfsXml,
	wienWmsXml,
	laermXml,
	noeXml,
	stadtplanJson,
	arcgisJson,
	bevXml
] = await Promise.all([
	fetchText(SOURCES.wienWfs, { accept: "application/xml,text/xml,*/*;q=0.8" }),
	fetchText(SOURCES.wienWms, { accept: "application/xml,text/xml,*/*;q=0.8" }),
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
const laermkarteNames = buildWienWmsNames(laermXml, "Lärmkarte WMS");
const noeWmsNames = buildNoeWmsNames(noeXml);
const stadtplan = normalizeStadtplanThemes(stadtplanJson);
const arcgisStyles = buildArcGisStyles(arcgisJson);
const bev = await buildBevCatalog(bevXml);

writeJs("GeoserverNames.js", "GeoserverNames", geoserverNames);
writeJs("WmsNames.js", "WmsNames", wmsNames);
writeJs("LaermkarteNames.js", "LaermkarteNames", laermkarteNames);
writeJs("NoeWmsNames.js", "NoeWmsNames", noeWmsNames);
writeJs("StadtplanJson.js", "StadtplanJson", stadtplan);
writeJs("BevGeoserverNames.js", "BevGeoserverNames", bev.catalog);

fs.writeFileSync(
	new URL("./build/ArcGISStyles.js", import.meta.url),
	arcgisStyles.code,
	"utf8"
);

console.log([
	`Wien WFS: ${Object.keys(geoserverNames).length}`,
	`Wien WMS: ${Object.keys(wmsNames).length}`,
	`Lärmkarte: ${Object.keys(laermkarteNames).length}`,
	`NÖ WMS: ${Object.keys(noeWmsNames).length}`,
	`Stadtplan-Themes: ${stadtplan.themes.length}`,
	`ArcGIS Styles: ${arcgisStyles.count}`,
	`BEV: ${bev.workspaceCount} Workspaces / ${bev.layerCount} Layer`
].join("\n"));
