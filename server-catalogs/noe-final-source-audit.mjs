const urls = [
	["ogd-list","https://data.noe.gv.at/api/dataset"],
	["arcgis-root","https://geo.noe.gv.at/public/rest/services?f=pjson"],
	["geoland-wms","https://geo.noe.gv.at/public/services/wms/geoland_wms_noe/MapServer/WmsServer?SERVICE=WMS&REQUEST=GetCapabilities"],
	["numbis-current","https://numbis.noe.gv.at/Numbis/aktuelledaten.jsp"],
	["numbis-map","https://numbis.noe.gv.at/Numbis/landkarte.jsp"],
	["lawinen","https://www.lawinenwarndienst-niederoesterreich.at/"]
];

for (const [label,url] of urls) {
	try {
		const response=await fetch(url,{
			signal:AbortSignal.timeout(30000),
			headers:{"User-Agent":"Kartensammlung-NOE-final-source-audit/1.0"}
		});
		const text=await response.text();
		console.log("AUDIT_SOURCE "+JSON.stringify({
			label,status:response.status,finalUrl:response.url,
			contentType:response.headers.get("content-type"),
			bytes:text.length,
			sample:text.slice(0,12000).replace(/\s+/g," ")
		}));
		if(label==="geoland-wms"){
			const names=[...text.matchAll(/<Name>([^<]+)<\/Name>/g)].map(m=>m[1]);
			const titles=[...text.matchAll(/<Title>([^<]+)<\/Title>/g)].map(m=>m[1]);
			console.log("AUDIT_GEOLAND "+JSON.stringify({names,titles}));
		}
		if(label==="arcgis-root"){
			try { console.log("AUDIT_ARCGIS_ROOT "+JSON.stringify(JSON.parse(text))); } catch {}
		}
		if(label.startsWith("numbis")){
			const links=[...text.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map(m=>m[1]);
			const forms=[...text.matchAll(/<form[\s\S]*?<\/form>/gi)].map(x=>x[0].replace(/\s+/g," ").slice(0,6000));
			console.log("AUDIT_NUMBIS "+JSON.stringify({label,links:[...new Set(links)].slice(0,120),forms}));
		}
		if(label==="lawinen"){
			const links=[...text.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map(m=>m[1]);
			console.log("AUDIT_LAWINEN "+JSON.stringify({links:[...new Set(links)].slice(0,180)}));
		}
	} catch(error){
		console.log("AUDIT_ERROR "+JSON.stringify({label,url,error:error.message}));
	}
}
