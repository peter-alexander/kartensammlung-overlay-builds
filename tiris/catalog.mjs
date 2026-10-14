// Öffentliche tiris-MapServices: https://storymaps.arcgis.com/stories/2682072207814667bebceac30c3b5a20
const ROOT = "https://gis.tirol.gv.at/arcgis/rest/services/Service_Public";
export const TIRIS_SERVICES = Object.freeze([
	["ogd_agrar", "Landwirtschaft"],
	["ogd_basis", "Basis & Verwaltung"],
	["ogd_bildung", "Bildung"],
	["euregio", "Euregio"],
	["ogd_infrastruktur", "Verkehr & Infrastruktur"],
	["klims_map", "Klima"],
	["ogd_natur", "Natur & Schutzgebiete"],
	["ogd_naturgefahren", "Naturgefahren"],
	["ogd_raumordnung", "Raumordnung"],
	["ogd_sport", "Sport & Freizeit"],
	["ogd_umwelt", "Umwelt"],
	["ogd_wald", "Wald"],
	["ogd_wasser", "Wasser"]
].map(([id, title]) => Object.freeze({
	id,
	title,
	url: `${ROOT}/${id}/MapServer`
})));

function layerPath(layer, index) {
	const parents = [];
	const visited = new Set([layer.id]);
	let current = layer;

	while (Number.isInteger(current?.parentLayerId) && current.parentLayerId >= 0) {
		if (visited.has(current.parentLayerId)) {
			throw new Error(`Zyklische tiris-Layerhierarchie bei ${layer.id}`);
		}
		visited.add(current.parentLayerId);
		current = index.get(current.parentLayerId);
		if (!current) throw new Error(`Fehlender tiris-Elternlayer bei ${layer.id}`);
		parents.unshift(String(current.name || "").trim());
	}
	return parents.filter(Boolean);
}

export function normalizeTirisService(descriptor, data) {
	if (data?.error || !Array.isArray(data?.layers)) {
		throw new Error(`tiris ${descriptor.id}: fehlende oder fehlerhafte Layerliste`);
	}
	if (data.capabilities && !String(data.capabilities).split(",").map(x => x.trim()).includes("Map")) {
		throw new Error(`tiris ${descriptor.id}: Map-Capability fehlt`);
	}

	const byId = new Map(data.layers.map(layer => [layer.id, layer]));
	const layers = [];
	for (const layer of data.layers) {
		if (!Number.isInteger(layer?.id) || layer.id < 0) continue;
		if (Array.isArray(layer.subLayerIds) && layer.subLayerIds.length > 0) continue;
		if (!String(layer.name || "").trim()) continue;
		layers.push({
			id: layer.id,
			name: String(layer.name).trim(),
			path: layerPath(layer, byId),
			type: String(layer.type || ""),
			minScale: Number(layer.minScale) || 0,
			maxScale: Number(layer.maxScale) || 0
		});
	}

	if (!layers.length) throw new Error(`tiris ${descriptor.id}: kein darstellbarer Layer`);
	layers.sort((a, b) => a.id - b.id);
	return {
		id: descriptor.id,
		title: descriptor.title,
		url: descriptor.url,
		layers
	};
}

export function buildTirisCatalog(results) {
	if (!Array.isArray(results) || results.length !== TIRIS_SERVICES.length) {
		throw new Error("tiris: unvollständige Dienstabfrage; kein Katalog-Update");
	}
	const services = {};
	for (const service of results) {
		if (!service?.id || services[service.id]) throw new Error("tiris: ungültige oder doppelte Dienst-ID");
		services[service.id] = service;
	}
	for (const descriptor of TIRIS_SERVICES) {
		if (!services[descriptor.id]) throw new Error(`tiris: Dienst ${descriptor.id} fehlt`);
	}
	return {
		version: 1,
		attribution: "Datenquelle: Land Tirol - data.tirol.gv.at",
		services
	};
}
