import fs from "node:fs";

const SOURCE_URL = "https://www.foto-webcam.eu/webcam/include/metadata.php?center=&wc=include&callback=ksFotoWebcamMetadata";
const OUTPUT_DIR = new URL("./build/", import.meta.url);
const OUTPUT_FILE = new URL("./build/FotoWebcam.geojson", import.meta.url);

async function fetchWithRetry(url, attempts = 3) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 30_000);

		try {
			const sourceUrl = new URL(url);
			sourceUrl.searchParams.set("_", String(Date.now()));

			const response = await fetch(sourceUrl, {
				redirect: "follow",
				signal: controller.signal,
				headers: {
					Accept: "application/javascript, application/json, text/javascript, */*;q=0.8",
					"User-Agent": "Kartensammlung Foto-Webcam builder"
				}
			});

			clearTimeout(timer);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} bei ${sourceUrl}`);
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

function parseJsonp(jsonp) {
	const trimmed = String(jsonp).trim();
	const start = trimmed.indexOf("(");
	const end = trimmed.lastIndexOf(")");

	if (start < 0 || end <= start) {
		throw new Error("JSONP-Antwort hat kein erwartetes Format.");
	}

	return JSON.parse(trimmed.slice(start + 1, end));
}

function cleanString(value) {
	return String(value ?? "").trim();
}

function numericOrNull(value) {
	if (value === null || value === undefined || value === "") return null;

	const number = Number(value);
	if (!Number.isFinite(number)) return null;

	return Number.isInteger(number) ? number : number;
}

function normalizeUrl(url, localFallback = "") {
	const value = cleanString(url) || cleanString(localFallback);

	if (!value) return "";
	if (value.startsWith("https://www.foto-webcam.eu/")) return value;
	if (value.startsWith("/")) return "https://www.foto-webcam.eu" + value;

	return "";
}

const response = await fetchWithRetry(SOURCE_URL);
const data = parseJsonp(await response.text());
const cams = Array.isArray(data?.cams) ? data.cams : [];
const features = [];

for (const cam of cams) {
	if (!cam || typeof cam !== "object") continue;
	if (cam.hidden || cam.offline) continue;

	const lon = Number(cam.longitude);
	const lat = Number(cam.latitude);

	if (
		!Number.isFinite(lon) ||
		!Number.isFinite(lat) ||
		lon < -180 ||
		lon > 180 ||
		lat < -90 ||
		lat > 90
	) {
		continue;
	}

	const id = cleanString(cam.id);
	if (!id) continue;

	const properties = {
		layername: "Foto-Webcam.eu",
		id,
		name: cleanString(cam.name),
		title: cleanString(cam.title),
		country: cleanString(cam.country),
		elevation: numericOrNull(cam.elevation),
		direction: numericOrNull(cam.direction),
		focalLen: numericOrNull(cam.focalLen),
		radius_km: numericOrNull(cam.radius_km),
		sector: numericOrNull(cam.sector),
		captureInterval: numericOrNull(cam.captureInterval),
		modtime: numericOrNull(cam.modtime),
		imgurl: normalizeUrl(cam.imgurl),
		link: normalizeUrl(cam.link, cam.localLink)
	};

	for (const [key, value] of Object.entries(properties)) {
		if (value === null || value === "") delete properties[key];
	}

	features.push({
		type: "Feature",
		id,
		geometry: {
			type: "Point",
			coordinates: [lon, lat]
		},
		properties
	});
}

if (features.length < 20) {
	throw new Error(`Unplausibel wenige aktive Foto-Webcams: ${features.length}`);
}

const geojson = {
	type: "FeatureCollection",
	features,
	properties: {
		source: "foto-webcam.eu",
		sourceUrl: "https://www.foto-webcam.eu/webcam/map/",
		generated: new Date().toISOString(),
		count: features.length
	}
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
	OUTPUT_FILE,
	JSON.stringify(geojson) + "\n",
	"utf8"
);

console.log(`Foto-Webcam: ${features.length} aktive Kameras.`);
