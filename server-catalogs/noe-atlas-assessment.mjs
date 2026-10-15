const base = "https://atlas.noe.gv.at/atlas/api/rest/services/";
const ids = [
	"wms_iws__historische_karten",
	"wms_iws__luftbild_epochen",
	"ags_fernerkundung__flugdaten"
];

async function getJson(url) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(18000),
		headers: {
			Accept: "application/json",
			"User-Agent": "Kartensammlung-NOE-historical-imagery-assessment/1.0"
		}
	});
	if (!response.ok) throw new Error("HTTP " + response.status);
	return response.json();
}

for (const id of ids) {
	try {
		const payload = await getJson(base + encodeURIComponent(id) + "?f=json");
		const service = payload.services?.find((item) => item?.id === id) || payload;
		console.log("NOE_HISTORICAL_SERVICE " + JSON.stringify({
			id,
			name: service?.name,
			type: service?.type,
			supportedCrs: service?.supportedCrs,
			copyright: service?.copyrighttext || service?.copyright || null,
			description: service?.servicedescription || null,
			metadataLink: service?.metadata_link || null,
			properties: service?.properties || null,
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
			})),
			propertyLinks: service?.PropertyLinks || null
		}));

		const ogcUrl = "https://atlas.noe.gv.at/atlas/api/ogc/" + encodeURIComponent(id)
			+ "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities";
		const ogc = await fetch(ogcUrl, { signal: AbortSignal.timeout(12000) });
		const xml = await ogc.text();
		console.log("NOE_HISTORICAL_OGC " + JSON.stringify({
			id,
			status: ogc.status,
			contentType: ogc.headers.get("content-type"),
			enabled: xml.includes("WMS_Capabilities") || xml.includes("WMT_MS_Capabilities"),
			sample: xml.slice(0, 500).replace(/\s+/g, " ")
		}));
	} catch (error) {
		console.log("NOE_HISTORICAL_ERROR " + JSON.stringify({ id, error: error.message }));
	}
}
