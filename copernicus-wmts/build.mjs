import fs from "node:fs";
import { parseCopernicusCapabilities } from "./lib.mjs";

const instanceId = String(process.env.COPERNICUS_INSTANCE_ID || "").trim();

if (!instanceId) {
	throw new Error("COPERNICUS_INSTANCE_ID fehlt.");
}

const outputDir = new URL("./build/", import.meta.url);
const jsonFile = new URL("./build/CopernicusWmtsCatalog.json", import.meta.url);
const jsFile = new URL("./build/CopernicusWmtsCatalog.js", import.meta.url);

async function fetchWithRetry(attempts = 3) {
	let lastError = null;
	const url = `https://sh.dataspace.copernicus.eu/ogc/wmts/${encodeURIComponent(instanceId)}?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0`;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 45_000);

		try {
			const response = await fetch(url, {
				redirect: "follow",
				signal: controller.signal,
				headers: {
					Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
					"User-Agent": "Kartensammlung Copernicus WMTS catalog builder"
				}
			});

			clearTimeout(timer);

			if (!response.ok) {
				throw new Error(`Copernicus WMTS antwortete mit HTTP ${response.status}.`);
			}

			return await response.text();
		} catch (error) {
			clearTimeout(timer);
			lastError = error;

			if (attempt < attempts) {
				await new Promise((resolve) => setTimeout(resolve, attempt * 3_000));
			}
		}
	}

	throw lastError;
}

const xml = await fetchWithRetry();

if (xml.length < 1000) {
	throw new Error(`Copernicus WMTS: unplausibel kleine Antwort (${xml.length} Bytes).`);
}

const catalog = parseCopernicusCapabilities(xml);

if (catalog.meta.count < 1) {
	throw new Error("Copernicus WMTS: keine Layer gefunden.");
}

if (!catalog.layers.cop_true_color) {
	throw new Error("Copernicus WMTS: erwarteter Layer cop_true_color fehlt.");
}

if (catalog.meta.tileMatrixSetCount < 1) {
	throw new Error("Copernicus WMTS: keine TileMatrixSets gefunden.");
}

fs.mkdirSync(outputDir, { recursive: true });

const json = JSON.stringify(catalog);
fs.writeFileSync(jsonFile, json + "\n", "utf8");
fs.writeFileSync(
	jsFile,
	`window.CopernicusWmtsCatalog = ${json};\n`,
	"utf8"
);

console.log(
	`Copernicus WMTS: ${catalog.meta.count} Layer / ${catalog.meta.tileMatrixSetCount} TileMatrixSets.`
);
