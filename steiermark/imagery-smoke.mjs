import fs from "node:fs";

const catalog = JSON.parse(fs.readFileSync(new URL("./build/SteiermarkImagery.json", import.meta.url)));
const service = catalog.services.find(entry => entry.id === "orthofotos_akt");
if (!service) throw new Error("Steiermark imagery smoke: aktuelles Orthofoto fehlt");

const x = 15.44 * Math.PI / 180 * 6378137;
const y = Math.log(Math.tan(Math.PI / 4 + 47.07 * Math.PI / 360)) * 6378137;
const bbox = [x - 1000, y - 1000, x + 1000, y + 1000].join(",");
const url = `${service.url}/exportImage?f=image&format=jpgpng&bboxSR=3857&imageSR=3857&size=256%2C256&bbox=${bbox}`;
const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
const data = new Uint8Array(await response.arrayBuffer());
const png = data.length > 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71;
const jpg = data.length > 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
console.log(`Steiermark ImageServer smoke: ${service.id}, HTTP ${response.status}, ${data.length} Bytes, CORS=${response.headers.get("access-control-allow-origin") || "(none)"}`);
if (!response.ok || (!png && !jpg)) throw new Error("Steiermark ImageServer exportImage lieferte kein Bild");
