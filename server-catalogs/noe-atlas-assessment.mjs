const base = "https://atlas.noe.gv.at/atlas/api/rest/services/";
const selection = [
	"ags_hochwasser_hq@atlas_wasser",
	"ags_hochwasser_modellberechnung@atlas_wasser",
	"ags_wasserrecht__retentionsflaechen@atlas_wasser"
];

async function get(url) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(18000),
		headers: {
			"Accept": "application/json",
			"User-Agent": "Kartensammlung-NOE-water-assessment/1.0"
		}
	});
	if (!response.ok) throw new Error("HTTP " + response.status);
	const contentType = response.headers.get("content-type") || "";
	if (!contentType.includes("json")) throw new Error("unexpected type " + contentType);
	return response.json();
}

for (const id of selection) {
	try {
		const payload = await get(base + encodeURIComponent(id) + "?f=json");
		const service = payload.services?.find((item) => item?.id === id) || payload;
		const summary = {
			id,
			name: service?.name,
			type: service?.type,
			crs: service?.supportedCrs,
			copyright: service?.copyrighttext || service?.copyright,
			description: String(service?.servicedescription || "").slice(0, 800),
			metadataLink: service?.metadata_link,
			properties: service?.properties,
			layers: (service?.layers || []).map((layer) => ({
				id: layer?.id,
				name: layer?.name,
				tocname: layer?.tocname,
				type: layer?.type,
				selectable: layer?.selectable,
				minscale: layer?.minscale,
				maxscale: layer?.maxscale
			})),
			queries: (service?.queries || []).map((query) => ({
				id: query?.id,
				name: query?.name,
				layerid: query?.layerid,
				resultFields: (query?.result_fields || []).map((field) => ({
					name: field?.name,
					alias: field?.alias
				}))
			})),
			presentations: (service?.presentations || []).map((presentation) => ({
				id: presentation?.id,
				name: presentation?.name,
				layers: presentation?.layers
			}))
		};
		console.log("NOE_WATER_SERVICE " + JSON.stringify(summary));
	} catch (error) {
		console.log("NOE_WATER_SERVICE_ERROR " + JSON.stringify({ id, error: error.message }));
	}

	const ogcUrl = "https://atlas.noe.gv.at/atlas/api/ogc/" + encodeURIComponent(id)
		+ "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities";
	try {
		const response = await fetch(ogcUrl, { signal: AbortSignal.timeout(12000) });
		const xml = await response.text();
		console.log("NOE_WATER_OGC " + JSON.stringify({
			id,
			status: response.status,
			contentType: response.headers.get("content-type"),
			enabled: xml.includes("WMS_Capabilities") || xml.includes("WMT_MS_Capabilities"),
			names: [...xml.matchAll(/<Name>([^<]+)<\/Name>/gi)].map((match) => match[1]).slice(0, 30),
			sample: xml.slice(0, 500).replace(/\s+/g, " ")
		}));
	} catch (error) {
		console.log("NOE_WATER_OGC_ERROR " + JSON.stringify({ id, error: error.message }));
	}
}
