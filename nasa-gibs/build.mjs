import fs from "node:fs";
import { DOMParser } from "@xmldom/xmldom";

const CAPABILITIES_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml";
const METADATA_BASE_URL = "https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/";
const OUTPUT_DIR = new URL("./build/", import.meta.url);
const OUTPUT_FILE = new URL("./build/NasaGibsLayerCatalog.min.json", import.meta.url);

const WMTS_NS = "http://www.opengis.net/wmts/1.0";
const OWS_NS = "http://www.opengis.net/ows/1.1";
const XLINK_NS = "http://www.w3.org/1999/xlink";

async function fetchWithRetry(url, attempts = 3, timeoutMs = 45_000) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(url, {
				redirect: "follow",
				signal: controller.signal,
				headers: {
					Accept: "application/json, application/xml, text/xml, */*",
					"User-Agent": "Kartensammlung NASA GIBS catalog builder"
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

function firstText(element, namespace, localName) {
	const nodes = element.getElementsByTagNameNS(namespace, localName);
	return nodes.length ? String(nodes.item(0)?.textContent || "").trim() : "";
}

function rasterFormat(layer) {
	const formats = [...layer.getElementsByTagNameNS(WMTS_NS, "Format")]
		.map((node) => String(node.textContent || "").trim());

	if (formats.includes("image/png")) return "png";
	if (formats.includes("image/jpeg") || formats.includes("image/jpg")) return "jpg";
	return null;
}

function legends(layer) {
	const result = {
		h: "",
		v: ""
	};

	for (const node of [...layer.getElementsByTagNameNS(WMTS_NS, "LegendURL")]) {
		const role = node.getAttributeNS(XLINK_NS, "role") || "";
		const href = node.getAttributeNS(XLINK_NS, "href") || "";

		if (!href) continue;
		if (role.includes("/horizontal")) result.h = href;
		if (role.includes("/vertical")) result.v = href;
	}

	return result;
}

function maxZoom(tileMatrixSet) {
	const match = String(tileMatrixSet).match(/_Level(\d+)$/);
	return match ? Number(match[1]) : null;
}

function parseCapabilities(xml) {
	const doc = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: (message) => {
				throw new Error(`Capabilities XML: ${message}`);
			},
			fatalError: (message) => {
				throw new Error(`Capabilities XML: ${message}`);
			}
		}
	}).parseFromString(xml, "application/xml");

	const layers = [];

	for (const layer of [...doc.getElementsByTagNameNS(WMTS_NS, "Layer")]) {
		const key = firstText(layer, OWS_NS, "Identifier");
		const title = firstText(layer, OWS_NS, "Title");
		const tileMatrixSet = firstText(layer, WMTS_NS, "TileMatrixSet");
		const format = rasterFormat(layer);

		if (!key || !tileMatrixSet || !format) continue;

		const legend = legends(layer);

		layers.push({
			key,
			title,
			format,
			tileMatrixSet,
			maxZoom: maxZoom(tileMatrixSet),
			legendH: legend.h,
			legendV: legend.v
		});
	}

	return layers;
}

async function fetchMetadata(layer) {
	const url = METADATA_BASE_URL + encodeURIComponent(layer.key) + ".json";

	try {
		const response = await fetchWithRetry(url, 2, 30_000);
		const data = await response.json();

		return {
			ok: true,
			data: {
				title: typeof data?.title === "string" ? data.title : "",
				subtitle: typeof data?.subtitle === "string" ? data.subtitle : "",
				measurement: typeof data?.measurement === "string" ? data.measurement : "",
				layerPeriod: typeof data?.layerPeriod === "string" ? data.layerPeriod : ""
			}
		};
	} catch (error) {
		console.warn(`Metadaten nicht verfügbar: ${layer.key}: ${error.message}`);

		return {
			ok: false,
			data: {
				title: "",
				subtitle: "",
				measurement: "",
				layerPeriod: ""
			}
		};
	}
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

console.log("Lade NASA-GIBS-WMTS-Capabilities ...");
const capabilitiesResponse = await fetchWithRetry(CAPABILITIES_URL);
const capabilitiesXml = await capabilitiesResponse.text();
const layers = parseCapabilities(capabilitiesXml);

if (layers.length < 50) {
	throw new Error(`Unplausibel wenige Raster-Layer in den Capabilities: ${layers.length}`);
}

console.log(`Raster-Layer gefunden: ${layers.length}`);
console.log("Lade Layer-Metadaten ...");

let processed = 0;
const metadataResults = await mapConcurrent(layers, 10, async (layer) => {
	const result = await fetchMetadata(layer);
	processed++;

	if (processed % 50 === 0 || processed === layers.length) {
		console.log(`Metadaten: ${processed}/${layers.length}`);
	}

	return result;
});

const failedMetadata = metadataResults.filter((result) => !result.ok).length;

if (failedMetadata > Math.max(20, Math.floor(layers.length * 0.25))) {
	throw new Error(
		`Zu viele fehlgeschlagene Metadatenabrufe: ${failedMetadata}/${layers.length}. Kein Deploy.`
	);
}

const catalog = layers.map((layer, index) => {
	const meta = metadataResults[index].data;
	const name = meta.title.trim() || layer.title;

	return {
		key: layer.key,
		name,
		group: meta.measurement.trim(),
		subtitle: meta.subtitle.trim(),
		period: meta.layerPeriod.trim(),
		format: layer.format,
		tileMatrixSet: layer.tileMatrixSet,
		maxZoom: layer.maxZoom,
		legendH: layer.legendH,
		legendV: layer.legendV
	};
});

catalog.sort((a, b) => {
	const groupCompare = a.group.toLocaleLowerCase("de").localeCompare(
		b.group.toLocaleLowerCase("de"),
		"de"
	);

	if (groupCompare !== 0) return groupCompare;

	return a.name.toLocaleLowerCase("de").localeCompare(
		b.name.toLocaleLowerCase("de"),
		"de"
	);
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
	OUTPUT_FILE,
	JSON.stringify(catalog),
	"utf8"
);

console.log(
	`Fertig: ${catalog.length} Katalogeinträge, ${failedMetadata} Metadatenabrufe mit Fallback.`
);
