const url = "https://atlas.noe.gv.at/atlas/api/scripts/api/api.min.js?8.26.3101";
const text = await (await fetch(url, {
	signal: AbortSignal.timeout(30000),
	headers: {"User-Agent":"Mozilla/5.0"}
})).text();

const literalRe = /(["'`])((?:\\.|(?!\1).){1,300})\1/g;
const literals = new Set();
for (const match of text.matchAll(literalRe)) {
	const value = match[2];
	if (/rest\/services|query|identify|featureinfo|intersect|spatial|geometry/i.test(value)) {
		literals.add(value);
	}
}
console.log("ATLAS_QUERY_LITERALS " + JSON.stringify([...literals].sort()));

const needles = [
	"rest/services/",
	".query=function",
	"query=function",
	"identify=function",
	"queryResultFeatures",
	"queryid=",
	"queryId",
	"searchshape",
	"geometry="
];
for (const needle of needles) {
	let from=0,count=0;
	while(count<40){
		const i=text.indexOf(needle,from);
		if(i<0) break;
		console.log("ATLAS_QUERY_SNIPPET " + JSON.stringify({
			needle,
			snippet:text.slice(Math.max(0,i-1600),i+3600).replace(/\s+/g," ")
		}));
		from=i+needle.length;
		count++;
	}
}
