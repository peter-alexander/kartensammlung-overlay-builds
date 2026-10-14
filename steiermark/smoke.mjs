import fs from "node:fs";

const catalog = JSON.parse(fs.readFileSync(new URL("./build/SteiermarkCatalog.json", import.meta.url)));
const service = catalog.services.als_schummerung || catalog.services.geologie_steiermark;
if (!service?.layers?.length) throw new Error("Steiermark smoke: geeigneter Fachdienst fehlt");

const x = 15.44 * Math.PI / 180 * 6378137;
const y = Math.log(Math.tan(Math.PI / 4 + 47.07 * Math.PI / 360)) * 6378137;
const bbox = [x - 1000, y - 1000, x + 1000, y + 1000].join(",");
const url = `${service.url}/export?f=image&format=png32&transparent=true&bboxSR=3857&imageSR=3857&size=256%2C256&dpi=96&layers=show%3A${service.layers[0].id}&bbox=${bbox}`;

const response = await fetch(url, { headers: { Origin: "https://fahrrad.lima-city.de" }, signal: AbortSignal.timeout(25000) });
const data = new Uint8Array(await response.arrayBuffer());
const png = data.length > 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71;
console.log(`Steiermark MapServer smoke: ${service.id}, HTTP ${response.status}, ${data.length} Bytes, CORS=${response.headers.get("access-control-allow-origin") || "(none)"}`);
if (!response.ok || !png) throw new Error("Steiermark MapServer export lieferte kein PNG");
