import fs from "node:fs";
import { buildTirisWmtsCatalog } from "./wmts-lib.mjs";

const url = "https://wmts.kartetirol.at/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0";
const response = await fetch(url, {
	headers: { Accept: "application/xml,text/xml,*/*" },
	signal: AbortSignal.timeout(30_000)
});
if (!response.ok) throw new Error(`tiris WMTS: HTTP ${response.status}`);
const catalog = buildTirisWmtsCatalog(await response.text());
fs.mkdirSync(new URL("./build/", import.meta.url), { recursive: true });
fs.writeFileSync(
	new URL("./build/TirisWmts.json", import.meta.url),
	JSON.stringify(catalog) + "\n",
	"utf8"
);
for (const layer of catalog.layers) {
	console.log(`tiris WMTS: ${layer.id} (${layer.matrixSet}, z0–${layer.maxzoom})`);
}
