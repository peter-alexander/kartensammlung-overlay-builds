export const IMAGERY_DIRECTORY = "https://gis.stmk.gv.at/image/rest/services/OGD_DOP";
const ROOT = "https://gis.stmk.gv.at/image/rest/services/OGD_DOP/";

function idFor(name) {
	return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function discoverSteiermarkImagery(directory) {
	if (directory?.error || !Array.isArray(directory?.services)) {
		throw new Error("Steiermark Bilddienste: ungültiges OGD_DOP-Verzeichnis");
	}
	const seen = new Set();
	const services = [];
	for (const entry of directory.services) {
		if (entry?.type !== "ImageServer" || !/^OGD_DOP\/[a-z0-9_.-]+$/i.test(entry.name || "")) continue;
		const name = entry.name.slice("OGD_DOP/".length);
		const id = idFor(name);
		if (seen.has(id)) throw new Error("Steiermark Bilddienste: doppelte Dienst-ID");
		seen.add(id);
		services.push({
			id,
			title: name.replaceAll("_", " ").trim(),
			url: `${ROOT}${encodeURIComponent(name)}/ImageServer`,
			category: /akt(?:uell)?\b/i.test(name) ? "Luft- & Satellitenbilder" : "Historisch"
		});
	}
	if (!services.length) throw new Error("Steiermark Bilddienste: keine OGD-ImageServer gefunden");
	return services.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildSteiermarkImageryCatalog(services, results) {
	if (!Array.isArray(services) || !services.length || !Array.isArray(results) || results.length !== services.length) {
		throw new Error("Steiermark Bilddienste: unvollständige Metadaten");
	}
	for (let i = 0; i < services.length; i++) {
		if (results[i]?.error || !results[i]?.extent || !results[i]?.pixelSizeX) {
			throw new Error(`Steiermark Bilddienst ${services[i].id}: Bilddienst nicht bestätigt`);
		}
	}
	return { version: 1, services };
}
