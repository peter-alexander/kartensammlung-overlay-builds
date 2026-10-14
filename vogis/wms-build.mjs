import fs from "node:fs";
import { VOGIS_SERVICES, buildVogisCatalog } from "./wms-lib.mjs";

const fetched = {};
for (const service of VOGIS_SERVICES) {
	const glue = service.url.includes("?") ? "&" : "?";
	const endpoint = `${service.url}${glue}SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`;
	console.log(`VoGIS: Lade Capabilities ${service.id} …`);
	const response = await fetch(endpoint, {
		headers: { Accept: "application/xml,text/xml,*/*" },
		signal: AbortSignal.timeout(60000)
	});
	if (!response.ok) throw new Error(`VoGIS ${service.id}: HTTP ${response.status}`);
	const body = await response.text();
	if (body.length > 25_000_000) throw new Error(`VoGIS ${service.id}: Capabilities zu groß`);
	fetched[service.id] = body;
	console.log(`VoGIS: ${service.id} ${body.length} Zeichen, Content-Type ${response.headers.get("content-type")}`);
}
const catalog = buildVogisCatalog(fetched);
fs.mkdirSync(new URL("./build/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("./build/VogisCatalog.json", import.meta.url),
	JSON.stringify(catalog) + "\n");
for (const service of Object.values(catalog.services)) {
	console.log(`VoGIS ${service.id}: ${service.layers.length} Ebenen (${service.format})`);
	console.log("  erste:", service.layers.slice(0, 10).map(l => `${l.id}: ${l.name}`).join(" | "));
}
