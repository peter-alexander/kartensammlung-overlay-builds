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

const retentionService = "ags_wasserrecht__retentionsflaechen@atlas_wasser";
const retentionBase = "https://atlas.noe.gv.at/atlas/api/rest/services/"
	+ encodeURIComponent(retentionService);
const noeMercatorBbox = "1606081.2116918617,6008339.82826084,1913500.0042716584,6280910.072401943";

for (const layer of ["88", "91"]) {
	const params = new URLSearchParams({
		f: "bin",
		width: "768",
		height: "681",
		bbox: noeMercatorBbox,
		layers: layer,
		crs: "3857",
		hmac: "false"
	});
	try {
		const response = await fetch(retentionBase + "/getmap?" + params, {
			signal: AbortSignal.timeout(20000),
			headers: { "User-Agent": "Kartensammlung-NOE-retention-map-probe/1.0" }
		});
		const body = new Uint8Array(await response.arrayBuffer());
		const png = body.length >= 8
			&& body[0] === 137 && body[1] === 80 && body[2] === 78 && body[3] === 71;
		const jpeg = body.length >= 3
			&& body[0] === 255 && body[1] === 216 && body[2] === 255;
		console.log("NOE_RETENTION_GETMAP " + JSON.stringify({
			layer,
			status: response.status,
			contentType: response.headers.get("content-type"),
			cacheControl: response.headers.get("cache-control"),
			bytes: body.length,
			png,
			jpeg,
			sample: (!png && !jpeg)
				? new TextDecoder().decode(body.slice(0, 800)).replace(/\s+/g, " ")
				: null
		}));
	} catch (error) {
		console.log("NOE_RETENTION_GETMAP_ERROR " + JSON.stringify({ layer, error: error.message }));
	}
}

for (const layer of ["88", "91"]) {
	const params = new URLSearchParams({
		f: "json",
		width: "768",
		height: "681",
		bbox: noeMercatorBbox,
		layers: layer,
		crs: "3857",
		hmac: "false"
	});
	try {
		const response = await fetch(retentionBase + "/getlegend?" + params, {
			signal: AbortSignal.timeout(16000),
			headers: {
				"Accept": "application/json,*/*;q=0.8",
				"User-Agent": "Kartensammlung-NOE-retention-legend-probe/1.0"
			}
		});
		const body = await response.text();
		console.log("NOE_RETENTION_LEGEND " + JSON.stringify({
			layer,
			status: response.status,
			contentType: response.headers.get("content-type"),
			length: body.length,
			sample: body.slice(0, 3500).replace(/\s+/g, " ")
		}));
	} catch (error) {
		console.log("NOE_RETENTION_LEGEND_ERROR " + JSON.stringify({ layer, error: error.message }));
	}
}

try {
	const payload = await get(base + encodeURIComponent(retentionService) + "?f=json");
	const service = payload.services?.find((item) => item?.id === retentionService) || payload;
	const scalarMetadata = {};
	for (const [key, value] of Object.entries(service || {})) {
		if (
			typeof value === "string"
			&& /copyright|licen|recht|nutz|metadata|source|quelle|owner|provider|description|contact/i.test(key)
		) {
			scalarMetadata[key] = value;
		}
	}
	console.log("NOE_RETENTION_RIGHTS_METADATA " + JSON.stringify({
		keys: Object.keys(service || {}),
		scalarMetadata,
		copyright: service?.copyrighttext || service?.copyright || null,
		metadata: service?.metadata || null,
		metadataLink: service?.metadata_link || null
	}));
} catch (error) {
	console.log("NOE_RETENTION_RIGHTS_METADATA_ERROR " + JSON.stringify({ error: error.message }));
}

try {
	const params = new URLSearchParams({
		f: "bin",
		width: "256",
		height: "256",
		bbox: noeMercatorBbox,
		layers: "88",
		crs: "3857",
		hmac: "false"
	});
	const response = await fetch(retentionBase + "/getmap?" + params, {
		signal: AbortSignal.timeout(16000),
		headers: {
			Origin: "https://fahrrad.lima-city.de",
			"User-Agent": "Kartensammlung-NOE-retention-rights-probe/1.0"
		}
	});
	await response.arrayBuffer();

	const payload = await get(base + encodeURIComponent(retentionService) + "?f=json");
	const service = payload.services?.find((item) => item?.id === retentionService) || payload;
	console.log("NOE_RETENTION_CORS_RIGHTS " + JSON.stringify({
		status: response.status,
		contentType: response.headers.get("content-type"),
		accessControlAllowOrigin: response.headers.get("access-control-allow-origin"),
		accessControlAllowMethods: response.headers.get("access-control-allow-methods"),
		propertyLinks: service?.PropertyLinks || null,
		layers: (service?.layers || []).map((layer) => ({
			id: layer?.id,
			name: layer?.name,
			copyright: layer?.copyright || layer?.copyrighttext || null,
			metadata: layer?.metadata || layer?.metadata_link || null,
			properties: layer?.properties || null
		}))
	}));
} catch (error) {
	console.log("NOE_RETENTION_CORS_RIGHTS_ERROR " + JSON.stringify({ error: error.message }));
}

