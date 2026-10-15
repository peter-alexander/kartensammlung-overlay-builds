const base = "https://atlas.noe.gv.at/atlas/api/rest/services/";

async function get(url) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(20000),
		headers: {
			Accept: "application/json",
			"User-Agent": "Kartensammlung-NOE-Atlas-full-inventory/1.0"
		}
	});
	if (!response.ok) throw new Error("HTTP " + response.status);
	return response.json();
}

const index = await get(base + "?f=json");
const services = (index.services || [])
	.filter((service) => service && service.isbasemap !== true)
	.map((service) => ({
		id: service.id,
		name: service.name,
		type: service.type,
		supportedCrs: service.supportedCrs
	}));

console.log("ATLAS_FULL_INDEX " + JSON.stringify({
	total: index.services?.length || 0,
	nonBasemap: services.length,
	services
}));

let cursor = 0;
const results = [];
async function worker() {
	while (cursor < services.length) {
		const indexed = services[cursor++];
		try {
			const payload = await get(base + encodeURIComponent(indexed.id) + "?f=json");
			const service = payload.services?.find((item) => item?.id === indexed.id);
			if (!service) throw new Error("service unavailable");
			const summary = {
				id: indexed.id,
				name: service.name,
				type: service.type,
				crs: service.supportedCrs || indexed.supportedCrs || null,
				copyright: service.copyrighttext || service.copyright || null,
				description: String(service.servicedescription || "")
					.replace(/\s+/g, " ").trim().slice(0, 260),
				capabilities: service.properties?.capabilities || null,
				layers: (service.layers || []).map((layer) => ({
					id: layer.id,
					name: layer.name,
					tocname: layer.tocname || null,
					type: layer.type || null,
					selectable: layer.selectable === true,
					minscale: layer.minscale ?? null,
					maxscale: layer.maxscale ?? null
				})),
				queries: (service.queries || []).map((query) => ({
					id: query.id,
					name: query.name,
					layerid: query.layerid,
					fields: (query.result_fields || []).map((field) => field.name)
				})),
				presentations: (service.presentations || []).map((presentation) => ({
					id: presentation.id,
					name: presentation.name,
					layers: presentation.layers || null
				}))
			};
			results.push(summary);
			console.log("ATLAS_FULL_SERVICE " + JSON.stringify(summary));
		} catch (error) {
			console.log("ATLAS_FULL_ERROR " + JSON.stringify({
				id: indexed.id,
				name: indexed.name,
				error: error.message
			}));
		}
	}
}
await Promise.all(Array.from({length: 5}, worker));

console.log("ATLAS_FULL_SUMMARY " + JSON.stringify({
	read: results.length,
	expected: services.length,
	image: results.filter((service) => service.type === "image").length,
	tile: results.filter((service) => service.type === "tile").length,
	other: results.filter((service) => !["image", "tile"].includes(service.type)).length
}));
