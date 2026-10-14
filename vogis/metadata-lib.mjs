import { DOMParser } from "@xmldom/xmldom";

function direct(node, localName) {
	const children = [];
	for (let child = node?.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === 1 && (child.localName || child.nodeName) === localName) {
			children.push(child);
		}
	}
	return children;
}
function first(node, name) { return String(direct(node, name)[0]?.textContent || "").trim(); }
function all(node, name) { return direct(node, name).map(x => String(x.textContent || "").trim()).filter(Boolean); }
function xmlDocument(xml) {
	const failures = [];
	const doc = new DOMParser({errorHandler:{
		warning: () => {}, error: msg => failures.push(msg), fatalError: msg => failures.push(msg)
	}}).parseFromString(String(xml || ""), "text/xml");
	if (failures.length || !doc?.documentElement) {
		throw new Error(`GeoNetwork CSW: ungültiges XML: ${failures.join("; ")}`);
	}
	return doc;
}

export function parseCswSummaryPage(xml) {
	const doc = xmlDocument(xml);
	const root = doc.documentElement;
	if ((root.localName || root.nodeName) !== "GetRecordsResponse") {
		throw new Error("GeoNetwork CSW: keine GetRecordsResponse");
	}
	const results = direct(root, "SearchResults")[0];
	if (!results) throw new Error("GeoNetwork CSW: SearchResults fehlen");
	const matched = Number(results.getAttribute("numberOfRecordsMatched"));
	const next = Number(results.getAttribute("nextRecord"));
	if (!Number.isInteger(matched) || matched < 0 || !Number.isInteger(next) || next < 0) {
		throw new Error("GeoNetwork CSW: ungültige Seitenangaben");
	}
	const records = direct(results, "SummaryRecord").concat(direct(results, "Record")).map(node => ({
		id: first(node, "identifier"),
		title: first(node, "title"),
		type: first(node, "type").toLowerCase(),
		abstract: first(node, "abstract"),
		subjects: all(node, "subject"),
		formats: all(node, "format")
	})).filter(r => /^[a-f\d-]{36}$/i.test(r.id) && r.title);
	return {matched, next, returned: Number(results.getAttribute("numberOfRecordsReturned")), records};
}

export function parseCswFullRecordLinks(xml) {
	const document = xmlDocument(xml);
	const results = [];
	for (const node of Array.from(document.getElementsByTagName("*"))) {
		if ((node.localName || node.nodeName) !== "URL") continue;
		const value = String(node.textContent || "").trim();
		try {
			const u = new URL(value);
			if (["http:", "https:"].includes(u.protocol) && u.hostname === "vogis.cnv.at") {
				results.push(value);
			}
		} catch (_) { /* Not an external URL. */ }
	}
	return [...new Set(results)].sort((a,b) => a.localeCompare(b, "de"));
}

export function keyOf(value) {
	return String(value || "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/^(?:vogis|vowis):/i, "")
		.replace(/[^a-z0-9]+/g, "");
}

export function extractSourceName(abstract) {
	const match = String(abstract || "").match(/\bdatenquelle\s*:\s*([\p{L}\d_.-]+)\.(?:shp|ecw|tif|tiff|gpkg)\b/iu);
	return match ? keyOf(match[1]) : null;
}

function serviceToken(url) {
	try {
		const input = new URL(url);
		if (input.hostname !== "vogis.cnv.at") return null;
		const map = input.searchParams.get("map");
		if (/\/mapserver\/mapserv\/?$/i.test(input.pathname) && map && /^[a-z0-9_.-]+$/i.test(map)) {
			return `mapserver:${map.toLowerCase()}`;
		}
		if (/\/geoserver\/vogis(?:\/|$)/.test(input.pathname)) return "geoserver:vogis";
	} catch (_) {}
	return null;
}

export function buildVogisMetadataAudit(records, catalog, linksByRecord = {}, options = {}) {
	if (!Array.isArray(records) || !catalog?.services) {
		throw new Error("VoGIS Metadatenabgleich: Kataloge fehlen");
	}
	const index = new Map();
	const layers = [];
	for (const [serviceId, service] of Object.entries(catalog.services)) {
		for (const layer of service.layers || []) {
			if (!layer?.id || layer.id === "MS") continue;
			const ref = `${serviceId}:${layer.id}`;
			layers.push(ref);
			for (const name of [layer.id, layer.name]) {
				const normalized = keyOf(name);
				if (!normalized) continue;
				if (!index.has(normalized)) index.set(normalized, new Set());
				index.get(normalized).add(ref);
			}
		}
	}
	const matches = [];
	const matchedLayerRefs = new Set();
	const serviceRecords = [];
	const unmatched = [];
	for (const record of records) {
		if (record.type === "service") {
			serviceRecords.push(record);
			continue;
		}
		const keys = [
			{key: extractSourceName(record.abstract), reason: "Datenquelle"},
			{key: keyOf(record.title), reason: "Titel"}
		].filter(x => x.key);
		let candidates = [];
		let reason = "";
		for (const pair of keys) {
			if (index.has(pair.key)) {
				candidates = [...index.get(pair.key)].sort();
				reason = pair.reason;
				break;
			}
		}
		if (candidates.length) {
			matches.push({id: record.id, title: record.title, reason, layers: candidates});
			for (const ref of candidates) matchedLayerRefs.add(ref);
		} else {
			unmatched.push({id: record.id, title: record.title, format: record.formats.join(", ")});
		}
	}
	const knownServiceTokens = new Set(Object.values(catalog.services).map(s => serviceToken(s.url)).filter(Boolean));
	const extra = new Map();
	for (const record of serviceRecords) {
		for (const url of linksByRecord[record.id] || []) {
			const token = serviceToken(url);
			if (!token || knownServiceTokens.has(token) || extra.has(token)) continue;
			extra.set(token, {title:record.title, metadataId:record.id, endpoint:url, status:"not yet verified"});
		}
	}
	const serviceDetailsRead = Object.keys(linksByRecord).length;
	return {
		version: 1,
		source: "https://vogis.cnv.at/geonetwork/srv/eng/csw",
		note: "Nur sichere Zuordnungen über exakten normalisierten Titel oder Dateinamen hinter 'Datenquelle:'. Nicht zugeordnete Metadaten sind nicht automatisch fehlende WMS-Ebenen. Endpunktkandidaten sind ungetestet.",
		stats: {
			metadataTotal: records.length,
			serviceRecords: serviceRecords.length,
			metadataServicesDetailed: serviceDetailsRead,
			metadataServicesNotDetailed: Math.max(0, serviceRecords.length - serviceDetailsRead),
			datasetRecords: records.length - serviceRecords.length,
			catalogLayers: layers.length,
			matchedDatasetRecords: matches.length,
			matchedLayerEntries: matchedLayerRefs.size,
			unmatchedDatasetRecords: unmatched.length,
			candidateAdditionalServiceEndpoints: extra.size
		},
		newServiceCandidates: [...extra.values()].sort((a,b)=>a.endpoint.localeCompare(b.endpoint)),
		serviceRecords: serviceRecords.map(r=>({
			id:r.id,title:r.title,
			onlineResources:linksByRecord[r.id] || [],
			checked:Object.hasOwn(linksByRecord, r.id)
		})).sort((a,b)=>a.title.localeCompare(b.title,"de")),
		matches: matches.sort((a,b)=>a.title.localeCompare(b.title,"de")),
		unmatchedDatasetSample: unmatched.sort((a,b)=>a.title.localeCompare(b.title,"de")).slice(0,100)
	};
}
