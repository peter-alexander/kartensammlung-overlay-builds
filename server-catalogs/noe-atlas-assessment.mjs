const base = "https://atlas.noe.gv.at/atlas/api/rest/services/";
const selection = [
	"ags_oev___oev_gueteklassen", "ags_radwege", "ags_radwege__rad_basisnetz",
	"ags_lkw_durchfahrtsverbote", "ags_oev___bus_und_haltestellen",
	"ags_hochwasser@atlas_wasser", "ags_hochwasser_hq@atlas_wasser",
	"ags_hochwasser_modellberechnung@atlas_wasser",
	"ags_wasserrecht__retentionsflaechen@atlas_wasser",
	"ags_grundwasser@atlas_wasser", "ags_fliessgewaesser__gewaesserguete@atlas_wasser",
	"ags_fliessgewaesser__abflusskennwerte@atlas_wasser",
	"wms_iws__historische_karten", "wms_iws__luftbild_epochen",
	"ags_fernerkundung__flugdaten", "wms_iws__hoehenmodell",
	"wms_flaechenwidmung@atlas_raumordnung",
	"ags_flaechenwidmung@atlas_raumordnung",
	"ags_energieraumplanung@atlas_raumordnung",
	"ags_raumordnung__zentrumszonen@atlas_raumordnung",
	"ags_atlas__burgen_und_schloesser", "ags_atlas__museen_und_sammlungen",
	"ags_naturschutz", "ags_naturschutz_kompensationsflaechen",
	"ags_naturschutz_projekte", "ags_landwirtschaft__weinbau_rieden_und_fluren",
	"ags_ragweed", "wms_emikat", "tc_hangwasser@atlas_wasser",
	"tc_waldentwicklungsplan", "ags_wasserrecht__wasserbuch@atlas_wasser",
	"ags_wildbach_lawinen_kataster@atlas_wasser"
];
async function get(url) {
	const res = await fetch(url, {
		signal: AbortSignal.timeout(18000),
		headers: { "Accept": "application/json", "User-Agent": "Kartensammlung-NOE-Atlas-assessment/1.0" }
	});
	if (!res.ok) throw new Error("HTTP " + res.status);
	const contentType = res.headers.get("content-type") || "";
	if (!contentType.includes("json")) throw new Error("unexpected type " + contentType);
	return res.json();
}
const existing = await get("https://fahrrad.lima-city.de/Maps/ServerNames/NoeCatalog.json");
const layers = Array.isArray(existing?.layers) ? existing.layers : [];
console.log("EXISTING_NOE " + JSON.stringify({ total: layers.length, names: layers.map(x => [x.name, x.title, x.wfs]) }));
const index = await get(base + "?f=json");
console.log("ATLAS_COUNTS " + JSON.stringify({
	total: index.services.length, curated: selection.length
}));
let cursor = 0;
const results = [];
async function worker() {
	while (cursor < selection.length) {
		const id = selection[cursor++];
		try {
			const v = await get(base + encodeURIComponent(id) + "?f=json");
			const service = v.services?.find(x=>x?.id === id);
			if (!service) {
				console.log("NOE_SERVICE_ERROR " + JSON.stringify({id,error:"service unavailable"}));
				continue;
			}
			const matching = layers.filter(x=>(
				x.title?.toLowerCase().includes(service.name.toLowerCase())
				|| service.name?.toLowerCase().includes(x.title?.toLowerCase())
			)).map(x=>x.title).slice(0,5);
			const summary = {
				id, name: service.name, type: service.type,
				crs: service.supportedCrs,
				layers: (service.layers || []).map(x=>({
					id: x.id, name: x.name, type: x.type,
					selectable: x.selectable, minscale: x.minscale,
					tocname: x.tocname
				})).slice(0,30),
				layerCount: service.layers?.length,
				presentations: service.presentations?.map(x=>({id:x.id,name:x.name,layers:x.layers?.length})).slice(0,25),
				queries: service.queries?.map(x=>({
					id:x.id,name:x.name,layerid:x.layerid,fields:x.result_fields?.map(y=>y.name)
				})).slice(0,20),
				copyright: service.copyrighttext || service.copyright,
				description: String(service.servicedescription || "").slice(0,300),
				metadataLink: service.metadata_link,
				properties: service.type === "tile"
					? {tileurl:service.properties?.tileurl, resolutions:service.properties?.resolutions?.length}
					: {capabilities:service.properties?.capabilities},
				matching
			};
			results.push(summary);
			console.log("ATLAS_ASSESS " + JSON.stringify(summary));
		} catch(error) {
			console.log("NOE_SERVICE_ERROR " + JSON.stringify({id,error:error.message}));
		}
	}
}
await Promise.all(Array.from({length:4},worker));
console.log("ATLAS_ASSESS_SUMMARY " + JSON.stringify({assessed:results.length, selected:selection.length}));
