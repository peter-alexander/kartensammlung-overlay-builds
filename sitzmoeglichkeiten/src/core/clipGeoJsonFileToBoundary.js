import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseFeatureCollectionText(text, label) {
	if (!text || !text.trim()) {
		throw new Error(`${label} ist leer.`);
	}

	let json;

	try {
		json = JSON.parse(text);
	} catch (err) {
		throw new Error(`${label} ist kein gültiges JSON: ${err?.message || String(err)}`);
	}

	if (!json || json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
		throw new Error(`${label} ist keine GeoJSON-FeatureCollection.`);
	}

	return json;
}

function runCommand(bin, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, {
			stdio: 'inherit',
			shell: false
		});

		child.once('error', (err) => {
			if (err?.code === 'ENOENT') {
				reject(new Error(`${bin} wurde nicht gefunden.`));
				return;
			}

			reject(err);
		});

		child.once('exit', (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`${bin} exited with code ${code}`));
		});
	});
}

async function resolveBoundaryFile({
	boundaryUrl = null,
	boundaryFile = null,
	tmpDir
}) {
	if (boundaryFile) {
		return path.resolve(boundaryFile);
	}

	if (!boundaryUrl) {
		throw new Error('Es wurde weder boundaryFile noch boundaryUrl angegeben.');
	}

	const response = await fetch(boundaryUrl, {
		headers: {
			accept: 'application/geo+json, application/json;q=0.9, */*;q=0.8'
		}
	});

	if (!response.ok) {
		throw new Error(`Wien-Grenze konnte nicht geladen werden (HTTP ${response.status}).`);
	}

	const text = await response.text();
	parseFeatureCollectionText(text, 'Wien-Grenze');

	const resolvedBoundaryFile = path.join(tmpDir, 'boundary.geojson');
	await writeFile(resolvedBoundaryFile, text, 'utf8');

	return resolvedBoundaryFile;
}

export async function clipGeoJsonFileToBoundary({
	inputFile,
	boundaryUrl = null,
	boundaryFile = null,
	strict = false,
	ogr2ogrBin = 'ogr2ogr',
	logger = console
}) {
	if (!inputFile) {
		throw new Error('inputFile fehlt.');
	}

	const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ks-boundary-clip-'));
	const clippedFile = path.join(tmpDir, 'clipped.geojson');

	try {
		const resolvedBoundaryFile = await resolveBoundaryFile({
			boundaryUrl,
			boundaryFile,
			tmpDir
		});

		const args = [
			'-f',
			'GeoJSON',
			'-overwrite',
			'-clipsrc',
			resolvedBoundaryFile,
			'-explodecollections',
			clippedFile,
			inputFile
		];

		logger?.info?.(`Starte Wien-Clip via GDAL: ${ogr2ogrBin} ${args.join(' ')}`);

		await runCommand(ogr2ogrBin, args);

		const text = await readFile(clippedFile, 'utf8');
		const featureCollection = parseFeatureCollectionText(text, 'GDAL-Clip-Output');

		return {
			skipped: false,
			featureCollection,
			outputFeatureCount: featureCollection.features.length,
			boundarySource: boundaryFile ? path.resolve(boundaryFile) : boundaryUrl
		};
	} catch (err) {
		logger?.error?.(err?.stack || String(err));

		if (strict) {
			throw err;
		}

		logger?.warn?.(`Boundary clip übersprungen: ${err?.message || String(err)}`);

		const text = await readFile(inputFile, 'utf8');
		const featureCollection = parseFeatureCollectionText(text, 'Eingabe-GeoJSON');

		return {
			skipped: true,
			featureCollection,
			outputFeatureCount: featureCollection.features.length,
			boundarySource: boundaryFile ? path.resolve(boundaryFile) : boundaryUrl
		};
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
}
