import fs from "node:fs";
import { parseCswSummaryPage, parseCswFullRecordLinks, buildVogisMetadataAudit } from "./metadata-lib.mjs";

const root = "https://vogis.cnv.at/geonetwork/srv/eng/csw";
const maxRecords = 100;
const catalog = JSON.parse(fs.readFileSync(new URL("./build/VogisCatalog.json", import.meta.url), "utf8"));
const metadata = [];
const ids = new Set();
let startPosition = 1;
let matched = 0;
for (let page = 0; page < 20; page++) {
	const query = new URLSearchParams({
		SERVICE:"CSW",VERSION:"2.0.2",REQUEST:"GetRecords",
		resultType:"results",typeNames:"csw:Record",
		elementSetName:"summary",maxRecords:String(maxRecords),
		startPosition:String(startPosition)
	});
	const response = await fetch(root + "?" + query, {signal:AbortSignal.timeout(30000)});
	if (!response.ok) throw new Error(`CSW GetRecords HTTP ${response.status}`);
	const payload = await response.text();
	if (payload.length > 10000000) throw new Error("CSW response too large");
	const result = parseCswSummaryPage(payload);
	matched = result.matched;
	console.log(`VoGIS CSW page ${page + 1}: ${result.records.length} records / ${matched}; next ${result.next}`);
	if (!result.records.length && matched > metadata.length) throw new Error("CSW did not return expected metadata records");
	for (const record of result.records) if (!ids.has(record.id)) {
		ids.add(record.id);
		metadata.push(record);
	}
	if (result.next === 0) break;
	if (result.next <= startPosition) throw new Error("CSW pagination did not advance");
	startPosition = result.next;
}
if (metadata.length !== matched) {
	throw new Error(`CSW truncated: received ${metadata.length}/${matched} records`);
}
const serviceRecords = metadata.filter(r=>r.type === "service" && (
	/wms|wmts|mapserver|kartendienst|web map service/i.test(
		r.title + " " + r.formats.join(" ") + " " + r.subjects.join(" ")
	)
));
const maxDetail = 30;
console.log(`VoGIS CSW: ${metadata.length} total records, ${metadata.filter(r=>r.type==="service").length} services, ${serviceRecords.length} WMS/WMTS service candidates; reading up to ${maxDetail} detailed service records`);
const onlineById = {};
for (const record of serviceRecords.slice(0,maxDetail)) {
	const query = new URLSearchParams({
		SERVICE:"CSW", VERSION:"2.0.2",REQUEST:"GetRecordById",
		id: record.id, elementSetName:"full",
		outputSchema:"http://www.isotc211.org/2005/gmd"
	});
	try {
		const response = await fetch(root + "?" + query, {signal:AbortSignal.timeout(18000)});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const responseXml = await response.text();
		onlineById[record.id] = parseCswFullRecordLinks(responseXml);
	} catch (e) {
		console.warn(`CSW GetRecordById ${record.id}: ${e.message}`);
	}
}
const audit = buildVogisMetadataAudit(metadata, catalog, onlineById);
fs.mkdirSync(new URL("./build/", import.meta.url), {recursive:true});
fs.writeFileSync(new URL("./build/VogisMetadataAudit.json", import.meta.url), JSON.stringify(audit) + "\n");
console.log("VoGIS metadata audit statistics:", JSON.stringify(audit.stats));
console.log("Additional service endpoints:", JSON.stringify(audit.newServiceCandidates.slice(0,40)));
