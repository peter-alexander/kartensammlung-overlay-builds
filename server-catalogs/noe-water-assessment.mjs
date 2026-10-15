const base = "https://atlas.noe.gv.at/atlas/api/rest/services/";
const ids = [
	"ags_hochwasser_hq@atlas_wasser",
	"ags_hochwasser_modellberechnung@atlas_wasser",
	"ags_wasserrecht__retentionsflaechen@atlas_wasser"
];

async function getJson(url) {
	const response = await fetch(url, {
		headers: {
			"Accept": "application/json",
			"User-Agent": "Kartensammlung-NOE-water-assessment/1.0"
		},
		signal: AbortSignal.timeout(20000)
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return response.json();
}

function summarizeService(payload, id) {
	const service = payload?.services?.find((item) => item?.id === id) || payload;
	return {
		id,
		name: service?.name ?? null,
		type: service?.type ?? null,
		supportedCrs: service?.supportedCrs ?? null,
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
		}))
	};
}

const output = {
	checkedAt: new Date().toISOString(),
	services: []
};

for (const id of ids) {
	try {
		output.services.push(summarizeService(
			await getJson(base + encodeURIComponent(id) + "?f=json"),
			id
		));
	} catch (error) {
		output.services.push({ id, error: error.message });
	}
}

try {
	const catalog = await getJson("https://fahrrad.lima-city.de/Maps/ServerNames/NoeCatalog.json");
	output.existingNoeLayers = (catalog?.layers || [])
		.filter((layer) => /HYD_HW|HOCHWASSER|RETENTION|VORRANG|VORBEHALT/i.test(
			`${layer?.name || ""} ${layer?.title || ""} ${layer?.abstract || ""}`
		))
		.map((layer) => ({
			name: layer?.name,
			title: layer?.title,
			abstract: layer?.abstract,
			wfs: layer?.wfs,
			queryable: layer?.queryable,
			infoFormat: layer?.infoFormat,
			cache: layer?.cache
		}));
} catch (error) {
	output.existingNoeLayersError = error.message;
}

await import("node:fs/promises").then(({ writeFile }) =>
	writeFile(
		new URL("./noe-water-assessment.json", import.meta.url),
		JSON.stringify(output, null, "\t") + "\n"
	)
);
