import fs from "node:fs";
const catalog = JSON.parse(fs.readFileSync(new URL("./build/VogisCatalog.json", import.meta.url), "utf8"));
// One 256px request per service, not a tile crawl. Checks actual WMS GetMap rendering.
const longitude = 9.74, latitude = 47.42, zoom = 12, n = 2 ** zoom;
const x = Math.floor((longitude + 180) / 360 * n);
const latRad = latitude * Math.PI / 180;
const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) * n / 2);
const world = 20037508.342789244;
const west = x / n * 2 * world - world;
const east = (x + 1) / n * 2 * world - world;
const north = world - y / n * 2 * world;
const south = world - (y + 1) / n * 2 * world;
const bbox = [west, south, east, north].join(",");
for (const [id, service] of Object.entries(catalog.services)) {
	const layer = id === "themen"
		? service.layers.find(l => /adressen|gemeinden/.test(l.id)) || service.layers[0]
		: service.layers.find(l => l.id !== "MS" && (/ef2022/.test(l.id) || /topokarte/.test(l.id)))
			|| service.layers.find(l => l.id !== "MS");
	const params = new URLSearchParams({
		service: "WMS", request: "GetMap", version: "1.3.0",
		layers: layer.id, styles: "", format: service.format,
		transparent: "TRUE", crs: "EPSG:3857",
		bbox, width: "256", height: "256"
	});
	const endpoint = service.url + (service.url.includes("?") ? "&" : "?") + params.toString();
	const response = await fetch(endpoint, {signal: AbortSignal.timeout(25000)});
	const image = new Uint8Array(await response.arrayBuffer());
	const png = image.length >= 8 && [137,80,78,71,13,10,26,10].every((b, i) => image[i] === b);
	const jpeg = image.length >= 3 && image[0] === 255 && image[1] === 216 && image[2] === 255;
	console.log(`VoGIS WMS GetMap ${id} (${layer.id}): HTTP ${response.status}, ${image.length} Bytes, ${response.headers.get("content-type")}, CORS=${response.headers.get("access-control-allow-origin") || "(none)"}`);
	if (!response.ok || (!png && !jpeg)) {
		const hint = new TextDecoder().decode(image.slice(0,250));
		throw new Error(`VoGIS ${id}: GetMap lieferte kein Bild: ${hint}`);
	}
}
