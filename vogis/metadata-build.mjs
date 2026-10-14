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
const { parseVogisWms } = await import("./wms-lib.mjs");
// Metadata service records sometimes point at old endpoints and may have
// misleading titles. Verify their current WMS capabilities before reporting
// any additional layers. Only exact WMS layer identifiers count as duplicates.
const existingIds = new Set(
	Object.values(catalog.services)
		.flatMap(service => service.layers || [])
		.map(layer => String(layer.id).toLowerCase())
);
for (const candidate of audit.newServiceCandidates) {
	const endpoint = new URL(candidate.endpoint);
	const map = endpoint.searchParams.get("map");
	if (!map || !/^i_[a-z0-9_.-]+\.map$/i.test(map)) continue;
	const base = `${endpoint.origin}${endpoint.pathname}?map=${encodeURIComponent(map)}`;
	const cap = base + "&SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0";
	try {
		const response = await fetch(cap, {signal:AbortSignal.timeout(17000)});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = await response.text();
		if (body.length > 25000000) throw new Error("Capabilities too large");
		const parsed = parseVogisWms(body,{
			id:map.replace(/\.map$/i,""),
			title:candidate.title,
			url:base
		});
		const entries = parsed.layers.filter(l => l.id !== "MS");
		const unique = entries.filter(l => !existingIds.has(l.id.toLowerCase()));
		candidate.status = "available";
		candidate.endpoint = base;
		candidate.totalLayerEntries = entries.length;
		candidate.notAlreadyInSixWms = unique.length;
		candidate.exactIdOverlap = entries.length - unique.length;
		candidate.newLayerSamples = unique.slice(0,25).map(l=>({id:l.id,name:l.name}));
		console.log(`VoGIS candidate ${map}: ${entries.length} layers, ${unique.length} new IDs, ${entries.length-unique.length} duplicate IDs`);
	} catch(e) {
		candidate.status = "unavailable";
		candidate.reason = String(e.message || e).slice(0,180);
		console.warn(`VoGIS candidate ${map} unavailable: ${candidate.reason}`);
	}
}
audit.stats.reachableExtraServiceEndpoints = audit.newServiceCandidates.filter(x=>x.status==="available").length;
audit.stats.newLayerIdentifiersInExtraServices = audit.newServiceCandidates.reduce(
	(sum, entry)=>sum+(entry.notAlreadyInSixWms||0), 0
);
audit.note += " Zusätzliche WMS-Dienste werden über GetCapabilities geprüft; Überschneidungen beruhen ausschließlich auf identischen WMS-Layer-IDs, nicht auf geometrischer Datenäquivalenz.";
fs.mkdirSync(new URL("./build/", import.meta.url), {recursive:true});
fs.writeFileSync(new URL("./build/VogisMetadataAudit.json", import.meta.url), JSON.stringify(audit) + "\n");
console.log("VoGIS metadata audit statistics:", JSON.stringify(audit.stats));
console.log("Additional service endpoints:", JSON.stringify(audit.newServiceCandidates.slice(0,40)));
