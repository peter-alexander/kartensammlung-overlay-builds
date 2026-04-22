export function shuffle(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value) {
	if (!value) {
		return 0;
	}

	const trimmed = String(value).trim();

	if (/^\d+$/.test(trimmed)) {
		return Number(trimmed) * 1000;
	}

	const parsedDateMs = Date.parse(trimmed);

	if (Number.isNaN(parsedDateMs)) {
		return 0;
	}

	return Math.max(0, parsedDateMs - Date.now());
}

function isRetryableStatus(status) {
	return (
		status === 408 ||
		status === 425 ||
		status === 429 ||
		status === 500 ||
		status === 502 ||
		status === 503 ||
		status === 504
	);
}

function formatMs(ms) {
	if (ms < 1000) {
		return `${ms} ms`;
	}

	const totalSeconds = Math.ceil(ms / 1000);

	if (totalSeconds < 60) {
		return `${totalSeconds} s`;
	}

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

export function createOverpassFetcher({
	fetchImpl = globalThis.fetch,
	logger = console,
	endpoints = [
		'https://overpass.private.coffee/api/interpreter',
		'https://overpass.osm.jp/api/interpreter',
		'https://overpass-api.de/api/interpreter',
		'https://lz4.overpass-api.de/api/interpreter'
	],
	maxRounds = 4,
	retryDelaysMs = [120_000, 240_000, 600_000],
	requestTimeoutMs = 75_000,
	userAgent = process.env.KS_OVERPASS_USER_AGENT ||
		'Kartensammlung-Overlay-Builds/1.0 (+https://github.com/peter-alexander/kartensammlung-overlay-builds)'
} = {}) {
	if (typeof fetchImpl !== 'function') {
		throw new Error('No fetch implementation available.');
	}

	if (!Array.isArray(endpoints) || endpoints.length === 0) {
		throw new Error('At least one Overpass endpoint is required.');
	}

	return async function fetchOverpassJson(query) {
		const failures = [];

		for (let roundIndex = 0; roundIndex < maxRounds; roundIndex++) {
			const roundNumber = roundIndex + 1;
			const shuffled = shuffle([...endpoints]);
			const retryAfterHintsMs = [];
			let sawRetryableFailure = false;

			logger?.info?.(
				`Overpass attempt round ${roundNumber}/${maxRounds} (${shuffled.length} endpoints).`
			);

			for (const endpoint of shuffled) {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => {
					controller.abort(new Error(`Request timeout after ${requestTimeoutMs} ms`));
				}, requestTimeoutMs);

				try {
					const res = await fetchImpl(endpoint, {
						method: 'POST',
						body: 'data=' + encodeURIComponent(query),
						headers: {
							'User-Agent': userAgent,
							'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8',
							'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
						},
						signal: controller.signal
					});

					clearTimeout(timeoutId);

					if (!res.ok) {
						const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));

						if (retryAfterMs > 0) {
							retryAfterHintsMs.push(retryAfterMs);
						}

						if (isRetryableStatus(res.status)) {
							sawRetryableFailure = true;
						}

						const bodyText = await res.text().catch(() => '');

						failures.push({
							round: roundNumber,
							endpoint,
							type: 'http',
							status: res.status,
							body: bodyText.slice(0, 400)
						});

						logger?.warn?.(
							`Overpass endpoint ${endpoint} responded with HTTP ${res.status} in round ${roundNumber}/${maxRounds}` +
							(bodyText ? ` | Body: ${bodyText.slice(0, 400).replace(/\s+/g, ' ')}` : '')
						);

						continue;
					}

					const json = await res.json();

					if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) {
						sawRetryableFailure = true;

						failures.push({
							round: roundNumber,
							endpoint,
							type: 'invalid-json'
						});

						logger?.warn?.(
							`Invalid JSON format from ${endpoint} in round ${roundNumber}/${maxRounds}.`
						);

						continue;
					}

					if (roundIndex > 0) {
						logger?.info?.(
							`Overpass endpoint ${endpoint} succeeded in round ${roundNumber}/${maxRounds}.`
						);
					}

					return json;
				} catch (err) {
					clearTimeout(timeoutId);
					sawRetryableFailure = true;

					failures.push({
						round: roundNumber,
						endpoint,
						type: 'exception',
						message: err?.message ?? String(err)
					});

					logger?.warn?.(
						`Failed to fetch from ${endpoint} in round ${roundNumber}/${maxRounds}: ${err?.message ?? err}`
					);
				}
			}

			if (roundIndex >= maxRounds - 1) {
				break;
			}

			if (!sawRetryableFailure) {
				logger?.warn?.(
					`Overpass failed in round ${roundNumber}/${maxRounds} without retryable errors. Abort further retries.`
				);
				break;
			}

			const configuredDelayMs =
				retryDelaysMs[
					Math.min(roundIndex, Math.max(0, retryDelaysMs.length - 1))
				] ?? 0;

			const hintedDelayMs =
				retryAfterHintsMs.length > 0 ? Math.max(...retryAfterHintsMs) : 0;

			const delayMs = Math.max(configuredDelayMs, hintedDelayMs);

			if (delayMs > 0) {
				logger?.warn?.(
					`All Overpass endpoints failed in round ${roundNumber}/${maxRounds}. Waiting ${formatMs(delayMs)} before retry.`
				);
				await sleep(delayMs);
			}
		}

		const summary = failures
			.map((failure) => {
				if (failure.type === 'http') {
					return `R${failure.round} ${failure.endpoint} -> HTTP ${failure.status}${failure.body ? ` (${failure.body})` : ''}`;
				}

				if (failure.type === 'invalid-json') {
					return `R${failure.round} ${failure.endpoint} -> invalid JSON`;
				}

				return `R${failure.round} ${failure.endpoint} -> ${failure.message}`;
			})
			.join(' | ');

		throw new Error(
			`All Overpass API endpoints failed after ${maxRounds} rounds.${summary ? ` ${summary}` : ''}`
		);
	};
}
