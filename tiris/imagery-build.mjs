import fs from "node:fs";
import { IMAGERY_SERVICES, buildTirisImageryCatalog } from "./imagery-catalog.mjs";

async function fetchMetadata(service) {
	let cause;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const response = await fetch(`${service.url}?f=pjson`, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(30000)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const json = await response.json();
			console.log(`${service.id}: ${(json.layers || []).length} Dienstebenen`);
			for (const layer of json.layers || []) {
				console.log(`  raw [${layer.id}] parent=${layer.parentLayerId}: ${layer.name}`);
			}
			return json;
		} catch (error) {
			cause = error;
		}
	}
	throw new Error(`tiris ${service.id}: ${cause?.message || cause}`);
}

const responses = [];
// Requests stay sequential: this is a metadata build, not a tile crawler.
for (const service of IMAGERY_SERVICES) {
	responses.push(await fetchMetadata(service));
}
const catalog = buildTirisImageryCatalog(responses);
fs.mkdirSync(new URL("./build/", import.meta.url), { recursive: true });
fs.writeFileSync(
	new URL("./build/TirisImagery.json", import.meta.url),
	JSON.stringify(catalog) + "\n",
	"utf8"
);
for (const [id, service] of Object.entries(catalog.services)) {
	console.log(`tiris ${id}: ${service.layers.length} publizierte Layer`);
	for (const layer of service.layers) {
		console.log(`  [${layer.id}] ${layer.category}: ${[...layer.path, layer.name].join(" / ")}`);
	}
}
