import fs from "node:fs";
import { IMAGERY_DIRECTORY, discoverSteiermarkImagery, buildSteiermarkImageryCatalog } from "./imagery-catalog.mjs";

const output = new URL("./build/SteiermarkImagery.json", import.meta.url);
async function load(url) {
	let lastError;
	for (let i = 0; i < 2; i++) {
		try {
			const response = await fetch(`${url}?f=pjson`, {
				headers: { Accept: "application/json", "User-Agent": "Kartensammlung Steiermark imagery builder" },
				signal: AbortSignal.timeout(25000)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			if (data?.error) throw new Error(data.error.message || "ImageServer error");
			return data;
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error(`${url}: ${lastError?.message || lastError}`);
}

const services = discoverSteiermarkImagery(await load(IMAGERY_DIRECTORY));
const results = [];
for (const service of services) {
	results.push(await load(service.url));
	console.log(`Steiermark Bilddienst: ${service.id} (${service.category})`);
}
const catalog = buildSteiermarkImageryCatalog(services, results);
fs.mkdirSync(new URL("./build/", import.meta.url), { recursive: true });
fs.writeFileSync(output, JSON.stringify(catalog) + "\n", "utf8");
console.log(`Steiermark Bilddienste: ${services.length} ImageServer`);
