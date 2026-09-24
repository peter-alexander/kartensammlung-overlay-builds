const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const SH_BASE = 'https://sh.dataspace.copernicus.eu';
const CONFIG_BASE = `${SH_BASE}/configuration/v1`;
const COLLECTION_ID = '5460de54-082e-473a-b6ea-d5cbe3c17cca';
const COLLECTION_TYPE = `byoc-${COLLECTION_ID}`;
const LAYER_ID = 's2_quarterly';

const clientId = String(process.env.COPERNICUS_CLIENT_ID || '').trim();
const clientSecret = String(process.env.COPERNICUS_CLIENT_SECRET || '').trim();
const instanceId = String(process.env.COPERNICUS_INSTANCE_ID || '').trim();

for (const [name, value] of [
	['COPERNICUS_CLIENT_ID', clientId],
	['COPERNICUS_CLIENT_SECRET', clientSecret],
	['COPERNICUS_INSTANCE_ID', instanceId]
]) {
	if (!value) {
		throw new Error(`${name} fehlt.`);
	}
}

const evalScript = `//VERSION=3
function setup() {
	return {
		input: ["B02", "B03", "B04", "dataMask"],
		output: {
			bands: 4
		}
	};
}

function evaluatePixel(sample) {
	return [
		2.5 * sample.B04 / 10000,
		2.5 * sample.B03 / 10000,
		2.5 * sample.B02 / 10000,
		sample.dataMask
	];
}`;

async function responseBody(response) {
	const text = await response.text();
	if (!text) return null;

	try {
		return JSON.parse(text);
	} catch (_) {
		return text;
	}
}

function describeErrorBody(body) {
	if (body == null) return '';
	if (typeof body === 'string') return body.slice(0, 2000);
	return JSON.stringify(body).slice(0, 4000);
}

async function request(url, {
	token = '',
	method = 'GET',
	headers = {},
	body = null,
	allowFailure = false
} = {}) {
	const requestHeaders = {
		Accept: 'application/json',
		...headers
	};

	if (token) {
		requestHeaders.Authorization = `Bearer ${token}`;
	}

	let requestBody = body;
	if (body != null && !(body instanceof URLSearchParams) && typeof body !== 'string') {
		requestHeaders['Content-Type'] ||= 'application/json';
		requestBody = JSON.stringify(body);
	}

	const response = await fetch(url, {
		method,
		headers: requestHeaders,
		body: requestBody
	});
	const data = await responseBody(response);

	if (!response.ok && !allowFailure) {
		throw new Error(
			`${method} ${url} antwortete mit HTTP ${response.status}: ${describeErrorBody(data)}`
		);
	}

	return {
		ok: response.ok,
		status: response.status,
		data
	};
}

async function getAccessToken() {
	const body = new URLSearchParams({
		grant_type: 'client_credentials',
		client_id: clientId,
		client_secret: clientSecret
	});

	const result = await request(TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body
	});

	const token = String(result.data?.access_token || '').trim();
	if (!token) {
		throw new Error('Copernicus OAuth-Antwort enthält kein access_token.');
	}

	return token;
}

function asArray(value) {
	if (Array.isArray(value)) return value;
	if (Array.isArray(value?.data)) return value.data;
	if (Array.isArray(value?.items)) return value.items;
	return [];
}

function objectId(value) {
	if (!value || typeof value !== 'object') return '';
	return String(value.id || value.identifier || '').trim();
}

function objectRef(value) {
	if (!value || typeof value !== 'object') return '';
	return String(value['@id'] || value.href || '').trim();
}

function looksLikeByoc(value) {
	const haystack = JSON.stringify(value || {}).toLowerCase();
	return haystack.includes('byoc') || haystack.includes('bring your own');
}

async function verifyQuarterlyCollection(token) {
	const result = await request(
		`${SH_BASE}/catalog/v1/collections/${encodeURIComponent(COLLECTION_TYPE)}`,
		{ token }
	);

	const bands = Array.isArray(result.data?.summaries?.['eo:bands'])
		? result.data.summaries['eo:bands'].map((band) => String(band?.name || ''))
		: [];

	for (const required of ['B02', 'B03', 'B04']) {
		if (!bands.includes(required)) {
			throw new Error(
				`Sentinel-2 Quarterly Collection enthält erwartetes Band ${required} nicht.`
			);
		}
	}

	console.log(
		`Quarterly Collection erreichbar: ${COLLECTION_TYPE} (${bands.filter(Boolean).join(', ')})`
	);
}

async function readLayers(token) {
	const result = await request(
		`${CONFIG_BASE}/wms/instances/${encodeURIComponent(instanceId)}/layers`,
		{ token }
	);

	return asArray(result.data);
}

async function discoverByocDataset(token) {
	const result = await request(`${CONFIG_BASE}/datasets`, {
		token,
		allowFailure: true
	});

	if (!result.ok) {
		console.log(
			`Dataset-Metadaten nicht verfügbar (HTTP ${result.status}); verwende BYOC-Fallback.`
		);
		return null;
	}

	const datasets = asArray(result.data);
	const dataset = datasets.find((item) => (
		objectId(item).toUpperCase() === 'BYOC' || looksLikeByoc(item)
	));

	if (!dataset) {
		console.log('Kein BYOC-Dataset in den Configuration-Metadaten gefunden; verwende Fallback.');
		return null;
	}

	let source = null;
	const inlineSources = asArray(dataset.sources);
	if (inlineSources.length) {
		source = inlineSources.find(looksLikeByoc) || inlineSources[0];
	}

	const datasetRef = objectRef(dataset);
	if (!source && datasetRef) {
		const sourceResult = await request(`${datasetRef.replace(/\/$/, '')}/sources`, {
			token,
			allowFailure: true
		});
		if (sourceResult.ok) {
			const sources = asArray(sourceResult.data);
			source = sources.find(looksLikeByoc) || sources[0] || null;
		}
	}

	console.log(
		`Configuration-Dataset für BYOC: ${objectId(dataset) || datasetRef || 'gefunden'}`
	);

	return {
		dataset,
		source
	};
}

function layerBase() {
	return {
		id: LAYER_ID,
		title: 'Sentinel-2 Quartalskomposite',
		description: 'Sentinel-2 Level 3 Quarterly Mosaics · Kartensammlung managed layer',
		styles: [
			{
				name: 'default',
				description: 'True Color',
				evalScript
			}
		],
		defaultStyleName: 'default',
		orderHint: 0,
		datasourceDefaults: {
			type: 'BYOC',
			collectionId: COLLECTION_ID,
			mosaickingOrder: 'mostRecent',
			temporal: true
		},
		userData: {
			kartensammlungManaged: true,
			collectionType: COLLECTION_TYPE
		}
	};
}

function payloadCandidates(discovered) {
	const base = layerBase();
	const instance = {
		'@id': `${CONFIG_BASE}/wms/instances/${instanceId}`
	};
	const fallbackDataset = {
		'@id': `${CONFIG_BASE}/datasets/BYOC`
	};

	const candidates = [];

	if (discovered?.dataset) {
		const datasetRef = objectRef(discovered.dataset);
		const sourceRef = objectRef(discovered.source);

		candidates.push({
			...base,
			instance,
			dataset: datasetRef ? { '@id': datasetRef } : discovered.dataset,
			...(sourceRef
				? { datasetSource: { '@id': sourceRef } }
				: {})
		});
	}

	candidates.push({
		...base,
		instance,
		dataset: fallbackDataset
	});

	candidates.push({
		...base,
		instance
	});

	candidates.push({
		...base,
		instance,
		datasourceDefaults: {
			type: COLLECTION_TYPE,
			mosaickingOrder: 'mostRecent',
			temporal: true
		}
	});

	return candidates;
}

async function createLayer(token, payloads) {
	const collectionUrl = `${CONFIG_BASE}/wms/instances/${encodeURIComponent(instanceId)}/layers`;
	const itemUrl = `${collectionUrl}/${encodeURIComponent(LAYER_ID)}`;
	const errors = [];

	for (const [index, payload] of payloads.entries()) {
		for (const [method, url] of [
			['POST', collectionUrl],
			['PUT', itemUrl]
		]) {
			const result = await request(url, {
				token,
				method,
				body: payload,
				allowFailure: true
			});

			if (result.ok) {
				console.log(
					`Sentinel-Hub-Layer ${LAYER_ID} erstellt (${method}, Variante ${index + 1}).`
				);
				return;
			}

			if (result.status === 409) {
				console.log(`Sentinel-Hub-Layer ${LAYER_ID} existiert bereits.`);
				return;
			}

			errors.push(
				`${method} Variante ${index + 1}: HTTP ${result.status}: ${describeErrorBody(result.data)}`
			);

			if (![400, 404, 405, 409, 422].includes(result.status)) {
				break;
			}
		}
	}

	throw new Error(
		`Sentinel-Hub-Layer ${LAYER_ID} konnte nicht erstellt werden.\n${errors.join('\n')}`
	);
}

async function main() {
	const token = await getAccessToken();
	console.log('Copernicus OAuth: Zugriff erfolgreich.');

	await verifyQuarterlyCollection(token);

	const before = await readLayers(token);
	const existing = before.find((item) => objectId(item).toLowerCase() === LAYER_ID);

	if (existing) {
		console.log(`Sentinel-Hub-Layer ${LAYER_ID} ist bereits vorhanden.`);
		return;
	}

	const discovered = await discoverByocDataset(token);
	await createLayer(token, payloadCandidates(discovered));

	const after = await readLayers(token);
	const created = after.find((item) => objectId(item).toLowerCase() === LAYER_ID);
	if (!created) {
		throw new Error(
			`Configuration API meldete Erfolg, aber ${LAYER_ID} ist anschließend nicht in der Layerliste.`
		);
	}

	console.log(`Sentinel-Hub-Konfiguration bestätigt: ${LAYER_ID} ist aktiv.`);
}

main().catch((error) => {
	console.error(error?.stack || error);
	process.exitCode = 1;
});
