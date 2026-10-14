import { normalizeTirisService } from "./catalog.mjs";

export const IMAGERY_SERVICES = Object.freeze([
	Object.freeze({
		id: "orthofoto",
		title: "Orthofotos",
		url: "https://gis.tirol.gv.at/arcgis/rest/services/Service_Public/orthofoto/MapServer"
	}),
	Object.freeze({
		id: "terrain",
		title: "Gelände & Höhenmodelle",
		url: "https://gis.tirol.gv.at/arcgis/rest/services/Service_Public/terrain/MapServer"
	})
]);

const normalize = (value) => String(value || "")
	.toLowerCase()
	.normalize("NFD")
	.replace(/[\u0300-\u036f]/g, "")
	.replace(/ae/g, "a").replace(/oe/g, "o");

export function classifyTirisImageryLayer(serviceId, layer) {
	const title = [layer?.name, ...(layer?.path || [])].join(" ");
	const text = normalize(title);
	if (serviceId === "orthofoto") {
		const current = /aktuell|current/.test(text);
		const infrared = /(?:^|[^a-z])cir(?:[^a-z]|$)|infrarot/.test(text);
		const historical = !current && (/histor|19\d{2}|20\d{2}|altaufnahme|archiv|schwarzweiß|sw\b/.test(text)
			|| !/befliegungszeitpunkt|aufnahmejahr|datum|deckung|abdeckung/.test(text));
		// ArcGIS mosaics contain FlightYear/Footprint siblings.
		// Only "Image_*" is the actual raster; historic groups are often just year ranges.
		const usable = /^image[_ -]/.test(normalize(layer?.name));
		return {
			usable,
			category: historical ? "Historisch" : "Luft- & Satellitenbilder",
			name: layer.name,
			current,
			infrared
		};
	}
	const hillshade = /schummer|hillshade|relief/.test(text);
	// Exclude technical Boundary/Footprint sublayers of every raster mosaic.
	const usable = /^image[_ -]/.test(normalize(layer?.name))
		|| /^(hohen|hohen|hohen)schichtlinien/.test(normalize(layer?.name));
	return {
		usable,
		category: hillshade ? "Hintergrundkarten" : "Österreich",
		name: layer.name,
		hillshade
	};
}

export function buildTirisImageryCatalog(results) {
	if (!Array.isArray(results) || results.length !== IMAGERY_SERVICES.length) {
		throw new Error("tiris Bilddienste: unvollständige Antworten");
	}
	const services = {};
	for (let i = 0; i < results.length; i++) {
		const descriptor = IMAGERY_SERVICES[i];
		const normalized = normalizeTirisService(descriptor, results[i]);
		normalized.layers = normalized.layers
			.map(layer => ({
				...layer,
				...classifyTirisImageryLayer(descriptor.id, layer)
			}))
			.filter(layer => layer.usable);
		if (!normalized.layers.length) {
			throw new Error(`tiris ${descriptor.id}: keine nutzbaren Bildebenen gefunden`);
		}
		services[descriptor.id] = normalized;
	}
	return {
		version: 1,
		attribution: "Datenquelle: Land Tirol - data.tirol.gv.at",
		services
	};
}
