export const REGIONS = [
	{
		id: 'wien',
		name: 'Wien',
		enabled: true,
		bounds4326: {
			minLon: 16.171875,
			minLat: 48.1074311884804,
			maxLon: 16.59375,
			maxLat: 48.34164617237459
		},
		boundaryClip: {
			enabled: process.env.KS_CLIP_TO_WIEN_BOUNDARY !== '0',
			strict: process.env.KS_CLIP_TO_WIEN_BOUNDARY_STRICT === '1',
			wfsUrl: process.env.KS_WIEN_BOUNDARY_WFS_URL || 'https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&typeName=ogdwien:LANDESGRENZEOGD&srsName=EPSG:4326&outputFormat=json'
		}
	},

	{
		id: 'muenchen-10km',
		name: 'München + 10 km',
		enabled: true,
		bounds4326: {
			minLon: 11.222,
			minLat: 47.96,
			maxLon: 11.88,
			maxLat: 48.345
		},
		boundaryClip: {
			enabled: false
		}
	}
];

export function getSelectedRegions() {
	const raw = process.env.KS_REGIONS;

	if (!raw || raw.trim() === '') {
		return REGIONS.filter((region) => region.enabled !== false);
	}

	const wanted = raw
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);

	const wantedSet = new Set(wanted);

	const selected = REGIONS.filter((region) => wantedSet.has(region.id));

	const missing = wanted.filter((id) => !REGIONS.some((region) => region.id === id));

	if (missing.length > 0) {
		throw new Error(`Unbekannte KS_REGIONS: ${missing.join(', ')}`);
	}

	if (selected.length === 0) {
		throw new Error('Keine Regionen ausgewählt.');
	}

	return selected;
}
