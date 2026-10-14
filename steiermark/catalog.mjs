// Nur die vom Land als OGD veröffentlichten ArcGIS-MapServer-Dienste.
export const OGD_DIRECTORY = "https://gis.stmk.gv.at/arcgis/rest/services/OGD";
const ROOT = "https://gis.stmk.gv.at/arcgis/rest/services/";

function slug(value) {
	return String(value).toLowerCase()
		.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
		.replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

export function discoverSteiermarkServices(directory) {
	if (directory?.error || !Array.isArray(directory?.services)) {
		throw new Error("Steiermark: ungültiges OGD-Dienstverzeichnis");
	}
	const descriptors = [];
	const ids = new Set();
	for (const entry of directory.services) {
		if (entry?.type !== "MapServer" || !/^OGD\/[a-z0-9_ -]+$/i.test(entry.name || "")) continue;
		const name = entry.name.slice(4);
		const id = slug(name);
		if (!id || ids.has(id)) throw new Error("Steiermark: doppelte oder ungültige Dienst-ID");
		ids.add(id);
		descriptors.push({
			id,
			title: name.replaceAll("_", " ").trim(),
			url: `${ROOT}${encodeURIComponent("OGD")}/${encodeURIComponent(name)}/MapServer`
		});
	}
	if (!descriptors.length) throw new Error("Steiermark: keine öffentlichen OGD-MapServer gefunden");
	return descriptors.sort((a, b) => a.id.localeCompare(b.id));
}

function layerPath(layer, index) {
	const path = [];
	const visited = new Set([layer.id]);
	let current = layer;
	while (Number.isInteger(current?.parentLayerId) && current.parentLayerId >= 0) {
		if (visited.has(current.parentLayerId)) throw new Error("Steiermark: zyklische Layerhierarchie");
		visited.add(current.parentLayerId);
		current = index.get(current.parentLayerId);
		if (!current) throw new Error("Steiermark: fehlender Elternlayer");
		path.unshift(String(current.name || "").trim());
	}
	return path.filter(Boolean);
}

export function normalizeSteiermarkService(descriptor, data) {
	if (!descriptor?.id || !/^https:\/\/gis\.stmk\.gv\.at\/arcgis\/rest\/services\/OGD\/[a-z0-9_%.-]+\/MapServer$/i.test(descriptor.url || "")) {
		throw new Error("Steiermark: unzulässige Dienst-URL");
	}
	if (data?.error || !Array.isArray(data?.layers)) {
		throw new Error(`Steiermark ${descriptor.id}: ungültige Layerliste`);
	}
	if (data.capabilities && !String(data.capabilities).split(",").map(s => s.trim()).includes("Map")) {
		throw new Error(`Steiermark ${descriptor.id}: Map-Capability fehlt`);
	}
	const byId = new Map(data.layers.map(layer => [layer.id, layer]));
	const layers = [];
	for (const layer of data.layers) {
		if (!Number.isInteger(layer?.id) || layer.id < 0) continue;
		if (String(layer.type || "").toLowerCase().includes("group")) continue;
		if (Array.isArray(layer.subLayerIds) && layer.subLayerIds.length) continue;
		if (!String(layer.name || "").trim()) continue;
		layers.push({
			id: layer.id,
			name: String(layer.name).trim(),
			path: layerPath(layer, byId),
			minScale: Number(layer.minScale) || 0,
			maxScale: Number(layer.maxScale) || 0
		});
	}
	layers.sort((a, b) => a.id - b.id);
	return { id: descriptor.id, title: descriptor.title, url: descriptor.url, layers };
}

export function buildSteiermarkCatalog(descriptors, results) {
	if (!Array.isArray(descriptors) || !descriptors.length || !Array.isArray(results) || results.length !== descriptors.length) {
		throw new Error("Steiermark: unvollständige Dienstabfrage, Katalog nicht aktualisieren");
	}
	const services = {};
	for (let index = 0; index < descriptors.length; index++) {
		const descriptor = descriptors[index];
		const result = results[index];
		if (result?.id !== descriptor.id || result?.url !== descriptor.url || services[descriptor.id]) {
			throw new Error("Steiermark: unvollständiger oder inkonsistenter Dienstkatalog");
		}
		if (result.layers.length) services[descriptor.id] = result;
	}
	if (!Object.keys(services).length) throw new Error("Steiermark: keine darstellbaren OGD-Layer");
	return {
		version: 1,
		attribution: "Datenquelle: Land Steiermark - data.steiermark.at (CC BY 4.0)",
		services
	};
}
