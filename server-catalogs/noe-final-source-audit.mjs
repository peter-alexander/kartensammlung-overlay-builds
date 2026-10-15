import crypto from "node:crypto";

const HALF = 20037508.342789244;
const z = 14, x = 8939, y = 5681;
const span = (HALF * 2) / (1 << z);
const bbox = [
	-HALF + x * span,
	HALF - (y + 1) * span,
	-HALF + (x + 1) * span,
	HALF - y * span
].join(",");
const errorHash = "ddb92949e3acd503e3efc2900b31c7aa861c22c3a84994290aee5c9a959b5b48";

const tests = [
	["height-dtm","wms_iws__luftbild_hoehe","DTM_1x1_HILLSHADE_MULTIDIRECTIONAL|default"],
	["height-dsm","wms_iws__luftbild_hoehe","DSM_1x1_HILLSHADE_MULTIDIRECTIONAL|default"],
	["height-slope-percent","wms_iws__luftbild_hoehe","SLOPE_2023|default"],
	["height-slope-degree","wms_iws__luftbild_hoehe","SLOPE_DEGREE|default"],
	["hangwasser-slope-lt15","hangwasser_hangneigung@atlas_wasser","EROSION|default"],
	["water-quality-hydromorph","ags_fliessgewaesser__gewaesserguete@atlas_wasser","45"],
	["water-quality-biological","ags_fliessgewaesser__gewaesserguete@atlas_wasser","43"],
	["water-quality-fish-network","ags_fliessgewaesser__gewaesserguete@atlas_wasser","9,10"],
	["water-quality-fish-species","ags_fliessgewaesser__gewaesserguete@atlas_wasser","7"],
	["public-water-property","ags_dkm_kataster__oeffentliches_wassergut","12"],
	["flood-risk-areas","ags_hochwasser@atlas_wasser","8"],
	["offices-agriculture","ags_dienststellen","5,7"],
	["offices-state","ags_dienststellen","6,8,9,13"],
	["offices-hospital","ags_dienststellen","16"],
	["waterlaw-marchfeld","ags_wasserrecht__wasserrecht@atlas_wasser","3"],
	["waterlaw-mitterndorf","ags_wasserrecht__wasserrecht@atlas_wasser","2"],
	["waterlaw-wastewater-association","ags_wasserrecht__wasserrecht@atlas_wasser","4,84"],
	["waterlaw-maintenance-association","ags_wasserrecht__wasserrecht@atlas_wasser","23"],
	["waterlaw-water-supply-association","ags_wasserrecht__wasserrecht@atlas_wasser","5,85"],
	["waterlaw-irrigation","ags_wasserrecht__wasserrecht@atlas_wasser","7"],
	["waterlaw-drainage","ags_wasserrecht__wasserrecht@atlas_wasser","6"],
	["rail-lines","ags_bahn","0,1,2,3"],
	["rail-hectometers","ags_bahn","4,5,6,7,8"],
	["danube-hectometers","ags_fliessgewaesser@atlas_wasser","14,15,16,17"],
	["river-network-with-km","ags_fliessgewaesser@atlas_wasser","62,63"],
	["alpine-convention","ags_naturschutz","13"],
	["compensation-presentation","ags_naturschutz_kompensationsflaechen","0,70"],
	["forest-esg-strudengau","ags_naturschutz_kompensationsflaechen","1"],
	["wlv-competence-points","ags_wildbach_lawinen_kataster@atlas_wasser","27"],
	["hora3-complete","ags_fliessgewaesser__abflusskennwerte@atlas_wasser","32,34"],
	["hora2-complete","ags_fliessgewaesser__abflusskennwerte@atlas_wasser","35,36"],
	["apg-substations-complete","ags_raumordnung__energie@atlas_raumordnung","100014,100021"],
	["dlm-substations-complete","ags_raumordnung__energie@atlas_raumordnung","100010,100011"]
];

function pngDimensions(bytes) {
	if (
		bytes.length < 24
		|| !bytes.subarray(0, 8).equals(
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
		)
	) return null;
	return {
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20)
	};
}

for (const [label, service, layers] of tests) {
	try {
		const params = new URLSearchParams({
			f: "bin",
			width: "256",
			height: "256",
			bbox,
			crs: "3857",
			hmac: "false",
			layers
		});
		const url = "https://atlas.noe.gv.at/atlas/api/rest/services/"
			+ encodeURIComponent(service)
			+ "/getmap?"
			+ params;
		const response = await fetch(url, {
			signal: AbortSignal.timeout(30000),
			headers: {
				"User-Agent": "Kartensammlung-NOE-final-atlas-audit/1.0"
			}
		});
		const bytes = Buffer.from(await response.arrayBuffer());
		const sha = crypto.createHash("sha256").update(bytes).digest("hex");
		console.log("ATLAS_REST_RESULT " + JSON.stringify({
			label,
			service,
			layers,
			status: response.status,
			contentType: response.headers.get("content-type"),
			bytes: bytes.length,
			sha,
			errorGraphic: sha === errorHash,
			dimensions: pngDimensions(bytes)
		}));
	} catch (error) {
		console.log("ATLAS_REST_ERROR " + JSON.stringify({
			label,
			service,
			layers,
			error: error.message
		}));
	}
}
