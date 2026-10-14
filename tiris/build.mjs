import fs from "node:fs";
import { TIRIS_SERVICES, normalizeTirisService, buildTirisCatalog } from "./catalog.mjs";

const OUTPUT = new URL("./build/TirisCatalog.json", import.meta.url);

async function fetchService(descriptor) {
	const url = `${descriptor.url}?f=pjson`;
	let lastError;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const response = await fetch(url, {
				headers: {
					Accept: "application/json",
					"User-Agent": "Kartensammlung tiris catalog builder"
				},
				signal: AbortSignal.timeout(25_000)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			const normalized = normalizeTirisService(descriptor, data);
			console.log(`tiris ${descriptor.id}: ${normalized.layers.length} Layer`);
			return normalized;
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error(`tiris ${descriptor.id}: ${lastError?.message || lastError}`);
}

async function main() {
	// Zwei gleichzeitige REST-Metadatenabfragen genügen für den wöchentlichen Build.
	const results = [];
	for (let index = 0; index < TIRIS_SERVICES.length; index += 2) {
		const group = TIRIS_SERVICES.slice(index, index + 2);
		results.push(...await Promise.all(group.map(fetchService)));
	}
	const catalog = buildTirisCatalog(results);
	fs.mkdirSync(new URL("./build/", import.meta.url), { recursive: true });
	fs.writeFileSync(OUTPUT, JSON.stringify(catalog) + "\n", "utf8");
	console.log(`tiris: ${results.length} Dienste, ${results.reduce((n, s) => n + s.layers.length, 0)} Layer`);
}

await main();
