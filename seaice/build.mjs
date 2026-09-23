import fs from "node:fs";
import { DOMParser } from "@xmldom/xmldom";

const SOURCE_URL = "https://wmts.marine.copernicus.eu/teroWmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0";
const OUTPUT_DIR = new URL("./build/", import.meta.url);
const OUTPUT_FILE = new URL("./build/SeaIceCapabilities.json", import.meta.url);

const WANTED = Object.freeze([
	"SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001/osisaf_obs-si_glo_phy-sic-north_nrt_amsr2_l4_P1D-m_202304/ice_conc",
	"SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001/osisaf_obs-si_glo_phy-sic-south_nrt_amsr2_l4_P1D-m_202304/ice_conc",
	"SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001/osisaf_obs-si_glo_phy-sic-north_nrt_ssmis_l4_P1D-m_202304/ice_conc",
	"SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001/osisaf_obs-si_glo_phy-sic-south_nrt_ssmis_l4_P1D-m_202304/ice_conc",
	"SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001/osisaf_obs-si_glo_phy-siedge_nrt_nh-P1D_202107/ice_edge",
	"SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001/osisaf_obs-si_glo_phy-siedge_nrt_sh-P1D_202107/ice_edge",
	"SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001/osisaf_obs-si_glo_phy-sitype_nrt_nh-P1D_202107/ice_type",
	"SEAICE_GLO_SEAICE_L4_NRT_OBSERVATIONS_011_001/osisaf_obs-si_glo_phy-sitype_nrt_sh-P1D_202107/ice_type"
]);

async function fetchWithRetry(url, attempts = 3) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 90_000);

		try {
			const response = await fetch(url, {
				redirect: "follow",
				signal: controller.signal,
				headers: {
					Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
					"User-Agent": "Kartensammlung Sea-Ice capabilities builder"
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
				await new Promise((resolve) => setTimeout(resolve, attempt * 3_000));
			}
		}
	}

	throw lastError;
}

function children(element, localName) {
	const result = [];

	for (let node = element?.firstChild; node; node = node.nextSibling) {
		if (
			node.nodeType === 1 &&
			String(node.localName || node.nodeName).toLowerCase() === localName.toLowerCase()
		) {
			result.push(node);
		}
	}

	return result;
}

function childText(element, localName) {
	return String(children(element, localName)[0]?.textContent || "").trim();
}

function allElements(doc, localName) {
	const result = [];
	const nodes = doc.getElementsByTagName("*");

	for (let index = 0; index < nodes.length; index++) {
		const node = nodes.item(index);

		if (
			node &&
			String(node.localName || node.nodeName).toLowerCase() === localName.toLowerCase()
		) {
			result.push(node);
		}
	}

	return result;
}

const response = await fetchWithRetry(SOURCE_URL);
const xml = await response.text();

if (xml.length < 1000 || xml.length > 100 * 1024 * 1024) {
	throw new Error(`Unerwartete Capabilities-Größe: ${xml.length} Bytes.`);
}

const errors = [];
const doc = new DOMParser({
	errorHandler: {
		warning: () => {},
		error: (message) => errors.push(message),
		fatalError: (message) => errors.push(message)
	}
}).parseFromString(xml, "application/xml");

if (!doc?.documentElement || errors.length) {
	throw new Error(`Ungültiges Capabilities-XML: ${errors.join("; ")}`);
}

const wanted = new Set(WANTED);
const layers = {};

for (const layer of allElements(doc, "Layer")) {
	const identifier = childText(layer, "Identifier");
	if (!wanted.has(identifier)) continue;

	const dimensions = children(layer, "Dimension");
	const timeDimension = dimensions.find(
		(dimension) => childText(dimension, "Identifier").toLowerCase() === "time"
	);

	if (!timeDimension) continue;

	const values = children(timeDimension, "Value")
		.map((node) => String(node.textContent || "").trim())
		.filter(Boolean);

	if (!values.length) continue;

	layers[identifier] = {
		default: childText(timeDimension, "Default") || null,
		values
	};
}

const missing = WANTED.filter((identifier) => !layers[identifier]);
if (missing.length) {
	throw new Error(`Fehlende erwartete Meereis-Layer: ${missing.join(", ")}`);
}

const payload = {
	source: "Copernicus Marine WMTS GetCapabilities",
	fetched_at: new Date().toISOString(),
	layers
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
	OUTPUT_FILE,
	JSON.stringify(payload) + "\n",
	"utf8"
);

console.log(`Sea-Ice: ${Object.keys(layers).length} Layer aktualisiert.`);
