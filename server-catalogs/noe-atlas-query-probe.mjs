const url = "https://atlas.noe.gv.at/atlas/api/scripts/api/api.min.js?8.26.3101";
const text = await (await fetch(url, {
	signal: AbortSignal.timeout(30000),
	headers: {"User-Agent":"Mozilla/5.0"}
})).text();

for (const needle of [
	'c:"identify"',
	"c:'identify'",
	'c:"query"',
	"c:'query'",
	'querytype',
	'identify',
	'spatialfilter',
	'spatial_filter',
	'geometry:',
	'shape:',
	'coord',
	'x:',
	'y:'
]) {
	let from=0,count=0;
	while(count<120){
		const i=text.indexOf(needle,from);
		if(i<0) break;
		const snippet=text.slice(Math.max(0,i-3500),i+7000).replace(/\s+/g," ");
		if(snippet.includes("/queries/") || needle.includes("identify") || needle.includes("spatial")) {
			console.log("ATLAS_IDENTIFY_CALL " + JSON.stringify({needle,index:i,snippet}));
			count++;
		}
		from=i+needle.length;
	}
}
