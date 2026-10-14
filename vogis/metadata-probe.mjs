// Probe live GeoNetwork CSW on the official Vorarlberg domain. Intentionally
// informational until service response formats have been confirmed.
const servers = [
	"https://vogis.cnv.at/geonetwork/srv/eng/csw",
	"https://vogis.cnv.at/geonetwork/srv/ger/csw"
];
for (const base of servers) {
	const url = base + "?" + new URLSearchParams({
		SERVICE: "CSW", VERSION: "2.0.2", REQUEST: "GetRecords",
		resultType: "results", typeNames: "csw:Record",
		elementSetName: "summary", outputFormat: "application/xml",
		maxRecords: "2", startPosition: "1"
	});
	try {
		const response = await fetch(url, {signal: AbortSignal.timeout(14000)});
		const body = await response.text();
		console.log("VoGIS CSW probe:", base, "HTTP", response.status,
			"Content-Type", response.headers.get("content-type"),
			"Length", body.length,
			"Matched", body.match(/numberOfRecordsMatched="([^"]+)"/)?.[1] ?? "?");
		console.log("CSW excerpt:", body.slice(0,3000).replace(/\s+/g," "));
	} catch (e) {
		console.log("VoGIS CSW probe failed:", base, String(e.message || e));
	}
}
