import fs from "node:fs";
import {
	OGD_DIRECTORY, discoverSteiermarkServices,
	normalizeSteiermarkService, buildSteiermarkCatalog
} from "./catalog.mjs";

const OUTPUT = new URL("./build/SteiermarkCatalog.json", import.meta.url);

async function fetchJson(url) {
	let lastError;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const response = await fetch(`${url}?f=pjson`, {
				headers: { Accept: "application/json", "User-Agent": "Kartensammlung Steiermark OGD catalog builder" },
				signal: AbortSignal.timeout(25000)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			if (data?.error) throw new Error(data.error.message || "ArcGIS service error");
			return data;
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error(`${url}: ${lastError?.message || lastError}`);
}

const directory = await fetchJson(OGD_DIRECTORY);
const descriptors = discoverSteiermarkServices(directory);
const results = [];
// Bewusst sequenziell, damit der Landes-Server keine Abfragewelle erhält.
for (const descriptor of descriptors) {
	const result = normalizeSteiermarkService(descriptor, await fetchJson(descriptor.url));
	results.push(result);
	console.log(`Steiermark ${descriptor.id}: ${result.layers.length} Layer`);
}
const catalog = buildSteiermarkCatalog(descriptors, results);
fs.mkdirSync(new URL("./build/", import.meta.url), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(catalog) + "\n", "utf8");
console.log(`Steiermark: ${Object.keys(catalog.services).length} Dienste, ${Object.values(catalog.services).reduce((sum, service) => sum + service.layers.length, 0)} Layer`);
