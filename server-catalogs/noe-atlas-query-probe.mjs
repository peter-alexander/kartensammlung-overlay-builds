const roots = [
	"https://atlas.noe.gv.at/atlas/portal/noe-atlas/map/Basiskarten%20und%20Bilder/N%C3%96%20Adressen",
	"https://atlas.noe.gv.at/atlas/portal/noe-atlas"
];
for (const root of roots) {
	const response = await fetch(root, {
		redirect: "follow",
		signal: AbortSignal.timeout(20000),
		headers: {
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155 Safari/537.36"
		}
	});
	const html = await response.text();
	console.log("ATLAS_APP_HTML " + JSON.stringify({
		requested: root,
		finalUrl: response.url,
		status: response.status,
		html: html.slice(0, 16000).replace(/\s+/g, " ")
	}));
	const refs = [
		...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]),
		...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map(m => m[1])
	].map((ref) => {
		try { return new URL(ref, response.url).href; } catch { return null; }
	}).filter(Boolean);
	console.log("ATLAS_APP_ASSETS " + JSON.stringify({root,refs}));

	for (const url of refs.filter((url) => /\.js(?:\?|$)/i.test(url))) {
		const text = await (await fetch(url, {
			signal: AbortSignal.timeout(30000),
			headers: {"User-Agent":"Mozilla/5.0"}
		})).text();
		const hits = [];
		for (const needle of [
			"/api/rest/services/", "/query", "/identify", "queryid",
			"identify", "query", "mapPoint", "geometry", "tolerance"
		]) {
			let from=0;
			while(hits.length<160){
				const i=text.toLowerCase().indexOf(needle.toLowerCase(),from);
				if(i<0) break;
				hits.push({
					needle,
					snippet:text.slice(Math.max(0,i-700),i+1800).replace(/\s+/g," ")
				});
				from=i+needle.length;
			}
		}
		if(hits.length) console.log("ATLAS_APP_SCRIPT_HITS "+JSON.stringify({url,hits}));
	}
}
