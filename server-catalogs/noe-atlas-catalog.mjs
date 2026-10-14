// Only public, independently licensed OGD hazard maps are eligible.
// A visible map in the NÖ Atlas is not automatically an open dataset.
const ELIGIBLE = Object.freeze({
	tc_gefahrenhinweiskarten_rutschprozesse: {
		name: "Gefahrenhinweiskarte – Rutschprozesse",
		path: "gefahrenhinweiskarten_rutschprozesse"
	},
	tc_gefahrenhinweiskarten_sturzprozesse: {
		name: "Gefahrenhinweiskarte – Sturzprozesse",
		path: "gefahrenhinweiskarten_sturzprozesse"
	}
});

export const NOE_ATLAS_ELIGIBLE_IDS = Object.freeze(Object.keys(ELIGIBLE));

export function buildNoeAtlasCatalog(index, detailsById, generatedAt = new Date().toISOString()) {
	const services = index?.services;
	if (!Array.isArray(services) || services.length < 30) {
		throw new Error("NÖ Atlas: Diensteliste fehlt oder ist unplausibel kurz.");
	}
	const byId = new Map(services.map(service => [service?.id, service]));
	const tiles = [];
	for (const [id, allowed] of Object.entries(ELIGIBLE)) {
		const indexed = byId.get(id);
		const detail = detailsById?.[id]?.services?.find(item => item?.id === id);
		if (!indexed || !detail || indexed.isbasemap !== false
			|| indexed.type !== "tile" || detail.type !== "tile"
			|| !indexed.supportedCrs?.includes(3857)
			|| !detail.supportedCrs?.includes(3857)) {
			throw new Error("NÖ Atlas: fehlender oder veränderter Dienst " + id);
		}
		const template = detail.properties?.tileurl;
		const expected = "https://maps.noe.gv.at/tilecache/bmap/epsg3857/"
			+ allowed.path + "/L{z_}/R{y_}/C{x_}.png";
		if (template !== expected || !Array.isArray(detail.layers) || !detail.layers.length) {
			throw new Error("NÖ Atlas: Kachelschema verändert für " + id);
		}
		tiles.push({
			id,
			name: allowed.name,
			tileTemplate: expected,
			legend: detail.presentations?.find(p => p?.thumbnail?.startsWith("https://maps.noe.gv.at/"))?.thumbnail || null,
			copyright: String(detail.copyrighttext || "").slice(0, 500)
		});
	}
	const counts = {
		total: services.length,
		imageOverlays: services.filter(x => x?.type === "image" && x?.isbasemap === false).length,
		tileOverlays: services.filter(x => x?.type === "tile" && x?.isbasemap === false).length,
		integrated: tiles.length
	};
	return {
		version: 1,
		generatedAt,
		source: "https://atlas.noe.gv.at/atlas/api/rest/services?f=json",
		counts,
		tiles,
		// Inventory for later comparison; private/map services are not activated by it.
		inventory: services.filter(x => x && typeof x.id === "string").map(x => ({
			id: x.id,
			name: String(x.name || ""),
			type: String(x.type || ""),
			isbasemap: x.isbasemap === true,
			supportedCrs: x.supportedCrs || null
		}))
	};
}
