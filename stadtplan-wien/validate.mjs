import fs from "node:fs";
import path from "node:path";
import {
	isValidStyleJson,
	isValidTileJson,
	isValidSpriteJson,
	isValidPng
} from "./lib.mjs";

const buildRoot = new URL("./build/", import.meta.url);
const styleFile = new URL("./build/style.json", import.meta.url);
const releaseIdFile = new URL("./build/release-id.txt", import.meta.url);

function fail(message) {
	throw new Error(message);
}

const releaseId = fs.readFileSync(releaseIdFile, "utf8").trim();
if (!/^[a-f0-9]{20}$/.test(releaseId)) {
	fail("Ungültige Release-ID: " + releaseId);
}

const releaseRoot = new URL("./build/releases/" + releaseId + "/", import.meta.url);
const style = JSON.parse(fs.readFileSync(styleFile, "utf8"));

if (!isValidStyleJson(style)) {
	fail("Erzeugter Style ist strukturell ungültig.");
}

if (style?.metadata?.["ks:source"] !== "wien-stadtplan") {
	fail("ks:source-Metadatum fehlt.");
}

if (style?.metadata?.["ks:release"] !== releaseId) {
	fail("ks:release stimmt nicht mit release-id.txt überein.");
}

let localSourceCount = 0;

for (const [sourceName, source] of Object.entries(style.sources)) {
	if (!source || typeof source !== "object" || Array.isArray(source)) continue;
	if (typeof source.url !== "string") continue;

	const prefix = "/Maps/StadtplanWien/releases/" + releaseId + "/sources/";
	if (!source.url.startsWith(prefix)) continue;

	localSourceCount++;

	const fileName = source.url.slice(prefix.length);
	if (!fileName || fileName.includes("/") || fileName.includes("..")) {
		fail("Ungültiger lokaler Source-Dateiname bei " + sourceName + ": " + fileName);
	}

	const localFile = new URL("./sources/" + fileName, releaseRoot);
	if (!fs.existsSync(localFile)) {
		fail("Lokales TileJSON fehlt für " + sourceName + ": " + fileName);
	}

	const tileJson = JSON.parse(fs.readFileSync(localFile, "utf8"));
	if (!isValidTileJson(tileJson)) {
		fail("Lokales TileJSON ist ungültig: " + sourceName);
	}

	for (const tileUrl of tileJson.tiles) {
		if (!/^https:\/\//.test(tileUrl)) {
			fail("PBF-URL ist nicht absolut: " + tileUrl);
		}
		if (/%7B|%7D/i.test(tileUrl)) {
			fail("PBF-Template enthält URL-kodierte Klammern: " + tileUrl);
		}
		if (!/\{z\}|\{TileMatrix\}/.test(tileUrl)) {
			fail("PBF-Template enthält keinen Zoom-Platzhalter: " + tileUrl);
		}
	}
}

if (localSourceCount < 1) {
	fail("Style enthält keine lokalisierten Source-TileJSONs.");
}

const expectedSpriteBase = "/Maps/StadtplanWien/releases/" + releaseId + "/sprite";

if (style.sprite !== expectedSpriteBase) {
	fail("Style verweist nicht auf das lokale Release-Sprite.");
}

for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) {
	const file = new URL("./sprite" + suffix, releaseRoot);
	if (!fs.existsSync(file)) {
		fail("Sprite-Datei fehlt: sprite" + suffix);
	}

	if (suffix.endsWith(".json")) {
		const json = JSON.parse(fs.readFileSync(file, "utf8"));
		if (!isValidSpriteJson(json)) {
			fail("Sprite-JSON ist ungültig: sprite" + suffix);
		}
	} else if (!isValidPng(fs.readFileSync(file))) {
		fail("Sprite-PNG ist ungültig: sprite" + suffix);
	}
}

if (
	typeof style.glyphs === "string" &&
	style.glyphs.startsWith("/Maps/StadtplanWien/")
) {
	fail("Glyphs wurden unerwartet lokalisiert.");
}

const manifestFile = new URL("./manifest.json", releaseRoot);
if (!fs.existsSync(manifestFile)) {
	fail("Release-Manifest fehlt.");
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
if (manifest.release !== releaseId) {
	fail("Manifest-Release stimmt nicht überein.");
}

console.log(
	"Stadtplan-Wien snapshot validiert: " +
	localSourceCount + " lokale Source-TileJSONs, Sprites vollständig, PBFs weiterhin remote."
);
