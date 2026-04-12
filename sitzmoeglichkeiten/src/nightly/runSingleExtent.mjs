import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';

import { fromLonLat } from 'ol/proj.js';

import { runBenchAnalysisNode } from '../adapters/nodeRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
	bounds4326: {
		// Hier deinen korrigierten Extent eintragen
		//ZL12 Testkachel
		/*
		minLon: 16.34765625,
		minLat: 48.166085419012525,
		maxLon: 16.435546875,
		maxLat: 48.2246726495652
		*/
		//Wien 4 Z11-Kacheln
		minLon: 16.171875,
		minLat: 48.1074311884804,
		maxLon: 16.59375,
		maxLat: 48.34164617237459
	},

	overpass: {
		maxRounds: 4,
		retryDelaysMs: [90_000, 180_000, 300_000],
		requestTimeoutMs: 60_000
	},
	
	analysis: {
		includeBenches: false,
		options: {
			pad: 50,
			benchSearchRadius: 20,
			simplifyTolerance: 8,
			thresholds: [25, 50, 75],
			step: 10
		}
	},

	output: {
		dir: path.resolve(process.env.KS_OUTPUT_DIR || path.resolve(process.cwd(), 'out')),
		baseName: process.env.KS_BASENAME || 'wien-sitzdistanz',
		writeGeoJson: process.env.KS_WRITE_GEOJSON === '1',
		keepGeoJsonAfterTippecanoe: process.env.KS_KEEP_GEOJSON_AFTER_TIPPECANOE === '1',
		writeManifest: process.env.KS_WRITE_MANIFEST !== '0'
	},

	tippecanoe: {
		enabled: process.env.KS_ENABLE_TIPPECANOE !== '0',
		bin: process.env.TIPPECANOE_BIN || 'tippecanoe',

		exportPmtiles: process.env.KS_EXPORT_PMTILES !== '0',
		exportTileDirectory: process.env.KS_EXPORT_TILE_DIR !== '0',
		tileDirectoryName: 'tiles',
		cleanTileDirectoryBeforeExport: true,

		layer: 'sitzdistanz',
		name: 'Wien Sitzdistanz',
		description: 'Nightly generated accessibility tiles for seating opportunities in Vienna',
		attribution: null,
		force: true,
		minZoom: null,
		maxZoom: 14,
		guessMaxZoom: false,
		dropDensestAsNeeded: true,
		extendZoomsIfStillDropping: true,
		extraArgs: [
			'-y', 'color',
			'-y', 'roadType'
		]
	}
};

function bounds4326ToExtent3857(bounds) {
	const bl = fromLonLat([bounds.minLon, bounds.minLat], 'EPSG:3857');
	const tr = fromLonLat([bounds.maxLon, bounds.maxLat], 'EPSG:3857');

	return [
		bl[0],
		bl[1],
		tr[0],
		tr[1]
	];
}

function buildOutputPaths(config) {
	const geojsonFile = path.join(config.output.dir, `${config.output.baseName}.geojson`);
	const pmtilesFile = path.join(config.output.dir, `${config.output.baseName}.pmtiles`);
	const tileDirectory = path.join(config.output.dir, config.tippecanoe.tileDirectoryName);
	const manifestFile = path.join(config.output.dir, `${config.output.baseName}.manifest.json`);

	return {
		geojsonFile,
		pmtilesFile,
		tileDirectory,
		manifestFile
	};
}

function buildTippecanoeArgs(config, geojsonFile, target) {
	const args = [];
	const tip = config.tippecanoe;

	if (tip.force) {
		args.push('-f');
	}

	if (target.type === 'pmtiles') {
		args.push('-o', target.file);
	} else if (target.type === 'directory') {
		args.push('-e', target.dir);
	} else {
		throw new Error(`Unbekannter tippecanoe-Target-Typ: ${target.type}`);
	}

	if (tip.layer) {
		args.push('-l', tip.layer);
	}

	if (tip.name) {
		args.push('-n', tip.name);
	}

	if (tip.description) {
		args.push('-N', tip.description);
	}

	if (tip.attribution) {
		args.push('-A', tip.attribution);
	}

	if (tip.minZoom != null) {
		args.push('-Z', String(tip.minZoom));
	}

	if (tip.maxZoom != null) {
		args.push('-z', String(tip.maxZoom));
	} else if (tip.guessMaxZoom) {
		args.push('-zg');
	}

	if (tip.dropDensestAsNeeded) {
		args.push('--drop-densest-as-needed');
	}

	if (tip.extendZoomsIfStillDropping) {
		args.push('--extend-zooms-if-still-dropping');
	}

	if (Array.isArray(tip.extraArgs) && tip.extraArgs.length) {
		args.push(...tip.extraArgs);
	}

	args.push(geojsonFile);

	return args;
}

async function runCommand(bin, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, {
			stdio: 'inherit',
			shell: false
		});

		child.once('error', reject);

		child.once('exit', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${bin} exited with code ${code}`));
			}
		});
	});
}

async function writeManifest(file, data) {
	await writeFile(file, JSON.stringify(data, null, '\t'), 'utf8');
}

async function main() {
	const startedAt = new Date();
	const startedMs = Date.now();

	await mkdir(CONFIG.output.dir, { recursive: true });

	const extent3857 = bounds4326ToExtent3857(CONFIG.bounds4326);
	const paths = buildOutputPaths(CONFIG);

	if (extent3857[0] === extent3857[2] || extent3857[1] === extent3857[3]) {
		throw new Error(`Degenerierter Extent: ${JSON.stringify(extent3857)}`);
	}

	console.log('Starte Analyse...');
	console.log('extent3857:', extent3857);

	const analysisStartedMs = Date.now();

	const geojson = await runBenchAnalysisNode({
		extent3857,
		includeBenches: CONFIG.analysis.includeBenches,
		options: CONFIG.analysis.options,
		overpass: CONFIG.overpass,
		logger: console
	});

	const analysisFinishedMs = Date.now();

	console.log(`Analyse fertig in ${((analysisFinishedMs - analysisStartedMs) / 1000).toFixed(1)} s`);

	const willRunTippecanoe =
		CONFIG.tippecanoe.enabled &&
		(CONFIG.tippecanoe.exportPmtiles || CONFIG.tippecanoe.exportTileDirectory);

	const mustWriteGeoJsonFile = CONFIG.output.writeGeoJson || willRunTippecanoe;

	if (mustWriteGeoJsonFile) {
		console.log(`Schreibe GeoJSON: ${paths.geojsonFile}`);
		await writeFile(paths.geojsonFile, JSON.stringify(geojson), 'utf8');
	}

	if (willRunTippecanoe && CONFIG.tippecanoe.exportPmtiles) {
		const args = buildTippecanoeArgs(CONFIG, paths.geojsonFile, {
			type: 'pmtiles',
			file: paths.pmtilesFile
		});

		console.log(`Starte tippecanoe (PMTiles): ${CONFIG.tippecanoe.bin} ${args.join(' ')}`);

		const started = Date.now();
		await runCommand(CONFIG.tippecanoe.bin, args);
		const finished = Date.now();

		console.log(`PMTiles fertig in ${((finished - started) / 1000).toFixed(1)} s`);
		console.log(`PMTiles: ${paths.pmtilesFile}`);
	}

	if (willRunTippecanoe && CONFIG.tippecanoe.exportTileDirectory) {
		if (CONFIG.tippecanoe.cleanTileDirectoryBeforeExport) {
			console.log(`Lösche Tile-Ordner: ${paths.tileDirectory}`);
			await rm(paths.tileDirectory, { recursive: true, force: true });
		}

		await mkdir(paths.tileDirectory, { recursive: true });

		const args = buildTippecanoeArgs(CONFIG, paths.geojsonFile, {
			type: 'directory',
			dir: paths.tileDirectory
		});

		console.log(`Starte tippecanoe (Tile-Ordner): ${CONFIG.tippecanoe.bin} ${args.join(' ')}`);

		const started = Date.now();
		await runCommand(CONFIG.tippecanoe.bin, args);
		const finished = Date.now();

		console.log(`Tile-Ordner fertig in ${((finished - started) / 1000).toFixed(1)} s`);
		console.log(`Tile-Ordner: ${paths.tileDirectory}`);
	}

	if (mustWriteGeoJsonFile && willRunTippecanoe && !CONFIG.output.keepGeoJsonAfterTippecanoe) {
		console.log(`Lösche GeoJSON: ${paths.geojsonFile}`);
		await rm(paths.geojsonFile, { force: true });
	}

	const finishedAt = new Date();
	const finishedMs = Date.now();

	if (CONFIG.output.writeManifest) {
		await writeManifest(paths.manifestFile, {
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationSeconds: Number(((finishedMs - startedMs) / 1000).toFixed(1)),
			script: path.relative(process.cwd(), __filename),
			bounds4326: CONFIG.bounds4326,
			extent3857,
			analysis: CONFIG.analysis,
			output: {
				geojsonFile: (
					mustWriteGeoJsonFile &&
					(CONFIG.output.writeGeoJson || CONFIG.output.keepGeoJsonAfterTippecanoe)
				) ? paths.geojsonFile : null,
				pmtilesFile: (willRunTippecanoe && CONFIG.tippecanoe.exportPmtiles) ? paths.pmtilesFile : null,
				tileDirectory: (willRunTippecanoe && CONFIG.tippecanoe.exportTileDirectory) ? paths.tileDirectory : null
			},
			tippecanoe: willRunTippecanoe ? {
				bin: CONFIG.tippecanoe.bin,
				layer: CONFIG.tippecanoe.layer,
				name: CONFIG.tippecanoe.name,
				description: CONFIG.tippecanoe.description,
				exportPmtiles: CONFIG.tippecanoe.exportPmtiles,
				exportTileDirectory: CONFIG.tippecanoe.exportTileDirectory
			} : null,
			featureCount: geojson?.features?.length ?? null
		});

		console.log(`Manifest: ${paths.manifestFile}`);
	}

	console.log(`Gesamt fertig in ${((finishedMs - startedMs) / 1000).toFixed(1)} s`);
}

main()
	.then(() => {
		process.exit(0);
	})
	.catch((err) => {
		console.error(err?.stack || String(err));
		process.exit(1);
	});
