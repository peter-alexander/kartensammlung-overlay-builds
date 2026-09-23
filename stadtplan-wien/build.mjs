import fs from "node:fs";
import {
	MAIN_STYLE_URL,
	isAllowedMtkUrl,
	resolveUrl,
	isValidStyleJson,
	isValidTileJson,
	normalizeTileJsonUrls,
	isValidSpriteJson,
	isValidPng,
	safeFileName,
	shortHash,
	stableJson,
	makeReleaseId
} from "./lib.mjs";

const BUILD_ROOT = new URL("./build/", import.meta.url);

async function fetchMtk(url, options = {}) {
	const attempts = options.attempts ?? 3;
	const timeoutMs = options.timeoutMs ?? 30000;
	const binary = options.binary === true;
	const accept = options.accept ?? "*/*";
	let lastError = null;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		let currentUrl = url;

		try {
			for (let redirect = 0; redirect <= 3; redirect++) {
				if (!isAllowedMtkUrl(currentUrl)) {
					throw new Error("Nicht erlaubte Maptoolkit-URL: " + currentUrl);
				}

				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), timeoutMs);

				let response;
				try {
					response = await fetch(currentUrl, {
						redirect: "manual",
						signal: controller.signal,
						headers: {
							Accept: accept,
							"User-Agent": "Kartensammlung Stadtplan-Wien snapshot builder"
						}
					});
				} finally {
					clearTimeout(timer);
				}

				if (response.status >= 300 && response.status < 400) {
					const location = response.headers.get("location");
					if (!location) {
						throw new Error("Redirect ohne Location bei " + currentUrl);
					}

					const nextUrl = resolveUrl(currentUrl, location);
					if (!nextUrl || !isAllowedMtkUrl(nextUrl)) {
						throw new Error("Nicht erlaubtes Redirect-Ziel: " + location);
					}

					currentUrl = nextUrl;
					continue;
				}

				if (!response.ok) {
					throw new Error("HTTP " + response.status + " bei " + currentUrl);
				}

				return binary
					? Buffer.from(await response.arrayBuffer())
					: await response.text();
			}

			throw new Error("Zu viele Redirects bei " + url);
		} catch (error) {
			lastError = error;

			if (attempt < attempts) {
				await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
			}
		}
	}

	throw lastError;
}

function parseJson(raw, label) {
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(label + ": ungültiges JSON: " + error.message);
	}
}

function writeFile(fileUrl, content) {
	fs.mkdirSync(new URL("./", fileUrl), { recursive: true });
	fs.writeFileSync(fileUrl, content);
}

console.log("Lade Stadtplan-Wien-Style ...");
const rawStyle = await fetchMtk(MAIN_STYLE_URL, {
	accept: "application/json,*/*;q=0.8"
});
const upstreamStyle = parseJson(rawStyle, "Stadtplan-Wien-Style");

if (!isValidStyleJson(upstreamStyle)) {
	throw new Error("Stadtplan-Wien-Style hat keine gültige Style-Struktur.");
}

const sourceArtifacts = [];
const sourceOutputs = new Map();

for (const [sourceName, source] of Object.entries(upstreamStyle.sources)) {
	if (!source || typeof source !== "object" || Array.isArray(source)) continue;
	if (typeof source.url !== "string" || source.url === "") continue;

	const remoteUrl = resolveUrl(MAIN_STYLE_URL, source.url);
	if (!remoteUrl || !isAllowedMtkUrl(remoteUrl)) continue;

	console.log("Lade Source-TileJSON: " + sourceName);
	const rawTileJson = await fetchMtk(remoteUrl, {
		accept: "application/json,*/*;q=0.8"
	});
	const tileJson = parseJson(rawTileJson, "Source " + sourceName);

	if (!isValidTileJson(tileJson)) {
		throw new Error("Source " + sourceName + ": ungültiges TileJSON.");
	}

	const normalized = normalizeTileJsonUrls(tileJson, remoteUrl);
	const normalizedRaw = stableJson(normalized);
	const fileName = safeFileName(sourceName) + "-" + shortHash(remoteUrl) + ".json";

	sourceArtifacts.push([
		"source:" + sourceName + ":" + remoteUrl,
		Buffer.from(normalizedRaw, "utf8")
	]);

	sourceOutputs.set(sourceName, {
		fileName,
		content: normalizedRaw + "\n",
		remoteUrl
	});
}

if (sourceOutputs.size === 0) {
	throw new Error("Stadtplan-Wien-Style enthält keine lokalisierten Maptoolkit-Sources.");
}

let sprite = null;
const spriteArtifacts = [];

if (typeof upstreamStyle.sprite === "string" && upstreamStyle.sprite !== "") {
	const spriteUrl = resolveUrl(MAIN_STYLE_URL, upstreamStyle.sprite);

	if (!spriteUrl || !isAllowedMtkUrl(spriteUrl)) {
		throw new Error("Unerwartete Sprite-URL: " + upstreamStyle.sprite);
	}

	sprite = {
		baseUrl: spriteUrl,
		files: []
	};

	for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) {
		const fileUrl = spriteUrl + suffix;
		console.log("Lade Sprite: " + suffix);

		const binary = suffix.endsWith(".png");
		const raw = await fetchMtk(fileUrl, {
			binary,
			accept: binary
				? "image/png,*/*;q=0.8"
				: "application/json,*/*;q=0.8"
		});

		if (binary) {
			if (!isValidPng(raw)) {
				throw new Error("Ungültiges Sprite-PNG: " + suffix);
			}
		} else {
			const json = parseJson(raw, "Sprite " + suffix);
			if (!isValidSpriteJson(json)) {
				throw new Error("Ungültiges Sprite-JSON: " + suffix);
			}
		}

		const content = binary ? raw : Buffer.from(raw, "utf8");
		sprite.files.push({
			name: "sprite" + suffix,
			content
		});
		spriteArtifacts.push([
			"sprite:" + suffix,
			content
		]);
	}
}

const releaseParts = [
	["style:upstream", Buffer.from(rawStyle, "utf8")],
	...sourceArtifacts,
	...spriteArtifacts
];

const releaseId = makeReleaseId(releaseParts);
const releaseRoot = new URL("./build/releases/" + releaseId + "/", import.meta.url);
const sourceRoot = new URL("./sources/", releaseRoot);

fs.rmSync(BUILD_ROOT, { recursive: true, force: true });
fs.mkdirSync(sourceRoot, { recursive: true });

const style = structuredClone(upstreamStyle);
style.metadata = {
	...(style.metadata && typeof style.metadata === "object" && !Array.isArray(style.metadata)
		? style.metadata
		: {}),
	"ks:source": "wien-stadtplan",
	"ks:release": releaseId
};

for (const [sourceName, output] of sourceOutputs) {
	style.sources[sourceName].url =
		"/Maps/StadtplanWien/releases/" + releaseId + "/sources/" + output.fileName;

	writeFile(
		new URL(output.fileName, sourceRoot),
		output.content
	);
}

if (sprite) {
	style.sprite = "/Maps/StadtplanWien/releases/" + releaseId + "/sprite";

	for (const file of sprite.files) {
		writeFile(
			new URL(file.name, releaseRoot),
			file.content
		);
	}
}

if (typeof style.glyphs === "string" && style.glyphs !== "") {
	const glyphsUrl = resolveUrl(MAIN_STYLE_URL, style.glyphs);
	if (glyphsUrl) {
		style.glyphs = glyphsUrl;
	}
}

if (!isValidStyleJson(style)) {
	throw new Error("Erzeugter lokaler Stadtplan-Wien-Style ist ungültig.");
}

const styleRaw = JSON.stringify(style) + "\n";
writeFile(new URL("./build/style.json", import.meta.url), styleRaw);
writeFile(new URL("./build/release-id.txt", import.meta.url), releaseId + "\n");

const manifest = {
	version: 1,
	release: releaseId,
	upstreamStyle: MAIN_STYLE_URL,
	sourceCount: sourceOutputs.size,
	hasLocalSprite: Boolean(sprite),
	files: [
		...Array.from(sourceOutputs.values()).map((item) => "sources/" + item.fileName),
		...(sprite ? sprite.files.map((file) => file.name) : [])
	].sort()
};

writeFile(
	new URL("./manifest.json", releaseRoot),
	JSON.stringify(manifest, null, "\t") + "\n"
);

console.log(
	"Stadtplan Wien: Release " + releaseId + ", " +
	sourceOutputs.size + " Source-TileJSONs, " +
	(sprite ? "Sprites lokal." : "kein Sprite.")
);
