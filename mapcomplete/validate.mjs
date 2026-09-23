import fs from "node:fs";
import path from "node:path";

const root = new URL("./", import.meta.url);
const catalog = JSON.parse(fs.readFileSync(new URL("./build/MapcompleteLayers.json", root), "utf8"));
const mapping = JSON.parse(fs.readFileSync(new URL("./input/MapcompleteMapping.json", root), "utf8"));

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
const accounted = new Set();

for (const [overlayKey, config] of Object.entries(mapping.overrides || {})) {
	if (!Array.isArray(config?.layerIds) || config.layerIds.length === 0) {
		fail(`Mapping ${overlayKey}: layerIds fehlt oder ist leer.`);
	}

	for (const layerId of config.layerIds) {
		if (!available.has(layerId)) {
			fail(`Mapping ${overlayKey}: unbekannter MapComplete-Layer ${layerId}`);
		}
		accounted.add(layerId);
	}
}

for (const [layerId, config] of Object.entries(mapping.additional || {})) {
	if (!available.has(layerId)) {
		fail(`Zusatzlayer fehlt im MapComplete-Katalog: ${layerId}`);
	}
	if (!config?.sec || typeof config.sec !== "string") {
		fail(`Zusatzlayer ${layerId}: Sektion fehlt.`);
	}
	accounted.add(layerId);

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

for (const [layerId, reason] of Object.entries(mapping.excluded || {})) {
	if (!available.has(layerId)) {
		fail(`Ausgeschlossener Layer fehlt im MapComplete-Katalog: ${layerId}`);
	}
	if (!reason || typeof reason !== "string") {
		fail(`Ausschlussbegründung fehlt: ${layerId}`);
	}
	accounted.add(layerId);
}

const unassigned = layerIds.filter((layerId) => !accounted.has(layerId)).sort();
if (unassigned.length) {
	fail(`Nicht zugeordnete MapComplete-Layer: ${unassigned.join(", ")}`);
}

console.log(
	`MapComplete-Katalog gültig: ${layerIds.length} Layer, ` +
	`${Object.keys(mapping.overrides || {}).length} Ersetzungen, ` +
	`${Object.keys(mapping.additional || {}).length} Zusatzlayer, ` +
	`${Object.keys(mapping.excluded || {}).length} Ausschlüsse.`
);
