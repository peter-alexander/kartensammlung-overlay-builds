import test from "node:test";
import assert from "node:assert/strict";
import { buildNoeAtlasCatalog } from "./noe-atlas-catalog.mjs";
import {
	NOE_ATLAS_LEGACY_BASEMAPS,
	NOE_ATLAS_LEGACY_DATASETS,
	NOE_ATLAS_SPECIAL_QUERY_DATASETS
} from "./noe-atlas-overrides.mjs";

function fixture() {
	const services = new Map();

	function ensure(id, type = "image", isbasemap = false) {
		if (!services.has(id)) {
			services.set(id, {
				id,
				name: id,
				type,
				isbasemap,
				supportedCrs: [3857],
				layers: [],
				presentations: [],
				queries: [],
				properties: {}
			});
		}
		return services.get(id);
	}

	for (const dataset of NOE_ATLAS_LEGACY_DATASETS) {
		const service = ensure(dataset.service);
		for (const id of dataset.layers) {
			if (!service.layers.some((layer) => String(layer.id) === String(id))) {
				service.layers.push({
					id: String(id),
					name: dataset.id + " " + id,
					type: "polygon",
					selectable: true
				});
			}
		}
		for (const queryRef of dataset.queries || []) {
			const queryService = ensure(queryRef.service);
			if (!queryService.queries.some((query) => query.id === queryRef.query)) {
				queryService.queries.push({
					id: queryRef.query,
					name: queryRef.query,
					layerid: queryService.layers[0]?.id || "query"
				});
			}
		}
	}

	for (const basemap of NOE_ATLAS_LEGACY_BASEMAPS) {
		const service = ensure(basemap.service);
		for (const id of basemap.layers) {
			if (!service.layers.some((layer) => String(layer.id) === String(id))) {
				service.layers.push({
					id: String(id),
					name: basemap.id + " " + id,
					type: "image",
					selectable: false
				});
			}
		}
	}

	for (const queries of Object.values(NOeSpecial())) {
		for (const queryRef of queries) {
			const service = ensure(queryRef.service);
			if (!service.queries.some((query) => query.id === queryRef.query)) {
				service.queries.push({
					id: queryRef.query,
					name: queryRef.query,
					layerid: service.layers[0]?.id || "query"
				});
			}
		}
	}

	const dienststellen = ensure("ags_dienststellen");
	if (!dienststellen.layers.some((layer) => layer.id === "16")) {
		dienststellen.layers.push({
			id: "16",
			name: "Krankenhaus",
			type: "point",
			selectable: true
		});
	}
	dienststellen.presentations.push({
		id: "dv_krankenhaus",
		name: "Krankenhaus",
		layers: ["Krankenhaus"]
	});
	dienststellen.queries.push({
		id: "krankenhaus",
		name: "Krankenhaus",
		layerid: "16"
	});

	const discovered = ensure("ags_new_theme");
	discovered.name = "Neues Fachthema";
	discovered.layers.push({
		id: "7",
		name: "Neue Fläche",
		type: "polygon",
		selectable: true
	});
	discovered.presentations.push({
		id: "neue_flaeche",
		name: "Neue Fläche",
		layers: ["Neue Fläche"]
	});
	discovered.queries.push({
		id: "neue_flaeche",
		name: "Neue Fläche",
		layerid: "7"
	});

	const duplicate = ensure("ags_radwege__rad_basisnetz");
	duplicate.layers.push({
		id: "0",
		name: "RBN NÖ",
		type: "line",
		selectable: true
	});
	duplicate.presentations.push({
		id: "dv_rbn_noe",
		name: "RBN NÖ",
		layers: ["RBN NÖ"]
	});

	for (const [id, path] of [
		["tc_gefahrenhinweiskarten_rutschprozesse", "gefahrenhinweiskarten_rutschprozesse"],
		["tc_gefahrenhinweiskarten_sturzprozesse", "gefahrenhinweiskarten_sturzprozesse"],
		["tc_hangwasser@atlas_wasser", "hangwasser"],
		["tc_waldentwicklungsplan", "waldentwicklungsplan"]
	]) {
		const service = ensure(id, "tile");
		service.name = id;
		service.layers = [{
			id: "0",
			name: id,
			type: "image",
			selectable: false
		}];
		service.properties.tileurl =
			"https://maps.noe.gv.at/tilecache/bmap/epsg3857/"
			+ path
			+ "/L{z_}/R{y_}/C{x_}.png";
	}

	const indexServices = [...services.values()].map((service) => ({
		id: service.id,
		name: service.name,
		type: service.type,
		isbasemap: service.isbasemap,
		supportedCrs: service.supportedCrs
	}));
	while (indexServices.length < 31) {
		const id = "filler_" + indexServices.length;
		const filler = ensure(id);
		indexServices.push({
			id,
			name: id,
			type: "image",
			isbasemap: false,
			supportedCrs: [3857]
		});
	}

	const details = Object.fromEntries(
		[...services].map(([id, service]) => [
			id,
			{ services: [structuredClone(service)] }
		])
	);
	for (const indexed of indexServices) {
		if (!details[indexed.id]) {
			details[indexed.id] = {
				services: [{
					...indexed,
					layers: [],
					presentations: [],
					queries: [],
					properties: {}
				}]
			};
		}
	}
	return {
		index: { services: indexServices },
		details
	};
}

function NOeSpecial() {
	return NOE_ATLAS_SPECIAL_QUERY_DATASETS;
}

test("Atlas catalog keeps legacy ids and auto-discovers new presentations", () => {
	const { index, details } = fixture();
	const catalog = buildNoeAtlasCatalog(
		index,
		details,
		"2026-10-16T00:00:00Z"
	);

	assert.equal(catalog.version, 2);
	assert.equal(catalog.counts.legacyDatasets, 95);
	assert.equal(catalog.counts.basemaps, 19);
	assert.equal(catalog.counts.tiles, 4);
	assert.ok(catalog.counts.autoDatasets >= 2);

	const bh = catalog.datasets.find((dataset) => dataset.id === "bh");
	assert.equal(bh.name, "Bezirkshauptmannschaften");

	const hora3 = catalog.datasets.find(
		(dataset) => dataset.id === "abfluss-hora3"
	);
	assert.deepEqual(hora3.layers, ["32", "34"]);

	assert.ok(catalog.datasets.some(
		(dataset) => (
			dataset.service === "ags_new_theme"
			&& dataset.source === "auto"
		)
	));
	assert.ok(catalog.datasets.some(
		(dataset) => (
			dataset.service === "ags_dienststellen"
			&& dataset.name.includes("Krankenhaus")
			&& dataset.source === "auto"
		)
	));
	assert.equal(
		catalog.datasets.some(
			(dataset) => dataset.service === "ags_radwege__rad_basisnetz"
		),
		false
	);
	assert.equal(
		catalog.queryDatasets["hangwasser-fliesswege"][0].query,
		"fliesswege_akkumuliert_2018"
	);
	assert.equal(
		catalog.queryDatasets.waldentwicklungsplan.length,
		5
	);
});

test("Atlas catalog fails closed for incomplete scans and forged tile templates", () => {
	const { index, details } = fixture();
	const missing = structuredClone(details);
	delete missing[index.services[0].id];
	assert.throws(
		() => buildNoeAtlasCatalog(index, missing),
		/Detaildefinition fehlt/
	);

	const forged = structuredClone(details);
	forged.tc_waldentwicklungsplan.services[0].properties.tileurl =
		"https://evil.example/L{z_}/R{y_}/C{x_}.png";
	assert.throws(
		() => buildNoeAtlasCatalog(index, forged),
		/unbekanntes Kachelschema/
	);
});
