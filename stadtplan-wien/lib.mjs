import crypto from "node:crypto";

export const MTK_HOST = "mtk.wien.gv.at";
export const MAIN_STYLE_URL = "https://mtk.wien.gv.at/styles/wien/stadtplan.json";

export function isAllowedMtkUrl(value) {
	let url;

	try {
		url = new URL(value);
	} catch {
		return false;
	}

	return (
		url.protocol === "https:" &&
		url.hostname.toLowerCase() === MTK_HOST &&
		(url.port === "" || url.port === "443") &&
		url.username === "" &&
		url.password === ""
	);
}

export function resolveUrl(baseUrl, reference) {
	try {
		return new URL(reference, baseUrl).href
			.replaceAll("%7B", "{")
			.replaceAll("%7D", "}");
	} catch {
		return null;
	}
}

export function isValidStyleJson(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if (!value.sources || typeof value.sources !== "object" || Array.isArray(value.sources)) return false;
	if (!Array.isArray(value.layers)) return false;

	for (const source of Object.values(value.sources)) {
		if (!source || typeof source !== "object" || Array.isArray(source)) return false;
	}

	for (const layer of value.layers) {
		if (!layer || typeof layer !== "object" || Array.isArray(layer)) return false;
		if (Object.hasOwn(layer, "paint") && (
			!layer.paint ||
			typeof layer.paint !== "object" ||
			Array.isArray(layer.paint)
		)) {
			return false;
		}
		if (Object.hasOwn(layer, "layout") && (
			!layer.layout ||
			typeof layer.layout !== "object" ||
			Array.isArray(layer.layout)
		)) {
			return false;
		}
	}

	return true;
}

export function isValidTileJson(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if (!Array.isArray(value.tiles) || value.tiles.length === 0) return false;
	return value.tiles.every((url) => typeof url === "string" && url !== "");
}

export function normalizeTileJsonUrls(tileJson, remoteUrl) {
	const result = structuredClone(tileJson);

	for (const property of ["tiles", "grids"]) {
		if (!Array.isArray(result[property])) continue;

		result[property] = result[property].map((value) => {
			if (typeof value !== "string") return value;
			return resolveUrl(remoteUrl, value) || value;
		});
	}

	return result;
}

export function isValidSpriteJson(value) {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isValidPng(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length < 24) return false;
	return buffer.subarray(0, 8).equals(
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	);
}

export function safeFileName(value) {
	const base = String(value || "")
		.normalize("NFKD")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.toLowerCase();

	return base || "source";
}

export function shortHash(value, length = 12) {
	return crypto.createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function stableJson(value) {
	if (Array.isArray(value)) {
		return "[" + value.map(stableJson).join(",") + "]";
	}

	if (value && typeof value === "object") {
		const keys = Object.keys(value).sort();
		return "{" + keys.map((key) => (
			JSON.stringify(key) + ":" + stableJson(value[key])
		)).join(",") + "}";
	}

	return JSON.stringify(value);
}

export function makeReleaseId(parts) {
	const hash = crypto.createHash("sha256");
	hash.update("kartensammlung-stadtplan-wien-v1\0");

	for (const [name, content] of parts) {
		hash.update(name);
		hash.update("\0");
		hash.update(content);
		hash.update("\0");
	}

	return hash.digest("hex").slice(0, 20);
}
