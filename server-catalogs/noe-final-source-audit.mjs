const LIST = "https://data.noe.gv.at/api/dataset";

async function fetchText(url) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(30000),
		headers: {"User-Agent":"Kartensammlung-NOE-final-source-audit/1.1"}
	});
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
	return response.text();
}

const listXml = await fetchText(LIST);
const ids = [...listXml.matchAll(/<id\b[^>]*>([^<]+)<\/id>/g)].map(m => m[1].trim());
console.log("OGD_COUNT " + ids.length);

for (const id of [
	"203fbf07-9da2-40d2-bc7f-328dae43dafc",
	"46a7a06a-f69b-405e-aac2-77f775449ad3",
	"16dd490b-1ec3-4274-8da9-c6371613f241"
]) {
	try {
		const xml = await fetchText(LIST + "/" + id);
		console.log("OGD_DETAIL_SAMPLE " + JSON.stringify({id,xml:xml.slice(0,20000)}));
	} catch (error) {
		console.log("OGD_DETAIL_ERROR " + JSON.stringify({id,error:error.message}));
	}
}

function decodeXml(value) {
	return String(value || "")
		.replace(/&amp;/g,"&")
		.replace(/&lt;/g,"<")
		.replace(/&gt;/g,">")
		.replace(/&quot;/g,'"')
		.replace(/&#39;/g,"'");
}
function tag(xml, name) {
	const m = xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+name+">","i"));
	return m ? decodeXml(m[1].replace(/<[^>]+>/g," ").replace(/\\s+/g," ").trim()) : "";
}
function urls(xml) {
	return [...new Set(
		[...xml.matchAll(/https?:\/\/[^<"'\s]+/gi)]
			.map(m => decodeXml(m[0]).replace(/[),.;]+$/,""))
	)];
}

const spatialWords = /(geo|karte|kart|raster|modell|geländ|gelaend|oberflächenmodell|oberflaechenmodell|boden|hydro|gewässer|gewaesser|luft|ozon|feinstaub|pm10|pm2|stick|schwefel|kohlenmonoxid|wind|temperatur|feuchtigkeit|strahlung|messstell|station|straße|strasse|verkehr|rad|grenz|gebiet|fläche|flaeche|linie|punkt|standort|schutz|widmung|natur|wald|wein|höhe|hoehe|orthofoto|laser|dgm|dom|hang|niederschlag)/i;
const serviceWords = /(service=wms|service=wfs|\/wms(?:\?|$)|\/wfs(?:\?|$)|getcapabilit)/i;

const results = [];
let cursor = 0;
const workers = Array.from({length:8}, async () => {
	while (true) {
		const index = cursor++;
		if (index >= ids.length) return;
		const id = ids[index];
		try {
			const xml = await fetchText(LIST + "/" + id);
			const foundUrls = urls(xml);
			const title = tag(xml,"title") || tag(xml,"name") || tag(xml,"bezeichnung");
			const description = tag(xml,"description") || tag(xml,"beschreibung");
			const keywords = tag(xml,"keywords") || tag(xml,"schlagworte");
			const category = tag(xml,"category") || tag(xml,"kategorie");
			const hay = [title,description,keywords,category,foundUrls.join(" ")].join(" ");
			if (!spatialWords.test(hay)) continue;
			const hasOgc = foundUrls.some(url => serviceWords.test(url));
			results.push({
				id,title,category,keywords,
				hasOgc,
				urls: foundUrls.filter(url => !/creativecommons|noe\.gv\.at\/noe\/Open-Government-Data\/Nutzungsbedingungen/i.test(url)).slice(0,20),
				description: description.slice(0,700)
			});
		} catch (error) {
			console.log("OGD_FETCH_ERROR "+JSON.stringify({id,error:error.message}));
		}
	}
});
await Promise.all(workers);
results.sort((a,b)=>a.title.localeCompare(b.title,"de"));
console.log("OGD_SPATIAL_CANDIDATES "+JSON.stringify(results));
console.log("OGD_NO_OGC_CANDIDATES "+JSON.stringify(results.filter(x=>!x.hasOgc)));
