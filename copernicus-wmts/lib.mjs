import { DOMParser } from "@xmldom/xmldom";

function children(element, localName) {
	const result = [];

	for (let node = element?.firstChild; node; node = node.nextSibling) {
		if (
			node.nodeType === 1 &&
			String(node.localName || node.nodeName).toLowerCase() === localName.toLowerCase()
		) {
			result.push(node);
		}
	}

	return result;
}

function childText(element, localName) {
	return String(children(element, localName)[0]?.textContent || "").trim();
}

function allElements(doc, localName) {
	const result = [];
	const nodes = doc.getElementsByTagName("*");

	for (let index = 0; index < nodes.length; index++) {
		const node = nodes.item(index);
		if (
			node &&
			String(node.localName || node.nodeName).toLowerCase() === localName.toLowerCase()
		) {
			result.push(node);
		}
	}

	return result;
}

function sortObject(value) {
	return Object.fromEntries(
		Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en", {
			numeric: true,
			sensitivity: "base"
		}))
	);
}

function makeClientKey(value) {
	let key = String(value || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/gi, "_")
		.replace(/^_+|_+$/g, "");

	if (!key) key = "layer";
	return `cop_${key}`;
}

function uniqueKey(baseKey, usedKeys) {
	let key = baseKey;
	let suffix = 2;

	while (usedKeys.has(key)) {
		key = `${baseKey}_${suffix++}`;
	}

	usedKeys.add(key);
	return key;
}

function defaultStyle(layer) {
	const styles = children(layer, "Style");

	if (!styles.length) {
		return {
			identifier: "default",
			title: null
		};
	}

	let fallback = null;

	for (const style of styles) {
		const current = {
			identifier: childText(style, "Identifier") || "default",
			title: childText(style, "Title") || null
		};

		if (!fallback) fallback = current;

		const isDefault = String(style.getAttribute("isDefault") || "").trim().toLowerCase();
		if (isDefault === "true" || isDefault === "1") {
			return current;
		}
	}

	return fallback || {
		identifier: "default",
		title: null
	};
}

function tileMatrixSetLinks(layer) {
	return [...new Set(
		children(layer, "TileMatrixSetLink")
			.map((link) => childText(link, "TileMatrixSet"))
			.filter(Boolean)
	)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function preferredMatrixSet(sets) {
	for (const candidate of [
		"PopularWebMercator256",
		"PopularWebMercator512",
		"WebMercatorQuad"
	]) {
		if (sets.includes(candidate)) return candidate;
	}

	return sets[0] || null;
}

function preferredFormat(formats) {
	for (const candidate of [
		"image/png",
		"image/jpeg",
		"image/tiff"
	]) {
		if (formats.includes(candidate)) return candidate;
	}

	return formats[0] || null;
}

function resourceTemplate(layer, resourceType) {
	for (const resource of children(layer, "ResourceURL")) {
		const type = String(resource.getAttribute("resourceType") || "").trim();
		if (type.toLowerCase() !== resourceType.toLowerCase()) continue;

		const template = String(resource.getAttribute("template") || "").trim();
		if (!template) continue;

		return {
			template,
			format: String(resource.getAttribute("format") || "").trim() || null,
			resourceType: type
		};
	}

	return null;
}

function hasTimeDimension(layer) {
	return children(layer, "Dimension").some(
		(dimension) => childText(dimension, "Identifier").toLowerCase() === "time"
	);
}

export function parseCopernicusCapabilities(xml) {
	const errors = [];
	const doc = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: (message) => errors.push(message),
			fatalError: (message) => errors.push(message)
		}
	}).parseFromString(String(xml || ""), "application/xml");

	if (!doc?.documentElement || errors.length) {
		throw new Error(`Copernicus WMTS: ungültiges XML: ${errors.join("; ")}`);
	}

	const contents = allElements(doc, "Contents")[0];
	if (!contents) {
		throw new Error("Copernicus WMTS: Contents fehlt.");
	}

	const tileMatrixSets = {};

	for (const matrixSet of children(contents, "TileMatrixSet")) {
		const identifier = childText(matrixSet, "Identifier");
		if (!identifier) continue;

		tileMatrixSets[identifier] = {
			identifier,
			supportedCRS: childText(matrixSet, "SupportedCRS") || null,
			wellKnownScaleSet: childText(matrixSet, "WellKnownScaleSet") || null,
			tileMatrices: children(matrixSet, "TileMatrix")
				.map((matrix) => childText(matrix, "Identifier"))
				.filter(Boolean)
		};
	}

	const layers = {};
	const usedKeys = new Set();

	for (const layer of children(contents, "Layer")) {
		const wmtsLayer = childText(layer, "Identifier");
		if (!wmtsLayer) continue;

		const title = childText(layer, "Title");
		const abstract = childText(layer, "Abstract");
		const formats = [...new Set(
			children(layer, "Format")
				.map((format) => String(format.textContent || "").trim())
				.filter(Boolean)
		)];
		const style = defaultStyle(layer);
		const matrixSets = tileMatrixSetLinks(layer);
		const key = uniqueKey(makeClientKey(wmtsLayer), usedKeys);

		const item = {
			key,
			name: title || wmtsLayer,
			wmtsLayer,
			style: style.identifier,
			styleTitle: style.title,
			formats,
			format: preferredFormat(formats),
			tileMatrixSets: matrixSets,
			defaultTileMatrixSet: preferredMatrixSet(matrixSets),
			hasTimeDimension: hasTimeDimension(layer)
		};

		if (abstract) item.abstract = abstract;

		const tileTemplate = resourceTemplate(layer, "tile");
		if (tileTemplate) item.resourceTemplate = tileTemplate;

		const infoTemplate = resourceTemplate(layer, "FeatureInfo");
		if (infoTemplate) item.featureInfoTemplate = infoTemplate;

		layers[key] = item;
	}

	const sortedLayers = sortObject(layers);
	const sortedMatrixSets = sortObject(tileMatrixSets);

	return {
		meta: {
			source: "copernicus_wmts_getcapabilities",
			generated: new Date().toISOString(),
			count: Object.keys(sortedLayers).length,
			tileMatrixSetCount: Object.keys(sortedMatrixSets).length
		},
		tileMatrixSets: sortedMatrixSets,
		layers: sortedLayers
	};
}
