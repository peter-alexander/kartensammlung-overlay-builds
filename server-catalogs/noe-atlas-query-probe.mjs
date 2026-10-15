const root = "https://atlas.noe.gv.at/";
const html = await (await fetch(root, {signal: AbortSignal.timeout(20000)})).text();
const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
	.map((match) => new URL(match[1], root).href);
console.log("ATLAS_SCRIPTS " + JSON.stringify(scripts));
for (const url of scripts) {
	try {
		const text = await (await fetch(url, {signal: AbortSignal.timeout(30000)})).text();
		const needles = [
			"/query", "/identify", "identify?", "query?", "rest/services/",
			"getfeatureinfo", "getidentify", "getquery"
		];
		const hits = [];
		for (const needle of needles) {
			let from = 0;
			while (true) {
				const index = text.toLowerCase().indexOf(needle.toLowerCase(), from);
				if (index < 0) break;
				hits.push({
					needle,
					snippet: text.slice(Math.max(0, index - 500), index + 1200)
						.replace(/\s+/g, " ")
				});
				from = index + needle.length;
				if (hits.length >= 80) break;
			}
			if (hits.length >= 80) break;
		}
		if (hits.length) {
			console.log("ATLAS_SCRIPT_HITS " + JSON.stringify({url,hits}));
		}
	} catch (error) {
		console.log("ATLAS_SCRIPT_ERROR " + JSON.stringify({url,error:error.message}));
	}
}
