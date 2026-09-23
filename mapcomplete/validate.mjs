import fs from "node:fs";
import path from "node:path";

const root = new URL("./", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL("./build/MapcompleteLayers.json", root), "utf8"));
const config = JSON.parse(fs.readFileSync(new URL("./icon-sections.json", root), "utf8"));

function fail(message) {
	throw new Error(message);
}

if (catalog?.version !== 2) {
	fail("MapComplete-Katalogversion ist nicht 2.");
}

if (catalog?.source !== "https://cache.mapcomplete.org/summary/status.json") {
	fail("MapComplete-Katalog hat eine unerwartete Quelle.");
}

if (!catalog.updatedAt || Number.isNaN(Date.parse(catalog.updatedAt))) {
	fail("MapComplete-Katalog enthält kein gültiges updatedAt.");
}

const layers = catalog?.layers;
if (!layers || typeof layers !== "object" || Array.isArray(layers)) {
	fail("MapComplete-Katalog enthält keine Layer-Tabelle.");
}

const layerIds = Object.keys(layers);
if (layerIds.length < 100) {
	fail(`Unplausibel wenige MapComplete-Layer: ${layerIds.length}`);
}

const available = new Set(layerIds);
const additional = config?.additional || {};

for (const [layerId, entry] of Object.entries(additional)) {
	if (!available.has(layerId)) {
		fail(`Zusatzlayer fehlt im MapComplete-Katalog: ${layerId}`);
	}
	if (!entry?.sec || typeof entry.sec !== "string") {
		fail(`Zusatzlayer ${layerId}: Sektion fehlt.`);
	}

	const iconUrl = layers[layerId]?.icon?.url;
	if (!iconUrl) continue;

	const prefix = "/Maps/MapComplete/Icons/";
	if (!iconUrl.startsWith(prefix)) {
		fail(`Zusatzlayer ${layerId}: unerwartete Icon-URL ${iconUrl}`);
	}

	const fileName = path.basename(iconUrl);
	const localIcon = new URL(`./build/Icons/${fileName}`, root);
	if (!fs.existsSync(localIcon)) {
		fail(`Zusatzlayer ${layerId}: erzeugtes Icon fehlt lokal: ${fileName}`);
	}
}

console.log(
	`MapComplete-Katalog gültig: ${layerIds.length} Layer, ` +
	`${Object.keys(additional).length} Zusatzlayer mit lokaler Icon-Konfiguration.`
);
