const response = await fetch("https://fahrrad.lima-city.de/Maps/ServerNames/NoeCatalog.json", {
	signal: AbortSignal.timeout(15000),
	headers: { Accept: "application/json" }
});
if (!response.ok) throw new Error("HTTP " + response.status);
const catalog = await response.json();
const terms = [
	"rad", "lkw", "dienst", "kranken", "bezirk", "abfluss", "gewässer",
	"grundwasser", "hangwasser", "landwirt", "luft", "natur", "energie",
	"widmung", "wasser", "wein", "wildbach", "lawine", "wald", "unesco",
	"tierseuche", "fischerei", "bahn", "straße", "strasse", "adresse",
	"verwaltung"
];
const rows = (catalog.layers || []).filter((layer) => {
	const text = (String(layer.name || "") + " " + String(layer.title || "")).toLowerCase();
	return terms.some((term) => text.includes(term));
}).map((layer) => ({
	name: layer.name,
	title: layer.title,
	wfs: layer.wfs === true
}));
console.log("NOE_OGD_RELEVANT " + JSON.stringify(rows));
