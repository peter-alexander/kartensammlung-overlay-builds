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

for (const scriptUrl of [
	"https://atlas.noe.gv.at/atlas/portal/scripts/webgis-map.min.js?8.26.3101",
	"https://atlas.noe.gv.at/atlas/portal/scripts/webgis-portal-cloud.js?8.26.3101"
]) {
	try {
		const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(18000) });
		const source = await response.text();
		const patterns = [
			/\.{0,0}/
		];
		const snippets = [];
		for (const match of source.matchAll(/.{0,180}(?:identify|legend|rest\/services|\/map(?:\?|["'])|query).{0,240}/gi)) {
			const snippet = match[0].replace(/\s+/g, " ");
			if (!snippets.includes(snippet)) snippets.push(snippet);
			if (snippets.length >= 80) break;
		}
		console.log("NOE_ATLAS_SCRIPT_API " + JSON.stringify({
			scriptUrl,
			length: source.length,
			snippets
		}));
	} catch (error) {
		console.log("NOE_ATLAS_SCRIPT_API_ERROR " + JSON.stringify({ scriptUrl, error: error.message }));
	}
}

try {
	const pageUrl = "https://atlas.noe.gv.at/atlas/portal/noe-atlas";
	const response = await fetch(pageUrl, { signal: AbortSignal.timeout(18000) });
	const html = await response.text();
	const scriptUrls = [...new Set(
		[...html.matchAll(/<script\b[^>]*src=["']([^"']+)/gi)]
			.map((match) => new URL(match[1], response.url || pageUrl).toString())
			.filter((url) => url.startsWith("https://atlas.noe.gv.at/"))
	)].slice(0, 50);
	console.log("NOE_ATLAS_LOADED_SCRIPTS " + JSON.stringify(scriptUrls));

	for (const scriptUrl of scriptUrls) {
		if (!/\.js(?:\?|$)/i.test(scriptUrl)) continue;
		try {
			const scriptResponse = await fetch(scriptUrl, { signal: AbortSignal.timeout(18000) });
			const source = await scriptResponse.text();
			if (!/(?:rest\/services|\/identify|\/legend|\/map)/i.test(source)) continue;
			const snippets = [];
			for (const match of source.matchAll(/.{0,220}(?:rest\/services|\/identify|\/legend|\/map).{0,320}/gi)) {
				const snippet = match[0].replace(/\s+/g, " ");
				if (!snippets.includes(snippet)) snippets.push(snippet);
				if (snippets.length >= 40) break;
			}
			console.log("NOE_ATLAS_REST_SCRIPT " + JSON.stringify({
				scriptUrl,
				length: source.length,
				snippets
			}));
		} catch (error) {
			console.log("NOE_ATLAS_REST_SCRIPT_ERROR " + JSON.stringify({ scriptUrl, error: error.message }));
		}
	}
} catch (error) {
	console.log("NOE_ATLAS_LOADED_SCRIPTS_ERROR " + JSON.stringify({ error: error.message }));
}

try {
	const scriptUrl = "https://atlas.noe.gv.at/atlas/api/scripts/api/api.min.js?8.26.3101";
	const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(18000) });
	const source = await response.text();
	for (const needle of [
		"getPreviewUrl=function",
		"getLegendPostData=function",
		"getMapPostData=function",
		"webgis_service=function",
		"/identify",
		"identify=function",
		"getIdentify",
		"appendHMACData=function",
		"urlParameters=function"
	]) {
		const index = source.indexOf(needle);
		console.log("NOE_ATLAS_API_FUNCTION " + JSON.stringify({
			needle,
			index,
			snippet: index >= 0
				? source.slice(Math.max(0, index - 700), index + 2600).replace(/\s+/g, " ")
				: null
		}));
	}
} catch (error) {
	console.log("NOE_ATLAS_API_FUNCTION_ERROR " + JSON.stringify({ error: error.message }));
}

