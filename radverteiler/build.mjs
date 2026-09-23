import fs from "node:fs";

const SOURCE_URL = "https://www.radverteiler.at/search/all";
const OUTPUT_DIR = new URL("./build/", import.meta.url);
const OUTPUT_FILE = new URL("./build/Radverteiler.geojson", import.meta.url);

async function fetchWithRetry(url, attempts = 3) {
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 30_000);

		try {
			const response = await fetch(url, {
				redirect: "follow",
				signal: controller.signal,
				headers: {
					Accept: "application/json",
					"User-Agent": "Kartensammlung Radverteiler builder"
				}
			});

			clearTimeout(timer);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} bei ${url}`);
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

function parsePointWkt(value) {
	if (typeof value !== "string") return null;

	const match = value.trim().match(
		/^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i
	);

	if (!match) return null;

	const lon = Number(match[1]);
	const lat = Number(match[2]);

	if (
		!Number.isFinite(lon) ||
		!Number.isFinite(lat) ||
		lon < -180 ||
		lon > 180 ||
		lat < -90 ||
		lat > 90
	) {
		return null;
	}

	return [lon, lat];
}

const response = await fetchWithRetry(SOURCE_URL);
const data = await response.json();

const bikesRaw = Array.isArray(data?.bikes) ? data.bikes : null;
const rentalPlaces = data?.rental_places;
const bikeImages = data?.bike_images && typeof data.bike_images === "object"
	? data.bike_images
	: {};

if (!bikesRaw) {
	throw new Error('Radverteiler: "bikes" fehlt oder ist kein Array.');
}

if (!rentalPlaces || typeof rentalPlaces !== "object" || Array.isArray(rentalPlaces)) {
	throw new Error('Radverteiler: "rental_places" fehlt oder ist kein Objekt.');
}

const bikesById = {};

for (const bike of bikesRaw) {
	if (!bike || typeof bike !== "object" || bike.id === undefined || bike.id === null) continue;
	bikesById[String(bike.id)] = bike;
}

const features = [];

for (const [bikeIdKey, places] of Object.entries(rentalPlaces)) {
	if (!Array.isArray(places)) continue;

	for (const marker of places) {
		if (!marker || typeof marker !== "object") continue;

		const coordinates = parsePointWkt(marker.geom);
		if (!coordinates) continue;

		const bikeId = marker.bike_id === undefined || marker.bike_id === null
			? String(bikeIdKey)
			: String(marker.bike_id);

		features.push({
			type: "Feature",
			id: marker.id ?? null,
			geometry: {
				type: "Point",
				coordinates
			},
			properties: {
				bike_group_id: marker.bike_group_id ?? null,
				bike_id: marker.bike_id ?? null,
				city: marker.city ?? null,
				description: marker.description ?? null,
				hide_address: marker.hide_address ?? null,
				house_number: marker.house_number ?? null,
				name: marker.name ?? null,
				postal_code: marker.postal_code ?? null,
				street_name: marker.street_name ?? null,
				layername: "Radverteiler",
				radverteiler: "true",
				img_id: bikeImages[bikeId] ?? null,
				bike: bikesById[bikeId] ?? null
			}
		});
	}
}

if (features.length < 10) {
	throw new Error(`Radverteiler: unplausibel wenige Standorte: ${features.length}`);
}

const geojson = {
	type: "FeatureCollection",
	features
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(
	OUTPUT_FILE,
	JSON.stringify(geojson) + "\n",
	"utf8"
);

console.log(
	`Radverteiler: ${features.length} Standorte, ${Object.keys(bikesById).length} Fahrräder.`
);
