const ids = [
	"tc_hangwasser@atlas_wasser",
	"tc_waldentwicklungsplan"
];
for (const id of ids) {
	const response = await fetch(
		"https://atlas.noe.gv.at/atlas/api/rest/services/"
			+ encodeURIComponent(id) + "?f=json",
		{ signal: AbortSignal.timeout(15000) }
	);
	const payload = await response.json();
	const service = payload.services?.find((item) => item?.id === id);
	console.log("NOE_TILE_DETAIL " + JSON.stringify({
		id,
		name: service?.name,
		crs: service?.supportedCrs,
		tileurl: service?.properties?.tileurl,
		layers: service?.layers,
		copyright: service?.copyrighttext || service?.copyright || null
	}));
}
