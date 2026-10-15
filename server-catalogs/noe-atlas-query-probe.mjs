const url = "https://atlas.noe.gv.at/atlas/api/scripts/api/api.min.js?8.26.3101";
const text = await (await fetch(url, {
	signal: AbortSignal.timeout(30000),
	headers: {"User-Agent":"Mozilla/5.0"}
})).text();

for (const needle of [
	'"/rest/services/"',
	'"/queries/"',
	"'/queries/'",
	'c:"query"',
	"c:'query'",
	'"#oids#"',
	'"geometry"',
	'"shape"',
	'"bbox"',
	'"distance"',
	'"buffer"'
]) {
	let from=0,count=0;
	while(count<80){
		const i=text.indexOf(needle,from);
		if(i<0) break;
		console.log("ATLAS_QUERY_CALL " + JSON.stringify({
			needle,
			index:i,
			snippet:text.slice(Math.max(0,i-2500),i+5000).replace(/\s+/g," ")
		}));
		from=i+needle.length;
		count++;
	}
}
