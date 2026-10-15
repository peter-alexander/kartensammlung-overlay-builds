const LIST = "https://data.noe.gv.at/api/dataset";

async function fetchText(url) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(30000),
		headers: {"User-Agent":"Kartensammlung-NOE-final-source-audit/1.2"}
	});
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
	return response.text();
}

function decodeXml(value) {
	return String(value || "")
		.replace(/&amp;/g,"&")
		.replace(/&lt;/g,"<")
		.replace(/&gt;/g,">")
		.replace(/&quot;/g,'"')
		.replace(/&#39;/g,"'");
}
function textOf(xml, name) {
	const re = new RegExp("<(?:\\w+:)?"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?"+name+">","i");
	const m = xml.match(re);
	return m ? decodeXml(m[1].replace(/<[^>]+>/g," ").replace(/\\s+/g," ").trim()) : "";
}
function resources(xml) {
	const out=[];
	for(const block of xml.matchAll(new RegExp("<resource>([\\s\\S]*?)</resource>", "gi"))){
		const b=block[1];
		out.push({
			name:textOf(b,"resource_name"),
			url:textOf(b,"resource_url"),
			format:textOf(b,"resource_format")
		});
	}
	return out;
}
function urls(xml) {
	return [...new Set(
		[...xml.matchAll(/https?:\/\/[^<"'\s]+/gi)]
			.map(m => decodeXml(m[0]).replace(/[),.;]+$/,""))
	)];
}

const listXml = await fetchText(LIST);
const listEntries = [...listXml.matchAll(/<id\b([^>]*)>([^<]+)<\/id>/g)].map(m => ({
	id:m[2].trim(),
	lastModified:(m[1].match(/last_modified=["']([^"']+)/i)||[])[1]||"",
	state:(m[1].match(/state=["']([^"']+)/i)||[])[1]||""
}));
console.log("OGD_COUNT "+listEntries.length);

const serviceWords = /(service=wms|service=wfs|\/wms(?:\?|$)|\/wfs(?:\?|$)|getcapabilit)/i;
const records=[];
let cursor=0;
const workers=Array.from({length:8},async()=>{
	while(true){
		const index=cursor++;
		if(index>=listEntries.length) return;
		const entry=listEntries[index];
		try{
			const xml=await fetchText(LIST+"/"+entry.id);
			const foundUrls=urls(xml);
			records.push({
				id:entry.id,
				title:textOf(xml,"title")||textOf(xml,"name"),
				lastModified:entry.lastModified,
				state:entry.state,
				updateFrequency:textOf(xml,"update_frequency"),
				begin:textOf(xml,"begin_datetime"),
				end:textOf(xml,"end_datetime"),
				categories:[...xml.matchAll(/<category>([^<]+)<\/category>/gi)].map(m=>decodeXml(m[1].trim())),
				keywords:[...xml.matchAll(/<keyword>([^<]+)<\/keyword>/gi)].map(m=>decodeXml(m[1].trim())),
				description:textOf(xml,"description").slice(0,900),
				hasOgc:foundUrls.some(url=>serviceWords.test(url)),
				resources:resources(xml)
			});
		}catch(error){
			console.log("OGD_FETCH_ERROR "+JSON.stringify({id:entry.id,error:error.message}));
		}
	}
});
await Promise.all(workers);

const noOgc=records
	.filter(r=>!r.hasOgc)
	.filter(r=>/(geo|karte|raster|modell|geländ|gelaend|oberfläch|oberflaech|boden|hydro|gewässer|gewaesser|luft|ozon|feinstaub|pm10|pm2|stick|schwefel|kohlenmonoxid|wind|temperatur|feuchtigkeit|strahlung|messstell|station|straße|strasse|verkehr|rad|grenz|gebiet|fläche|flaeche|linie|punkt|standort|schutz|widmung|natur|wald|wein|höhe|hoehe|orthofoto|laser|dgm|dom|hang|niederschlag)/i
		.test([r.title,r.description,r.keywords.join(" ")].join(" ")))
	.sort((a,b)=>a.title.localeCompare(b.title,"de"));
console.log("OGD_NO_OGC_DETAIL "+JSON.stringify(noOgc));
