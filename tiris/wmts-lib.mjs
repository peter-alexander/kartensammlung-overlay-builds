import { DOMParser } from "@xmldom/xmldom";

const WANTED = new Map([
	["gdi_base_summer", { category: "Karten", name: "Sommerkarte Tirol" }],
	["gdi_base_winter", { category: "Karten", name: "Winterkarte Tirol" }],
	["gdi_base_ortho", { category: "Luft- & Satellitenbilder", name: "Orthofoto Tirol" }]
]);

function children(node, name) {
	const list = [];
	for (let child = node?.firstChild; child; child = child.nextSibling) {
		if (child.nodeType === 1 && String(child.localName || child.nodeName) === name) {
			list.push(child);
		}
	}
	return list;
}

function first(node, name) {
	return children(node, name)[0] || null;
}

function value(node, name) {
	return String(first(node, name)?.textContent || "").trim();
}

function parseMatrixSet(element) {
	const name = value(element, "Identifier");
	if (!name || !/EPSG:?3857|googlemapscompatible|webmercator/i.test(
		`${name} ${value(element, "SupportedCRS")}`
	)) return null;
	const crs = value(element, "SupportedCRS");
	if (!/3857|900913/i.test(crs)) return null;
	const matrices = children(element, "TileMatrix").map((matrix) => ({
		id: value(matrix, "Identifier"),
		width: Number(value(matrix, "MatrixWidth")),
		height: Number(value(matrix, "MatrixHeight")),
		tileWidth: Number(value(matrix, "TileWidth")),
		tileHeight: Number(value(matrix, "TileHeight"))
	}));
	if (!matrices.length) return null;
	const ids = matrices.map((entry) => entry.id);
	const prefix = ids[0].replace(/0$/, "");
	if (!ids.every((id, i) => id === `${prefix}${i}`)) return null;
	if (!matrices.every((m, i) => (
		m.width === 2 ** i && m.height === 2 ** i
		&& m.tileWidth === matrices[0].tileWidth
		&& m.tileHeight === matrices[0].tileHeight
	))) return null;
	if (![256, 512].includes(matrices[0].tileWidth)
		|| matrices[0].tileHeight !== matrices[0].tileWidth) return null;
	return {
		name,
		prefix,
		tileSize: matrices[0].tileWidth,
		maxzoom: matrices.length - 1
	};
}

export function buildTirisWmtsCatalog(xml, baseUrl = "https://wmts.kartetirol.at/wmts") {
	const errors = [];
	const doc = new DOMParser({
		errorHandler: {
			warning: () => {},
			error: (message) => errors.push(message),
			fatalError: (message) => errors.push(message)
		}
	}).parseFromString(xml, "application/xml");
	if (!doc?.documentElement || errors.length) {
		throw new Error(`tiris WMTS: ungültige Capabilities: ${errors.join("; ")}`);
	}
	const contents = Array.from(doc.getElementsByTagName("*")).find(
		(node) => node.localName === "Contents"
	);
	if (!contents) throw new Error("tiris WMTS: Contents fehlt");
	const matrixSets = new Map(children(contents, "TileMatrixSet")
		.map(parseMatrixSet)
		.filter(Boolean)
		.map((entry) => [entry.name, entry]));
	const result = [];
	for (const layer of children(contents, "Layer")) {
		const id = value(layer, "Identifier");
		const known = WANTED.get(id);
		if (!known) continue;
		const usable = children(layer, "TileMatrixSetLink")
			.map((node) => matrixSets.get(value(node, "TileMatrixSet")))
			.find(Boolean);
		if (!usable) continue;
		const styles = children(layer, "Style");
		const defaultStyle = styles.find((style) => style.getAttribute("isDefault") === "true")
			|| styles[0];
		const styleId = value(defaultStyle, "Identifier") || "default";
		const formats = children(layer, "Format").map((node) => String(node.textContent).trim());
		const format = formats.includes("image/png") ? "image/png" : formats.find(x => x === "image/jpeg");
		if (!format) continue;
		const resource = children(layer, "ResourceURL")
			.find((node) => node.getAttribute("resourceType") === "tile"
				&& node.getAttribute("format") === format);
		let url = String(resource?.getAttribute("template") || "");
		if (url) {
			url = url
				.replaceAll("{Style}", encodeURIComponent(styleId))
				.replaceAll("{TileMatrixSet}", encodeURIComponent(usable.name))
				.replaceAll("{TileMatrix}", `${usable.prefix}{z}`)
				.replaceAll("{TileRow}", "{y}")
				.replaceAll("{TileCol}", "{x}");
		} else {
			const params = new URLSearchParams({
				service: "WMTS", request: "GetTile", version: "1.0.0",
				layer: id, style: styleId, format,
				tilematrixset: usable.name
			});
			url = `${baseUrl}?${params}&tilematrix=${encodeURIComponent(usable.prefix)}{z}&tilerow={y}&tilecol={x}`;
		}
		if (!/^https:\/\//.test(url)
			|| !url.includes("{z}") || !url.includes("{x}") || !url.includes("{y}")) continue;
		result.push({
			id, name: known.name, cat: known.category,
			url, tileSize: usable.tileSize, maxzoom: usable.maxzoom,
			matrixSet: usable.name
		});
	}
	if (!result.some((entry) => entry.id === "gdi_base_summer")) {
		throw new Error("tiris WMTS: keine kompatible Sommerkarte (EPSG:3857)");
	}
	return { version: 1, layers: result.sort((a, b) => a.id.localeCompare(b.id)) };
}
