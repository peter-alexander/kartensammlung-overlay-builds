import { transformExtentToBbox } from './geometryUtils.js';

export function buildOverpassQuery({
	extent3857,
	pad = 50,
	geo
}) {
	const bbox = transformExtentToBbox([
		extent3857[0] - pad,
		extent3857[1] - pad,
		extent3857[2] + pad,
		extent3857[3] + pad
	], geo);

	const sitzTags = [
		`nwr[amenity=bench]`,
		`nwr[bench=yes]["level"!~"^-?[1-9]"]`,
		`nwr[amenity=chair]`,
		`nwr[amenity=lounger]`,
		`nwr[amenity=seat]`,
		`nwr[leisure=picnic_table]`,
		`nwr[picnic_table=yes]`,
		`nwr[tourism=picnic_site]`,
		`nwr[leisure=parklet]["access"!~"^customers?$"]`,
		`nwr[outdoor_seating=parklet]["access"~"^(yes|public|permissive)$"]`
	];

	const sitzAusschluss = `["access"!~"^private"]`;

	const sitzFilters = sitzTags
		.map((tag) => `${tag}${sitzAusschluss}(${bbox});`)
		.join('\n\t');

	const seatKeyVals = sitzTags
		.map((tag) => {
			const m = tag.match(/\[["']?([^=\]]+)["']?=["']?([^"\]]+)["']?\]/);
			return m ? [m[1], m[2]] : null;
		})
		.filter(Boolean);

	const fussgaengerHighways = [
		`nwr[highway=cycleway][foot=yes]`,
		`nwr[highway=footway]`,
		`nwr[highway=path]`,
		`nwr[highway=track]`,
	];

	const wideHighways = [
		'primary',
		'secondary',
		'tertiary',
		'residential',
		'pedestrian',
		'living_street',
		'service',
		'unclassified'
	];

	const ausschluss = [
		['foot', 'no'],
		['indoor', 'yes'],
		['access', 'no'],
		['access', 'private'],
		['tunnel', 'yes'],
		['ramp:wheelchair', 'yes'],
		['area', 'yes']
	];

	const ausschlussValues = ['private', 'permissive', 'steps'];

	const highwayRegex = wideHighways.join('|');

	const valueAusschluss = ausschlussValues
		.map((v) => `[!"${v}"]`)
		.join('');

	const tagAusschluss = ausschluss
		.map(([k, v]) => `["${k}"!=${v}]`)
		.join('');

	const fussgaengerFilters = fussgaengerHighways
		.map((tag) => `${tag}${valueAusschluss}${tagAusschluss}(${bbox});`)
		.join('\n\t');

	const highwayFilterLine = `way["highway"~"${highwayRegex}"]${valueAusschluss}${tagAusschluss}(${bbox});`;

	const query = `[out:json];
(
	${sitzFilters}
	${fussgaengerFilters}
	${highwayFilterLine}
);
out geom;`;

	return {
		query,
		seatKeyVals
	};
}