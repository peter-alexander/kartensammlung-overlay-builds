import fs from "node:fs";

const SOURCE_URL = "https://www.statistik.at/gs-atlas/ATLAS_UNFALL_WFS/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=ATLAS_UNFALL_WFS:unfall_year&maxFeatures=50&outputFormat=application/json";
const OUTPUT_DIR = new URL("./build/", import.meta.url);
const OUTPUT_FILE = new URL("./build/VuYears.js", import.meta.url);

async function fetchWithRetry(url, attempts = 3) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 30_000);

		try {
			const response = await fetch(url, {
				redirect: "follow",
				signal: controller.signal,
				headers: {
					Accept: "application/json",
					"User-Agent": "Kartensammlung Verkehrsunfallkarte year builder"
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

const response = await fetchWithRetry(SOURCE_URL);
const data = await response.json();

if (!Array.isArray(data?.features)) {
	throw new Error("Statistik-Austria-Antwort enthält keine Featureliste.");
}

const years = [...new Set(
	data.features
		.map((feature) => Number(feature?.properties?.P_YEAR))
		.filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100)
)].sort((a, b) => a - b);

if (years.length < 10 || !years.includes(2013) || Math.max(...years) < 2024) {
	throw new Error(`Unplausible Jahresliste: ${JSON.stringify(years)}`);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
	OUTPUT_FILE,
	`var VuYears = window.VuYears = ${JSON.stringify(years)};\n`,
	"utf8"
);

console.log(`Verkehrsunfallkarte: ${years.length} Jahre, ${years[0]}–${years.at(-1)}.`);
