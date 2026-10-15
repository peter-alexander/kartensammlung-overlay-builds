const roots = [
	"https://atlas.noe.gv.at/",
	"https://atlas.noe.gv.at/atlas/",
	"https://atlas.noe.gv.at/atlas/index.html"
];
for (const root of roots) {
	try {
		const response = await fetch(root, {
			redirect: "follow",
			signal: AbortSignal.timeout(20000),
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/155 Safari/537.36"
			}
		});
		const html = await response.text();
		console.log("ATLAS_HTML " + JSON.stringify({
			requested: root,
			finalUrl: response.url,
			status: response.status,
			html: html.slice(0, 12000).replace(/\s+/g, " ")
		}));
		const refs = [
			...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]),
			...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map(m => m[1])
		].map((ref) => {
			try { return new URL(ref, response.url).href; } catch { return null; }
		}).filter(Boolean);
		console.log("ATLAS_ASSETS " + JSON.stringify({root,refs}));
		for (const url of refs.filter((url) => /\.js(?:\?|$)/i.test(url))) {
			try {
				const text = await (await fetch(url, {
					signal: AbortSignal.timeout(30000),
					headers: {"User-Agent":"Mozilla/5.0"}
				})).text();
				const hits = [];
				for (const needle of ["/query","/identify","rest/services/","getfeatureinfo","identify","query"]) {
					let from=0;
					while (hits.length < 120) {
						const i=text.toLowerCase().indexOf(needle.toLowerCase(),from);
						if(i<0) break;
						hits.push({
							needle,
							snippet:text.slice(Math.max(0,i-600),i+1500).replace(/\s+/g," ")
						});
						from=i+needle.length;
					}
				}
				if(hits.length) console.log("ATLAS_SCRIPT_HITS "+JSON.stringify({url,hits}));
			} catch(error) {
				console.log("ATLAS_SCRIPT_ERROR "+JSON.stringify({url,error:error.message}));
			}
		}
	} catch (error) {
		console.log("ATLAS_ROOT_ERROR " + JSON.stringify({root,error:error.message}));
	}
}
