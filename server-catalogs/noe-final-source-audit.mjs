const resources = [
	["hydrobod-raster","https://open-data.noe.gv.at/ogd-data/WA2/hydrobod/rasterdaten_hydrobod2.zip"],
	["hydrobod-meta","https://open-data.noe.gv.at/ogd-data/WA2/hydrobod/Rasterdaten_Hydrobod_II_Metadaten.ods"],
	["jdtv","https://open-data.noe.gv.at/ogd-data/BD1/Inspire_JDTV2019_Dauerzaehlstellen.csv"],
	["forest","https://open-data.noe.gv.at/ogd-data/BD1/waldflachen-in-niederosterreich.zip"],
	["temp-1991-2010","https://open-data.noe.gv.at/ogd-data/WA2/lufttemperatur_1991_2010.zip"],
	["temp-2001-2010","https://open-data.noe.gv.at/ogd-data/WA2/lufttemperatur_2001_2010.zip"],
	["precip-1981-2010","https://open-data.noe.gv.at/ogd-data/WA2/niederschlag_1981_2010.zip"],
	["precip-2001-2010","https://open-data.noe.gv.at/ogd-data/WA2/niederschlag_2001_2010.zip"],
	["schools","https://open-data.noe.gv.at/ogd-data/LSR/schulen_noe.csv"],
	["pv-2013","https://open-data.noe.gv.at/ogd-data/RU3/PV_Daten_fuer_OGD_2013.csv"]
];

for(const [label,url] of resources){
	try{
		const head=await fetch(url,{method:"HEAD",signal:AbortSignal.timeout(20000),headers:{"User-Agent":"Kartensammlung-NOE-final-source-audit/1.3"}});
		console.log("RESOURCE_HEAD "+JSON.stringify({
			label,status:head.status,
			length:head.headers.get("content-length"),
			type:head.headers.get("content-type"),
			modified:head.headers.get("last-modified")
		}));
		if(/\.csv$/i.test(url)){
			const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{"User-Agent":"Kartensammlung-NOE-final-source-audit/1.3","Range":"bytes=0-8191"}});
			const text=await response.text();
			console.log("RESOURCE_SAMPLE "+JSON.stringify({label,status:response.status,text:text.slice(0,8000)}));
		}
	}catch(error){
		console.log("RESOURCE_ERROR "+JSON.stringify({label,error:error.message}));
	}
}
