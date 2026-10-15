import crypto from "node:crypto";

const HALF = 20037508.342789244;
const z=14,x=8939,y=5681;
const span=(HALF*2)/(1<<z);
const bbox=[
	-HALF+x*span,
	HALF-(y+1)*span,
	-HALF+(x+1)*span,
	HALF-y*span
].join(",");

const tests=[
	["lkw","ags_lkw_durchfahrtsverbote","21,22,23,24,25,27"],
	["wasserbuch","ags_wasserrecht__wasserbuch@atlas_wasser","0,1,26,27,28,29,30,31,32,35,36,37,38,39,40,41,42,44"],
	["landwirtschaft","ags_landwirtschaft__landwirtschaft","3,20,27,28,29,30,43"],
	["tierseuchen","ags_tierseuchen","16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35"]
];
const errorHash="ddb92949e3acd503e3efc2900b31c7aa861c22c3a84994290aee5c9a959b5b48";

function pngDimensions(bytes){
	if(bytes.length<24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
	return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
}

for(const [label,service,layers] of tests){
	const params=new URLSearchParams({
		f:"bin",width:"256",height:"256",bbox,crs:"3857",hmac:"false",layers
	});
	const url="https://atlas.noe.gv.at/atlas/api/rest/services/"+encodeURIComponent(service)+"/getmap?"+params;
	const response=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{"User-Agent":"Kartensammlung-NOE-Atlas-composite-probe/1.0"}});
	const bytes=Buffer.from(await response.arrayBuffer());
	const sha=crypto.createHash("sha256").update(bytes).digest("hex");
	console.log("COMPOSITE_RESULT "+JSON.stringify({
		label,status:response.status,bytes:bytes.length,sha,errorGraphic:sha===errorHash,
		dimensions:pngDimensions(bytes),contentType:response.headers.get("content-type")
	}));
}

const tileUrl="https://maps.noe.gv.at/tilecache/bmap/epsg3857/hangwasser/L14/R00001631/C000022eb.png";
const tileResponse=await fetch(tileUrl,{signal:AbortSignal.timeout(30000),headers:{"User-Agent":"Kartensammlung-NOE-Atlas-composite-probe/1.0"}});
const tileBytes=Buffer.from(await tileResponse.arrayBuffer());
const tileSha=crypto.createHash("sha256").update(tileBytes).digest("hex");
console.log("HANGWASSER_TILE_RESULT "+JSON.stringify({
	status:tileResponse.status,bytes:tileBytes.length,sha:tileSha,errorGraphic:tileSha===errorHash,
	dimensions:pngDimensions(tileBytes),contentType:tileResponse.headers.get("content-type")
}));
