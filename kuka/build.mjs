import fs from "node:fs";
import path from "node:path";

const MARKERS_URL = "https://www.radkummerkasten.at/ajax/?map&action=getMapMarkers";
const ENTRY_URL = "https://www.radkummerkasten.at/ajax/?map&action=getMapEntry";
const CACHE_URL = process.env.KUKA_CACHE_URL || "https://fahrrad.lima-city.de/Maps/Kuka_Entries.json";
const BUILD_DIR = new URL("./build/", import.meta.url);
const OUTPUT_FILE = new URL("./build/Kuka_Entries.json", import.meta.url);
const CHANGED_FILE = new URL("./build/changed", import.meta.url);

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
					Accept: "application/json, text/plain, */*",
					"User-Agent": "Kartensammlung Kuka title cache"
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

async function fetchJson(url) {
	const response = await fetchWithRetry(url);
	return response.json();
}

function normalizeCache(data) {
	if (!data || Array.isArray(data) || typeof data !== "object") {
		throw new Error("Bestehende Kuka_Entries.json ist kein JSON-Objekt.");
	}

	const cache = {};

	for (const [id, title] of Object.entries(data)) {
		if (!/^\d+$/.test(id) || typeof title !== "string") continue;

		const trimmed = title.trim();
		if (trimmed) cache[String(Number(id))] = trimmed;
	}

	if (Object.keys(cache).length === 0) {
		throw new Error("Bestehende Kuka_Entries.json enthält keine gültigen Einträge.");
	}

	return cache;
}

function collectMarkerIds(node, ids) {
	if (!node || typeof node !== "object") return;

	if (!Array.isArray(node) && Object.hasOwn(node, "id")) {
		const id = Number(node.id);
		if (Number.isInteger(id) && id >= 0) ids.add(id);
	}

	for (const value of Object.values(node)) {
		if (value && typeof value === "object") {
			collectMarkerIds(value, ids);
		}
	}
}

function extractMarkerIds(markersResponse) {
	const ids = new Set();
	collectMarkerIds(markersResponse?.markers ?? markersResponse, ids);
	return [...ids].sort((a, b) => a - b);
}

async function fetchEntryTitle(id) {
	const url = new URL(ENTRY_URL);
	url.searchParams.set("map", "");
	url.searchParams.set("action", "getMapEntry");
	url.searchParams.set("marker", String(id));
	url.searchParams.set("random", String(Date.now()));

	const data = await fetchJson(url);

	if (data?.status !== "success") return null;
	if (typeof data.title !== "string") return null;

	const title = data.title.trim();
	return title || null;
}

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.rmSync(CHANGED_FILE, { force: true });

console.log(`Lade bestehenden Cache: ${CACHE_URL}`);
const cache = normalizeCache(await fetchJson(CACHE_URL));
console.log(`Bestehende Titel: ${Object.keys(cache).length}`);

console.log("Lade Markerliste ...");
const markerIds = extractMarkerIds(await fetchJson(MARKERS_URL));

if (markerIds.length === 0) {
	throw new Error("Radkummerkasten lieferte keine Marker-IDs.");
}

console.log(`Marker gefunden: ${markerIds.length}`);

const missingIds = markerIds.filter((id) => !cache[String(id)]);
console.log(`Noch fehlende Titel: ${missingIds.length}`);

let newCount = 0;
let errorCount = 0;

for (const id of missingIds) {
	try {
		const title = await fetchEntryTitle(id);

		if (!title) {
			errorCount++;
			console.warn(`Kein Titel für Marker ${id} erhalten.`);
			continue;
		}

		cache[String(id)] = title;
		newCount++;
		console.log(`Gespeichert: ${id} => ${title}`);
	} catch (error) {
		errorCount++;
		console.warn(`Fehler bei Marker ${id}: ${error.message}`);
	}
}

const sortedCache = Object.fromEntries(
	Object.entries(cache).sort(([a], [b]) => Number(a) - Number(b))
);

fs.writeFileSync(
	OUTPUT_FILE,
	JSON.stringify(sortedCache, null, "\t") + "\n",
	"utf8"
);

if (newCount > 0) {
	fs.writeFileSync(CHANGED_FILE, `${newCount}\n`, "utf8");
}

console.log(
	`Fertig. Neue Einträge: ${newCount}, Fehler: ${errorCount}, Gesamtcache: ${Object.keys(sortedCache).length}`
);
