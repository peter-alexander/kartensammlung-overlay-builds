import test from "node:test";
import assert from "node:assert/strict";
import { parseCswSummaryPage, parseCswFullRecordLinks, extractSourceName, buildVogisMetadataAudit } from "./metadata-lib.mjs";

const xml = `<?xml version="1.0"?><csw:GetRecordsResponse xmlns:csw="http://www.opengis.net/cat/csw/2.0.2" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dct="http://purl.org/dc/terms/"><csw:SearchResults numberOfRecordsMatched="2" numberOfRecordsReturned="2" nextRecord="0"><csw:SummaryRecord>
<dc:identifier>809755df-a9da-4500-a753-5497c71f09f4</dc:identifier>
<dc:title>Politische Bezirke Vorarlbergs</dc:title><dc:type>dataset</dc:type><dct:abstract>Datenquelle: politische_bezirke.shp</dct:abstract></csw:SummaryRecord>
<csw:SummaryRecord><dc:identifier>bdeb2637-a498-43ee-a3c6-281b41ba4e38</dc:identifier><dc:title>WMS Höhenschichtenlinien</dc:title><dc:type>service</dc:type><dc:format>WMS</dc:format></csw:SummaryRecord></csw:SearchResults></csw:GetRecordsResponse>`;
test("parse paged CSW summary metadata and extract source identifiers", () => {
	const page = parseCswSummaryPage(xml);
	assert.equal(page.matched, 2);
	assert.equal(page.records.length, 2);
	assert.equal(page.records[0].type,"dataset");
	assert.equal(extractSourceName(page.records[0].abstract),"politischebezirke");
});
test("parse ISO19139 service online URLs", () => {
	const links = parseCswFullRecordLinks(`<gmd:MD_Metadata xmlns:gmd="http://www.isotc211.org/2005/gmd"><gmd:URL>https://vogis.cnv.at/mapserver/mapserv?map=i_extra.map&amp;service=wms</gmd:URL><gmd:URL>https://example.com/url</gmd:URL></gmd:MD_Metadata>`);
	assert.equal(links.length,1);
	assert.match(links[0], /i_extra\.map/);
});
test("audit reports direct file-name matches and nonintegrated service endpoint candidates", () => {
	const page = parseCswSummaryPage(xml);
	const catalog = {services:{themen:{url:"https://vogis.cnv.at/geoserver/vogis/wms",
		layers:[{id:"politische_bezirke",name:"politische_bezirke"}]}}};
	const audit=buildVogisMetadataAudit(page.records,catalog,{
		"bdeb2637-a498-43ee-a3c6-281b41ba4e38":["https://vogis.cnv.at/mapserver/mapserv?map=i_extra.map&service=wms"]
	});
	assert.equal(audit.stats.matchedDatasetRecords,1);
	assert.equal(audit.stats.candidateAdditionalServiceEndpoints,1);
	assert.equal(audit.newServiceCandidates[0].status,"not yet verified");
});
test("invalid XML must not be interpreted as empty catalog", () => {
	assert.throws(()=>parseCswSummaryPage("<html>down</html>"),/GetRecordsResponse/);
});
