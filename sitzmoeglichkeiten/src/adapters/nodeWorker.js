import { parentPort } from 'node:worker_threads';

import { runBenchAnalysisNode } from './nodeRunner.js';

if (!parentPort) {
	throw new Error('nodeWorker.js must be started as a worker thread.');
}

parentPort.on('message', async (data) => {
	try {
		const geojson = await runBenchAnalysisNode(data);

		parentPort.postMessage({
			ok: true,
			geojson
		});
	} catch (err) {
		parentPort.postMessage({
			ok: false,
			error: err?.stack || String(err)
		});
	}
});