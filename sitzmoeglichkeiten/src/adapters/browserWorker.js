import { runBenchAnalysisCore } from '../core/benchAnalysisCore.js';
import { createOverpassFetcher } from '../core/fetchOverpassJson.js';
import { getBrowserDeps } from './browserDeps.js';

const deps = getBrowserDeps();

const fetchJson = createOverpassFetcher({
	fetchImpl: globalThis.fetch,
	logger: console
});

self.onmessage = async (e) => {
	try {
		const {
			extent3857,
			includeBenches = false,
			options = {}
		} = e.data ?? {};

		const geojson = await runBenchAnalysisCore({
			extent3857,
			includeBenches,
			deps,
			fetchJson,
			logger: console,
			options
		});

		self.postMessage({
			ok: true,
			geojson
		});
	} catch (err) {
		self.postMessage({
			ok: false,
			error: err?.stack || String(err)
		});
	}
};