export function shuffle(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
}

export function createOverpassFetcher({
	fetchImpl = globalThis.fetch,
	logger = console,
	endpoints = [
		'https://overpass-api.de/api/interpreter',
		'https://overpass.private.coffee/api/interpreter',
		'https://overpass.kumi.systems/api/interpreter',
		'https://lz4.overpass-api.de/api/interpreter'
	]
} = {}) {
	if (typeof fetchImpl !== 'function') {
		throw new Error('No fetch implementation available.');
	}

	return async function fetchOverpassJson(query) {
		const shuffled = shuffle([...endpoints]);

		for (const endpoint of shuffled) {
			try {
				const res = await fetchImpl(endpoint, {
					method: 'POST',
					body: 'data=' + encodeURIComponent(query),
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded'
					}
				});

				if (!res.ok) {
					logger?.warn?.(`Overpass endpoint ${endpoint} responded with HTTP ${res.status}`);
					continue;
				}

				const json = await res.json();

				if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) {
					logger?.warn?.(`Invalid JSON format from ${endpoint}`);
					continue;
				}

				return json;
			} catch (err) {
				logger?.warn?.(`Failed to fetch from ${endpoint}`, err);
			}
		}

		throw new Error('All Overpass API endpoints failed.');
	};
}