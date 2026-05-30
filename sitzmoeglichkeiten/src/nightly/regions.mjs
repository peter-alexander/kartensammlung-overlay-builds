import { fileURLToPath } from 'node:url';

function boundaryFile(name) {
	return fileURLToPath(
		new URL(`../boundaries/${name}.geojson`, import.meta.url)
	);
}

export const REGIONS = [
	{
		id: 'wien',
		name: 'Wien',
		enabled: true,
		boundary: {
			file: boundaryFile('wien'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'wiener_becken',
		name: 'Wiener Becken',
		enabled: true,
		boundary: {
			file: boundaryFile('wiener_becken'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'st_poelten',
		name: 'Sankt Pölten',
		enabled: true,
		boundary: {
			file: boundaryFile('st_poelten'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'eisenstadt',
		name: 'Eisenstadt',
		enabled: true,
		boundary: {
			file: boundaryFile('eisenstadt'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'graz',
		name: 'Graz',
		enabled: true,
		boundary: {
			file: boundaryFile('graz'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'klagenfurt',
		name: 'Klagenfurt',
		enabled: true,
		boundary: {
			file: boundaryFile('klagenfurt'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'linz',
		name: 'Linz',
		enabled: true,
		boundary: {
			file: boundaryFile('linz'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'salzburg',
		name: 'Salzburg',
		enabled: true,
		boundary: {
			file: boundaryFile('salzburg'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'innsbruck',
		name: 'Innsbruck',
		enabled: true,
		boundary: {
			file: boundaryFile('innsbruck'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'bregenz',
		name: 'Bregenz',
		enabled: true,
		boundary: {
			file: boundaryFile('bregenz'),
			bufferMeters: 6000,
			overpassMarginMeters: 200
		}
	},

	{
		id: 'muenchen',
		name: 'München',
		enabled: true,
		boundary: {
			file: boundaryFile('muenchen'),
			bufferMeters: 10000,
			overpassMarginMeters: 200
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
