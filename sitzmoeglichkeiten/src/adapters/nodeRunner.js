import { writeFile } from 'node:fs/promises';

import { runBenchAnalysisCore } from '../core/benchAnalysisCore.js';
import { createOverpassFetcher } from '../core/fetchOverpassJson.js';
import { getNodeDeps } from './nodeDeps.js';

export async function runBenchAnalysisNode({
	extent3857,
	includeBenches = false,
	logger = console,
	options = {},
	overpass = {},
	fetchJson = null
}) {
	const deps = getNodeDeps();

	const effectiveFetchJson = fetchJson ?? createOverpassFetcher({
		fetchImpl: globalThis.fetch,
		logger,
		...overpass
	});

	return runBenchAnalysisCore({
		extent3857,
		includeBenches,
		deps,
		fetchJson: effectiveFetchJson,
		logger,
		options
	});
}

export async function writeBenchAnalysisGeoJson({
	outFile,
	pretty = false,
	...rest
}) {
	if (!outFile) {
		throw new Error('outFile is required.');
	}

	const geojson = await runBenchAnalysisNode(rest);

	await writeFile(
		outFile,
		JSON.stringify(geojson, null, pretty ? '\t' : 0),
		'utf8'
	);

	return geojson;
}
