import {
	NOE_ATLAS_LEGACY_BASEMAPS,
	NOE_ATLAS_LEGACY_DATASETS,
	NOE_ATLAS_SPECIAL_QUERY_DATASETS
} from "./noe-atlas-overrides.mjs";

const TILE_OVERRIDES = Object.freeze({
	tc_gefahrenhinweiskarten_rutschprozesse: {
		id: "gefahrenhinweiskarten-rutschprozesse",
		name: "Gefahrenhinweiskarte – Rutschprozesse"
	},
	tc_gefahrenhinweiskarten_sturzprozesse: {
		id: "gefahrenhinweiskarten-sturzprozesse",
		name: "Gefahrenhinweiskarte – Sturzprozesse"
	},
	"tc_hangwasser@atlas_wasser": {
		id: "hangwasser-fliesswege-klassifiziert",
		name: "Hangwasser – Fließwege klassifiziert",
		queryDataset: "hangwasser-fliesswege"
	},
	tc_waldentwicklungsplan: {
		id: "waldentwicklungsplan",
		name: "Waldentwicklungsplan",
		queryDataset: "waldentwicklungsplan"
	}
});

const AUTO_EXCLUDED_IMAGE_SERVICES = new Set([
	"ags_adressen",
	"ags_dkm_grundstuecke",
	"ags_grundstuecke",
	"ags_flaechenwidmung@atlas_raumordnung",
	"wms_flaechenwidmung@atlas_raumordnung",
	"ags_fernerkundung__flugdaten",
	"ags_dkm_kataster__dkm_mappenblattschnitt",
	"ags_namensgut",
	"ags_naturschutz_projekte",
	"ags_oev___oev_gueteklassen",
	"ags_radwege__rad_basisnetz",
	"ags_raumordnung__geogene_gefahrenhinweiskarten@atlas_raumordnung",
	"ags_raumordnung__unesco_weltkulturerbe@atlas_raumordnung",
	"ags_raumordnung__zentrumszonen@atlas_raumordnung",
	"ags_strassen",
	"ags_strassen__gip",
	"ags_strassen_hektometer",
	"ags_verwaltungsgrenzen",
	"ags_wasserrecht__fliessgewaesser@atlas_wasser",
	"ags_hochwasser_hq@atlas_wasser",
	"ags_ragweed",
	"ags_landwirtschaft__weinbau_rieden_und_fluren",
	"ags_waldentwicklungsplan",
	"wms_iws__historische_karten",
	"wms_iws__luftbild_epochen",
	"wms_iws__luftbild_hoehe_oek",
	"wms_iws__oek",
	"wms_iws__hoehenmodell"
]);

const AUTO_EXCLUDED_PRESENTATION_NAMES = Object.freeze({
	ags_naturschutz: new Set([
		"Natura 2000 FFH Außengrenze",
		"Natura 2000 FFH Gemeldete Erweiterungsflächen",
		"Natura 2000 Vogelschutzgebiete",
		"Nationalpark Außengrenze",
		"Nationalpark Zonen",
		"Naturschutzgebiete",
		"Landschaftsschutzgebiete",
		"Naturparke",
		"Biosphärenpark Kernzonen",
		"Biosphärenpark Pflegezonen",
		"Biosphärenpark Wienerwald",
		"Ramsargebiete",
		"Regionen Naturschutzkonzept",
		"Vorkommensgebiete",
		"Naturdenkmäler"
	]),
	ags_radwege: new Set([
		"Förderschienen"
	])
});

const LEGACY_LAYER_COMPLETIONS = Object.freeze({
	"abfluss-hora3": ["32", "34"],
	"abfluss-hora2": ["35", "36"],
	"energie-uw-apg": ["100014", "100021"],
	"energie-uw-dlm": ["100010", "100011"],
	"schifffahrtsanlagen": ["10", "11"],
	"naturschutz-kompensationsflaechen": ["0", "70"],
	"fliessgewaesser-netz": ["62", "63"]
});

const AUTO_QUERY_OVERRIDES = Object.freeze({
	"ags_fliessgewaesser@atlas_wasser:donau_hektometer": [
		"donau_hektometer"
	]
});

const AUTO_NAME_OVERRIDES = Object.freeze({
	"wms_iws__luftbild_hoehe:Höhe (Seehöhe)": "Höhe – Seehöhe (DTM-Schummerung)",
	"wms_iws__luftbild_hoehe:Höhe (Oberfläche)": "Höhe – Oberfläche (DSM-Schummerung)",
	"wms_iws__luftbild_hoehe:Hangneigung (Prozent)": "Höhe – Hangneigung (Prozent)",
	"wms_iws__luftbild_hoehe:Hangneigung (Grad)": "Höhe – Hangneigung (Grad)",
	"hangwasser_hangneigung@atlas_wasser:Hangneigung <15%": "Hangwasser – Hangneigung <15 %",
	"ags_hochwasser@atlas_wasser:Risikogebiete gem. Hochwasser Richtlinie":
		"Hochwasser – Risikogebiete gemäß Hochwasserrichtlinie",
	"ags_fliessgewaesser@atlas_wasser:Donau Hektometer":
		"Fließgewässer – Donau-Hektometer",
	"ags_wildbach_lawinen_kataster@atlas_wasser:WLV Kompetenzpunkte":
		"Wildbach/Lawinen – WLV-Kompetenzpunkte",
	"ags_naturschutz:Alpenkonvention in NÖ":
		"Naturschutz – Alpenkonvention in NÖ"
});

const AUTO_BASEMAP_SERVICES = new Set([
	"wms_iws__historische_karten",
	"wms_iws__luftbild_epochen",
	"wms_iws__luftbild_hoehe"
]);

const AUTO_EXCLUDED_TILE_SERVICES = new Set([
	"tc_verwaltungsgrenzen",
	"tc_verwaltungsgrenzen_epsg31259"
]);

function detailService(detailsById, id) {
	const wrapper = detailsById?.[id];
	if (!wrapper) return null;
	if (wrapper?.id === id) return wrapper;
	return wrapper?.services?.find((item) => item?.id === id) || null;
}

function cleanText(value) {
	return String(value ?? "").trim();
}

function normalizeName(value) {
	return cleanText(value).replace(/\s+/g, " ");
}

function slug(value) {
	const normalized = String(value ?? "")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/@atlas_[a-z0-9_]+/g, "")
		.replace(/^(ags|wms|tc)_+/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 90);
	return normalized || "layer";
}

function uniqueStrings(values) {
	return [...new Set(
		(values || [])
			.map((value) => cleanText(value))
			.filter(Boolean)
	)];
}

function normalizeQueries(queries) {
	return (queries || [])
		.map((query) => ({
			service: cleanText(query?.service),
			query: cleanText(query?.query)
		}))
		.filter((query) => query.service && query.query);
}

function serviceLayerIds(detail) {
	return new Set(
		(detail?.layers || [])
			.map((layer) => cleanText(layer?.id))
			.filter(Boolean)
	);
}

function presentationLayerIds(detail, presentation) {
	const requested = Array.isArray(presentation?.layers)
		? presentation.layers.map((name) => String(name))
		: [];
	if (!requested.length) return [];

	const layers = Array.isArray(detail?.layers) ? detail.layers : [];
	const ids = [];
	for (const requestedName of requested) {
		for (const layer of layers) {
			if (String(layer?.name ?? "") === requestedName) {
				const id = cleanText(layer?.id);
				if (id) ids.push(id);
			}
		}
	}
	return uniqueStrings(ids);
}

function presentationReferencedLayerNames(detail) {
	const result = new Set();
	for (const presentation of detail?.presentations || []) {
		for (const layerName of presentation?.layers || []) {
			result.add(String(layerName));
		}
	}
	return result;
}

function presentationIsEmpty(presentation) {
	const name = normalizeName(presentation?.name);
	if (!name) return true;
	if (!Array.isArray(presentation?.layers) || !presentation.layers.length) return true;
	return /^(kein|keine|nicht sichtbar)\b/i.test(name);
}

function presentationAutoAllowed(serviceId, presentation) {
	const name = normalizeName(presentation?.name);
	if (!name) return false;

	if (AUTO_EXCLUDED_IMAGE_SERVICES.has(serviceId)) {
		return false;
	}
	if (serviceId === "wms_iws__luftbild_hoehe") {
		return new Set([
			"Höhe (Seehöhe)",
			"Höhe (Oberfläche)",
			"Hangneigung (Prozent)",
			"Hangneigung (Grad)"
		]).has(name);
	}
	const excludedNames = AUTO_EXCLUDED_PRESENTATION_NAMES[serviceId];
	if (excludedNames?.has(name)) return false;
	return true;
}

function autoDatasetName(detail, presentation) {
	const serviceId = cleanText(detail?.id);
	const presentationName = normalizeName(presentation?.name);
	const overridden = AUTO_NAME_OVERRIDES[
		serviceId + ":" + presentationName
	];
	if (overridden) return overridden;

	const serviceName = normalizeName(detail?.name);
	if (!serviceName) return presentationName;
	if (
		presentationName.localeCompare(serviceName, "de", {
			sensitivity: "base"
		}) === 0
		|| presentationName.toLowerCase().startsWith(
			serviceName.toLowerCase() + " "
		)
	) {
		return presentationName;
	}
	return serviceName + " – " + presentationName;
}

function autoQueries(detail, presentation, layerIds) {
	const result = [];
	const layerSet = new Set(layerIds);
	for (const query of detail?.queries || []) {
		const queryId = cleanText(query?.id);
		const queryLayerId = cleanText(query?.layerid);
		if (queryId && queryLayerId && layerSet.has(queryLayerId)) {
			result.push({
				service: cleanText(detail?.id),
				query: queryId
			});
		}
	}
	const overrideKey = cleanText(detail?.id)
		+ ":"
		+ cleanText(presentation?.id);
	for (const queryId of AUTO_QUERY_OVERRIDES[overrideKey] || []) {
		result.push({
			service: cleanText(detail?.id),
			query: queryId
		});
	}
	return normalizeQueries(result);
}

function validateQueryRefs(queries, detailsById, label) {
	for (const queryRef of normalizeQueries(queries)) {
		const detail = detailService(detailsById, queryRef.service);
		if (!detail) {
			throw new Error(
				"NÖ Atlas: Query-Service fehlt für "
				+ label
				+ ": "
				+ queryRef.service
			);
		}
		const exists = (detail.queries || []).some(
			(query) => cleanText(query?.id) === queryRef.query
		);
		if (!exists) {
			throw new Error(
				"NÖ Atlas: Query fehlt für "
				+ label
				+ ": "
				+ queryRef.service
				+ "/"
				+ queryRef.query
			);
		}
	}
}

function legacyDatasets(detailsById) {
	return NOE_ATLAS_LEGACY_DATASETS.map((source) => {
		const detail = detailService(detailsById, source.service);
		if (!detail || detail.type !== "image") {
			throw new Error(
				"NÖ Atlas: Legacy-Dienst fehlt oder ist verändert: "
				+ source.id
			);
		}
		const completed = LEGACY_LAYER_COMPLETIONS[source.id]
			|| source.layers;
		const queries = normalizeQueries(source.queries);
		validateQueryRefs(queries, detailsById, source.id);
		return {
			id: source.id,
			name: source.name,
			type: "image",
			service: source.service,
			layers: uniqueStrings(completed),
			queries,
			cache: Number(source.cache) || 86400,
			source: "legacy"
		};
	});
}

function datasetOverlapMap(datasets) {
	const byService = new Map();
	for (const dataset of datasets) {
		if (!byService.has(dataset.service)) {
			byService.set(dataset.service, []);
		}
		byService.get(dataset.service).push(
			new Set(dataset.layers || [])
		);
	}
	return byService;
}

function presentationRepresented(byService, serviceId, layerIds) {
	const existing = byService.get(serviceId) || [];
	return existing.some((set) => layerIds.some((id) => set.has(id)));
}

function autoDatasets(indexServices, detailsById, legacy) {
	const represented = datasetOverlapMap(legacy);
	const result = [];

	for (const indexed of indexServices) {
		if (
			indexed?.isbasemap === true
			|| indexed?.type !== "image"
		) {
			continue;
		}
		const detail = detailService(detailsById, indexed.id);
		if (!detail || detail.type !== "image") continue;

		for (const presentation of detail.presentations || []) {
			if (
				presentationIsEmpty(presentation)
				|| !presentationAutoAllowed(detail.id, presentation)
			) {
				continue;
			}
			const layerIds = presentationLayerIds(detail, presentation);
			if (!layerIds.length) continue;
			if (presentationRepresented(represented, detail.id, layerIds)) {
				continue;
			}

			const presentationId = cleanText(presentation?.id)
				|| slug(presentation?.name);
			const id = "auto-"
				+ slug(detail.id)
				+ "--"
				+ slug(presentationId);
			const dataset = {
				id,
				name: autoDatasetName(detail, presentation),
				type: "image",
				service: detail.id,
				layers: layerIds,
				queries: autoQueries(detail, presentation, layerIds),
				cache: 86400,
				source: "auto",
				presentationId
			};
			result.push(dataset);
			if (!represented.has(detail.id)) represented.set(detail.id, []);
			represented.get(detail.id).push(new Set(layerIds));
		}

		if (AUTO_EXCLUDED_IMAGE_SERVICES.has(detail.id)) {
			continue;
		}
		const referencedNames = presentationReferencedLayerNames(detail);
		for (const layer of detail.layers || []) {
			const layerName = String(layer?.name ?? "");
			const layerId = cleanText(layer?.id);
			if (
				!layerId
				|| referencedNames.has(layerName)
				|| layer?.selectable !== true
				|| !["point", "line", "polygon"].includes(
					cleanText(layer?.type)
				)
				|| /ADMINSTRK|Mappenblatt|Flugdatum|Beschriftung|Legende/i.test(
					layerName
				)
				|| presentationRepresented(
					represented,
					detail.id,
					[layerId]
				)
			) {
				continue;
			}
			const id = "auto-"
				+ slug(detail.id)
				+ "--layer-"
				+ slug(layerId);
			const pseudoPresentation = {
				id: "layer-" + layerId,
				name: layer?.tocname || layerName
			};
			result.push({
				id,
				name: autoDatasetName(detail, pseudoPresentation),
				type: "image",
				service: detail.id,
				layers: [layerId],
				queries: autoQueries(
					detail,
					pseudoPresentation,
					[layerId]
				),
				cache: 86400,
				source: "auto-layer",
				presentationId: null
			});
			if (!represented.has(detail.id)) represented.set(detail.id, []);
			represented.get(detail.id).push(new Set([layerId]));
		}
	}
	return result;
}

function validateLegacyBasemap(source, detailsById) {
	const detail = detailService(detailsById, source.service);
	if (!detail || detail.type !== "image") {
		throw new Error(
			"NÖ Atlas: Legacy-Basemap-Dienst fehlt oder ist verändert: "
			+ source.id
		);
	}
	return {
		id: source.id,
		name: source.name,
		category: source.category,
		service: source.service,
		layers: uniqueStrings(source.layers),
		cache: Number(source.cache) || 86400,
		source: "legacy"
	};
}

function autoBasemaps(indexServices, detailsById, legacyBasemaps) {
	const represented = datasetOverlapMap(legacyBasemaps);
	const result = [];
	for (const indexed of indexServices) {
		if (
			indexed?.type !== "image"
			|| !AUTO_BASEMAP_SERVICES.has(indexed?.id)
		) {
			continue;
		}
		const detail = detailService(detailsById, indexed.id);
		if (!detail) continue;
		for (const presentation of detail.presentations || []) {
			if (presentationIsEmpty(presentation)) continue;
			const name = normalizeName(presentation?.name);
			if (
				!/Luftbild|Falschfarben|Orthofoto|Vischer|Administrativ|Franzisco|Landesaufnahme|Karte/i.test(
					name
				)
			) {
				continue;
			}
			const layerIds = presentationLayerIds(detail, presentation);
			if (
				!layerIds.length
				|| presentationRepresented(
					represented,
					detail.id,
					layerIds
				)
			) {
				continue;
			}
			const presentationId = cleanText(presentation?.id)
				|| slug(name);
			const id = "auto-basemap-"
				+ slug(detail.id)
				+ "--"
				+ slug(presentationId);
			result.push({
				id,
				name,
				category: /aktuell/i.test(name)
					? "Luft- & Satellitenbilder"
					: "Historisch",
				service: detail.id,
				layers: layerIds,
				cache: /aktuell/i.test(name) ? 86400 : 604800,
				source: "auto",
				presentationId
			});
			if (!represented.has(detail.id)) represented.set(detail.id, []);
			represented.get(detail.id).push(new Set(layerIds));
		}
	}
	return result;
}

function safeTileTemplate(detail) {
	const template = cleanText(detail?.properties?.tileurl);
	if (!/^https:\/\/maps\.noe\.gv\.at\/tilecache\/bmap\/epsg3857\/[A-Za-z0-9_@.\-]+\/L\{z_\}\/R\{y_\}\/C\{x_\}\.png$/.test(template)) {
		return null;
	}
	return template;
}

function tileDefinitions(indexServices, detailsById) {
	const tiles = [];
	for (const indexed of indexServices) {
		if (
			indexed?.type !== "tile"
			|| indexed?.isbasemap === true
			|| AUTO_EXCLUDED_TILE_SERVICES.has(indexed?.id)
		) {
			continue;
		}
		const detail = detailService(detailsById, indexed.id);
		if (!detail || detail.type !== "tile") continue;
		const template = safeTileTemplate(detail);
		if (!template) {
			throw new Error(
				"NÖ Atlas: unbekanntes Kachelschema für "
				+ indexed.id
			);
		}
		const override = TILE_OVERRIDES[indexed.id];
		const id = override?.id
			|| "auto-tile-" + slug(indexed.id);
		tiles.push({
			id,
			service: indexed.id,
			name: override?.name || normalizeName(indexed.name),
			tileTemplate: template,
			queryDataset: override?.queryDataset || null,
			legend: detail.presentations?.find(
				(presentation) => cleanText(
					presentation?.thumbnail
				).startsWith("https://maps.noe.gv.at/")
			)?.thumbnail || null,
			copyright: cleanText(detail.copyrighttext).slice(0, 500),
			source: override ? "legacy" : "auto"
		});
	}
	return tiles;
}

function queryDatasetDefinitions(detailsById) {
	const result = {};
	for (const [id, queries] of Object.entries(
		NOE_ATLAS_SPECIAL_QUERY_DATASETS
	)) {
		const normalized = normalizeQueries(queries);
		validateQueryRefs(normalized, detailsById, id);
		result[id] = normalized;
	}
	return result;
}

function inventory(indexServices, detailsById) {
	return indexServices
		.filter((service) => service && typeof service.id === "string")
		.map((service) => {
			const detail = detailService(detailsById, service.id);
			return {
				id: service.id,
				name: normalizeName(service.name),
				type: cleanText(service.type),
				isbasemap: service.isbasemap === true,
				supportedCrs: service.supportedCrs || null,
				layerCount: Array.isArray(detail?.layers)
					? detail.layers.length
					: 0,
				presentationCount: Array.isArray(detail?.presentations)
					? detail.presentations.length
					: 0,
				queryCount: Array.isArray(detail?.queries)
					? detail.queries.length
					: 0
			};
		});
}

export const NOE_ATLAS_REQUIRED_DETAIL_IDS = null;

export function buildNoeAtlasCatalog(
	index,
	detailsById,
	generatedAt = new Date().toISOString()
) {
	const services = index?.services;
	if (!Array.isArray(services) || services.length < 30) {
		throw new Error(
			"NÖ Atlas: Diensteliste fehlt oder ist unplausibel kurz."
		);
	}

	for (const service of services) {
		if (
			!service?.id
			|| !detailService(detailsById, service.id)
		) {
			throw new Error(
				"NÖ Atlas: Detaildefinition fehlt für "
				+ String(service?.id || "?")
			);
		}
	}

	const legacy = legacyDatasets(detailsById);
	const automatic = autoDatasets(
		services,
		detailsById,
		legacy
	);
	const datasets = [...legacy, ...automatic]
		.sort((a, b) => a.name.localeCompare(
			b.name,
			"de",
			{ numeric: true, sensitivity: "base" }
		));

	const legacyBasemaps = NOE_ATLAS_LEGACY_BASEMAPS.map(
		(source) => validateLegacyBasemap(
			source,
			detailsById
		)
	);
	const basemaps = [
		...legacyBasemaps,
		...autoBasemaps(
			services,
			detailsById,
			legacyBasemaps
		)
	].sort((a, b) => a.name.localeCompare(
		b.name,
		"de",
		{ numeric: true, sensitivity: "base" }
	));

	const tiles = tileDefinitions(services, detailsById)
		.sort((a, b) => a.name.localeCompare(
			b.name,
			"de",
			{ numeric: true, sensitivity: "base" }
		));

	const counts = {
		total: services.length,
		imageOverlays: services.filter(
			(service) => (
				service?.type === "image"
				&& service?.isbasemap === false
			)
		).length,
		tileOverlays: services.filter(
			(service) => (
				service?.type === "tile"
				&& service?.isbasemap === false
			)
		).length,
		datasets: datasets.length,
		legacyDatasets: legacy.length,
		autoDatasets: automatic.length,
		queryableDatasets: datasets.filter(
			(dataset) => dataset.queries.length
		).length,
		basemaps: basemaps.length,
		autoBasemaps: basemaps.filter(
			(basemap) => basemap.source === "auto"
		).length,
		tiles: tiles.length
	};

	return {
		version: 2,
		generatedAt,
		source:
			"https://atlas.noe.gv.at/atlas/api/rest/services?f=json",
		counts,
		datasets,
		basemaps,
		tiles,
		queryDatasets: queryDatasetDefinitions(detailsById),
		inventory: inventory(services, detailsById)
	};
}
