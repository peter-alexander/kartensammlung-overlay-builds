<?php
declare(strict_types=1);

define('RADNETZ_DASHBOARD_LIBRARY_ONLY', true);
require __DIR__ . '/lib.php';

function expectSame(mixed $actual, mixed $expected, string $message): void {
	if ($actual !== $expected) {
		fwrite(STDERR, $message . PHP_EOL);
		fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
		fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
		exit(1);
	}
}

expectSame(
	radnetzDashboardParseWkt('POINT (16.3 48.2)'),
	['type' => 'Point', 'coordinates' => [16.3, 48.2]],
	'POINT parsing failed.'
);

$multi = radnetzDashboardParseWkt('MULTILINESTRING ((16 48, 17 49), (15 47, 16 48))');
expectSame($multi['type'] ?? null, 'MultiLineString', 'MULTILINESTRING type failed.');
expectSame(count($multi['coordinates'] ?? []), 2, 'MULTILINESTRING parts failed.');

$collection = radnetzDashboardParseWkt(
	'GEOMETRYCOLLECTION (POINT (16.3 48.2), LINESTRING (16 48, 17 49))'
);
expectSame(count($collection['geometries'] ?? []), 2, 'GEOMETRYCOLLECTION parsing failed.');

expectSame(
	radnetzDashboardParseWkt('GEOMETRYCOLLECTION EMPTY'),
	null,
	'Empty GEOMETRYCOLLECTION must be null.'
);

expectSame(
	radnetzDashboardDistrictCodes('1010, 1210'),
	['1010', '1210'],
	'District parsing failed.'
);

expectSame(
	radnetzDashboardNumericValue('1.234,5 m'),
	1234.5,
	'Localized numeric parsing failed.'
);

expectSame(
	radnetzDashboardProjectKey('bauprogramm', '2018', "Neubaugürtel \u{0096} Kandlgasse – Bestandsverbesserung"),
	radnetzDashboardProjectKey('bauprogramm', '2018', 'Neubaugürtel Kandlgasse Bestandsverbesserung'),
	'Project key must ignore display punctuation and control characters.'
);
expectSame(
	radnetzDashboardNormalizeStatus('fertiggestellt (verschoben nach 2024)'),
	'fertiggestellt',
	'Decorated list status must be normalized.'
);

expectSame(
	array_keys(radnetzDashboardSourceDefinitions()),
	['bauprogramm', 'weitere'],
	'All Radnetz Dashboard project categories must be configured.'
);
expectSame(
	array_column(radnetzDashboardSourceDefinitions(), 'type'),
	[2, 3],
	'Radnetz Dashboard category type ids changed unexpectedly.'
);
expectSame(
	radnetzDashboardMapUrl(2, '2006'),
	RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte?type=2&jahr=2006',
	'Bauprogramm year-map URL failed.'
);
expectSame(
	radnetzDashboardMapUrl(3, '2026'),
	RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte?type=3&jahr=2026',
	'Weitere Bauprojekte year-map URL failed.'
);
expectSame(
	radnetzDashboardYearsFromRows([
		['Jahr' => '2007'],
		['Jahr' => '2006'],
		['Jahr' => '2007'],
		['Jahr' => ''],
	]),
	['2006', '2007'],
	'Year extraction from project rows failed.'
);

$mapSettings = [
	'leaflet' => [
		'map' => [
			'features' => [[
				'type' => 'geometrycollection',
				'component' => [
					['type' => 'linestring', 'points' => [['lon' => 16.3, 'lat' => 48.2], ['lon' => 16.4, 'lat' => 48.3]]],
					['type' => 'point', 'lon' => 16.5, 'lat' => 48.4],
				],
				'entity_id' => '203',
				'popup' => ['value' => '<b><a href="/bauprogramm/2026/test-projekt">Test Projekt</a></b><br>Radweg<br><a href="/bauprogramm/2026">Bauprogramm 2026</a>, <a href="/bezirk/landstrasse">Landstraße</a><br>Status: in Bau<br>'],
				'path' => '{"color":"#c17d11"}',
			]],
		],
	],
];
$mapHtml = '<script type="application/json" data-drupal-selector="drupal-settings-json">'
	. json_encode($mapSettings, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
	. '</script>';
$mapProjects = radnetzDashboardParseMapHtml($mapHtml);
$mapProject = $mapProjects['/bauprogramm/2026/test-projekt'] ?? [];
expectSame($mapProject['entityId'] ?? null, '203', 'Map entity id parsing failed.');
expectSame($mapProject['geometry']['type'] ?? null, 'GeometryCollection', 'Map GeometryCollection parsing failed.');
expectSame($mapProject['popup']['Status'] ?? null, 'in Bau', 'Map popup status parsing failed.');
expectSame($mapProject['color'] ?? null, '#c17d11', 'Map style color parsing failed.');

$listHtml = <<<'HTML'
<!doctype html><html><head><meta charset="utf-8"></head><body>
<table><tbody><tr>
	<td headers="view-field-jahr-table-column"><a>Bauprogramm 2026</a></td>
	<td headers="view-title-table-column"><a><img alt=""></a><a href="/bauprogramm/2026/test-projekt">Test Projekt</a></td>
	<td headers="view-field-bezirk-table-column"><a href="/bezirk/landstrasse">Landstraße</a></td>
	<td headers="view-field-massnahme-table-column">Radweg</td>
	<td headers="view-field-status-table-column">in Bau</td>
	<td headers="view-field-netze-table-column">HRVN Grundnetz, Radlobby-Basisnetz</td>
	<td headers="view-field-route-table-column">Route 1</td>
	<td headers="view-field-tags-table-column">Test, Radweg</td>
	<td headers="view-field-ankuendigung-table-column"><time datetime="2025-03-10T12:00:00Z">10. März 2025</time></td>
	<td headers="view-field-baubeginn-table-column"></td>
	<td headers="view-field-bauende-table-column"></td>
	<td headers="view-field-datum-ende-table-column"></td>
	<td headers="view-field-entfernung-table-column"></td>
	<td headers="view-field-status-change-table-column"><time datetime="2026-03-26T12:00:00Z">26. März 2026</time></td>
	<td headers="view-field-geometry-table-column"><div>Strecke: 811m</div><div>Anlage: 1.234,5m</div></td>
</tr></tbody></table>
<nav class="pager"><a rel="next" href="?page=1">Weiter</a></nav>
</body></html>
HTML;
$list = radnetzDashboardParseListHtml($listHtml, 'bauprogramm');
$row = $list['rows']['/bauprogramm/2026/test-projekt'] ?? [];
expectSame($list['hasNext'] ?? null, true, 'List next-page parsing failed.');
expectSame($row['Jahr'] ?? null, '2026', 'List year parsing failed.');
expectSame($row['_districtCodes'] ?? null, ['1030'], 'List district parsing failed.');
expectSame($row['Ankündigung'] ?? null, '2025-03-10', 'List date parsing failed.');
expectSame($row['Länge'] ?? null, '811', 'List route length parsing failed.');
expectSame($row['Anlagenlänge'] ?? null, '1.234,5', 'List facility length parsing failed.');

$previous = [
	'id' => 'old-id',
	'geometry' => [
		'type' => 'GeometryCollection',
		'geometries' => [
			['type' => 'LineString', 'coordinates' => [[1, 1], [2, 2]]],
			['type' => 'Point', 'coordinates' => [3, 3]],
			['type' => 'LineString', 'coordinates' => [[4, 4], [5, 5]]],
		],
	],
	'properties' => [
		'Projekt-ID' => 'old-id',
		'Budget' => 'bleibt erhalten',
		'Status' => 'angekündigt',
		'_searchText' => 'must-not-repeat',
	],
];
$feature = radnetzDashboardViewFeature(
	$row,
	$mapProject,
	'bauprogramm',
	'Bauprogramm Stadt Wien',
	['in bau' => ['name' => 'in Bau', 'color' => '#c17d11']],
	$previous
);
expectSame($feature['properties']['Budget'] ?? null, 'bleibt erhalten', 'Previous enrichment must be preserved.');
expectSame($feature['properties']['Status'] ?? null, 'in Bau', 'Current list status must replace stale status.');
expectSame($feature['properties']['_sourceEntityId'] ?? null, '203', 'Source entity id missing.');
expectSame(str_contains($feature['properties']['_searchText'] ?? '', 'must-not-repeat'), false, 'Search text must not include stale search text recursively.');
expectSame(count($feature['geometry']['geometries'] ?? []), 3, 'Previous secondary geometry must be preserved.');
expectSame($feature['geometry']['geometries'][0]['coordinates'][0] ?? null, [16.3, 48.2], 'Live primary geometry must replace stale primary geometry.');

fwrite(STDOUT, "Radnetz-Dashboard builder tests: OK\n");
