const WFS="https://sdi.noe.gv.at/at.gv.noe.geoserver/OGD/wfs";
const layers=["OGD:IST_GIP_HAUPTRADROUTEN","OGD:IST_RADWEGE_FOERDERUNG"];
for(const layer of layers){
	const params=new URLSearchParams({service:"WFS",version:"2.0.0",request:"GetFeature",typeNames:layer,
		count:"10",outputFormat:"application/json",srsName:"EPSG:4326"});
	try{
		const response=await fetch(WFS+"?"+params,{signal:AbortSignal.timeout(17000)});
		const data=await response.json();
		const features=Array.isArray(data.features)?data.features:[];
		const preview=features.map(f=>({
			id:f.id,fields:Object.keys(f.properties||{}),
			properties:f.properties,
			geometryType:f.geometry?.type,
			numPositions:JSON.stringify(f.geometry?.coordinates||[]).length,
			bbox:f.bbox
		}));
		console.log("NOE_ROUTE_WFS "+JSON.stringify({layer,status:response.status,total:data.totalFeatures||data.numberMatched||null,returned:features.length,preview}));
	}catch(error){console.log("NOE_ROUTE_ERROR "+JSON.stringify({layer,error:error.message}));}
}
const atlasUrl="https://atlas.noe.gv.at/atlas/api/rest/services/ags_radwege?f=json";
try{
	const res=await fetch(atlasUrl,{signal:AbortSignal.timeout(12000)});
	const raw=await res.json();
	const service=raw.services?.find(s=>s.id==="ags_radwege")||raw;
	console.log("NOE_ATLAS_ROUTE "+JSON.stringify({
		name:service.name,id:service.id,type:service.type,copyright:service.copyrighttext||service.copyright,
		capabilities:service.properties?.capabilities,
		layers:service.layers,queries:service.queries,
		presentations:service.presentations,
		metadata:service.metadata
	}).slice(0,16000));
}catch(error){console.log("NOE_ATLAS_ROUTE_ERROR "+error.message)}
