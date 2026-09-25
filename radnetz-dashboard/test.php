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
	radnetzDashboardMapUrl('bauprogramm'),
	RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte',
	'Bauprogramm overview-map URL failed.'
);
expectSame(
	radnetzDashboardMapUrl('bauprogramm', '2006'),
	RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/2006',
	'Bauprogramm year page URL failed.'
);
expectSame(
	radnetzDashboardMapUrl('weitere'),
	RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte?type=3',
	'Weitere Bauprojekte overview-map URL failed.'
);
expectSame(
	radnetzDashboardMapUrl('weitere', '2026'),
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
$nestedColorFeature = [
	'type' => 'geometrycollection',
	'path' => '{"color":"#204a87"}',
	'component' => [[
		'type' => 'linestring',
		'points' => [['lon' => 16.3, 'lat' => 48.2], ['lon' => 16.4, 'lat' => 48.3]],
		'path' => '{"color":"#af0000"}',
	]],
];
expectSame(
	radnetzDashboardMapColor($nestedColorFeature),
	'#af0000',
	'Nested rendered component color must override GeometryCollection wrapper color.'
);

$historicalColorSettings = [
	'leaflet' => [
		'map' => [
			'features' => [
				[
					'type' => 'linestring',
					'points' => [['lon' => 16.35, 'lat' => 48.18], ['lon' => 16.36, 'lat' => 48.19]],
					'entity_id' => '299',
					'popup' => ['value' => '<b><a href="/bauprogramm/2006/spengergasse-abschnitt-schoenbrunner-strasse-bis-wiedner-hauptstrasse">Spengergasse 2006</a></b><br>Radweg<br><a href="/bauprogramm/2006">Bauprogramm 2006</a><br>Status: fertiggestellt<br>'],
					'path' => '{"color":"#af0000"}',
				],
				[
					'type' => 'linestring',
					'points' => [['lon' => 16.35, 'lat' => 48.18], ['lon' => 16.36, 'lat' => 48.19]],
					'entity_id' => '339',
					'popup' => ['value' => '<b><a href="/bauprogramm/2007/spengergasse-abschnitt-schoenbrunner-strasse-bis-wiedner-hauptstrasse">Spengergasse 2007</a></b><br>Radweg<br><a href="/bauprogramm/2007">Bauprogramm 2007</a><br>Status: fertiggestellt<br>'],
					'path' => '{"color":"#204a87"}',
				],
				[
					'type' => 'linestring',
					'points' => [['lon' => 16.36, 'lat' => 48.18], ['lon' => 16.37, 'lat' => 48.19]],
					'entity_id' => '171',
					'popup' => ['value' => '<b><a href="/bauprogramm/2006/gassergasse-abschnitt-hollgasse-und-anzengrubergasse">Gassergasse 2006</a></b><br>Radweg<br><a href="/bauprogramm/2006">Bauprogramm 2006</a><br>Status: fertiggestellt<br>'],
					'path' => '{"color":"#af0000"}',
				],
				[
					'type' => 'linestring',
					'points' => [['lon' => 16.36, 'lat' => 48.18], ['lon' => 16.37, 'lat' => 48.19]],
					'entity_id' => '335',
					'popup' => ['value' => '<b><a href="/bauprogramm/2007/gassergasse-abschnitt-hollgasse-bis-anzengrubergasse">Gassergasse 2007</a></b><br>Radweg<br><a href="/bauprogramm/2007">Bauprogramm 2007</a><br>Status: fertiggestellt<br>'],
					'path' => '{"color":"#204a87"}',
				],
			],
		],
	],
];
$historicalColorHtml = '<script type="application/json" data-drupal-selector="drupal-settings-json">'
	. json_encode($historicalColorSettings, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
	. '</script>';
$historicalColors = radnetzDashboardParseMapHtml($historicalColorHtml);
expectSame(
	radnetzDashboardYearsFromMapProjects($historicalColors),
	['2006', '2007'],
	'Years must also be discovered from the complete map overview.'
);
expectSame(
	$historicalColors['/bauprogramm/2006/spengergasse-abschnitt-schoenbrunner-strasse-bis-wiedner-hauptstrasse']['color'] ?? null,
	'#af0000',
	'Spengergasse 2006 must keep the official historical red map color.'
);
expectSame(
	$historicalColors['/bauprogramm/2007/spengergasse-abschnitt-schoenbrunner-strasse-bis-wiedner-hauptstrasse']['color'] ?? null,
	'#204a87',
	'Spengergasse 2007 must keep the official historical blue map color.'
);
expectSame(
	$historicalColors['/bauprogramm/2006/gassergasse-abschnitt-hollgasse-und-anzengrubergasse']['color'] ?? null,
	'#af0000',
	'Gassergasse 2006 must keep the official historical red map color.'
);
expectSame(
	$historicalColors['/bauprogramm/2007/gassergasse-abschnitt-hollgasse-bis-anzengrubergasse']['color'] ?? null,
	'#204a87',
	'Gassergasse 2007 must keep the official historical blue map color.'
);

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

$historyHtml = <<<'HTML'
<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="view view-id-letzte_statusaenderungen">
<ul>
	<li>
		<div class="views-field views-field-title"><span class="field-content"><a href="/bauprogramm/2023/argentinierstrasse">Argentinierstraße</a> (<a href="/bauprogramm/2023">Bauprogramm 2023</a>)</span></div>
		<div class="views-field views-field-field-datum"><div class="field-content">seit <time datetime="2024-01-15T12:00:00Z">15. Januar 2024</time></div></div>
		<div class="views-field views-field-body"><div class="field-content"><p>Maßnahme geändert von "Bestandsverbesserung: Fahrradstraße"</p></div></div>
	</li>
	<li>
		<div class="views-field views-field-title"><span class="field-content"><a href="/bauprogramm/2023/argentinierstrasse">Argentinierstraße</a></span></div>
		<div class="views-field views-field-field-datum"><div class="field-content">seit <time datetime="2024-12-22T12:00:00Z">22. Dezember 2024</time> fertiggestellt</div></div>
		<div class="views-field views-field-body"><div class="field-content">Maßnahme geändert von "Fahrradstraße"<br>Beschreibung geändert von "Test"<br></div></div>
	</li>
</ul>
<nav class="pager"><a rel="next" href="?page=1">Weiter</a></nav>
</div>
</body></html>
HTML;
$historyPage = radnetzDashboardParseHistoryHtml($historyHtml, 'bauprogramm');
expectSame($historyPage['hasNext'] ?? null, true, 'History next-page parsing failed.');
expectSame(count($historyPage['events'] ?? []), 2, 'History event count failed.');
$measureEvent = $historyPage['events'][0] ?? [];
expectSame($measureEvent['datum'] ?? null, '2024-01-15', 'History date parsing failed.');
expectSame($measureEvent['typ'] ?? null, 'aenderungen', 'Measure-only history type failed.');
expectSame($measureEvent['aenderungen'][0]['feld'] ?? null, 'Maßnahme', 'History change field parsing failed.');
expectSame(
	$measureEvent['aenderungen'][0]['vorher'] ?? null,
	'Bestandsverbesserung: Fahrradstraße',
	'Argentinierstraße measure history must retain the documented previous value.'
);
$statusEvent = $historyPage['events'][1] ?? [];
expectSame($statusEvent['status'] ?? null, 'fertiggestellt', 'History status parsing failed.');
expectSame($statusEvent['typ'] ?? null, 'status_und_aenderungen', 'Combined history type failed.');
expectSame(count($statusEvent['aenderungen'] ?? []), 2, 'Multiple changes in one history event failed.');
expectSame(
	radnetzDashboardHistoryChange('Geometrie geändert von "MULTILINESTRING ((16 48,17 49))"')['feld'] ?? null,
	'Geometrie',
	'Geometry history classification failed.'
);
expectSame(
	radnetzDashboardHistoryChange('Ort geändert von: "Ringstraße (1. Abschnitt)"')['vorher'] ?? null,
	'Ringstraße (1. Abschnitt)',
	'History changes with a colon after "von" must be parsed.'
);
expectSame(
	radnetzDashboardHistoryChange('Ort umbenannt von "Gunoldstraße - Geistlingergasse"')['aktion'] ?? null,
	'umbenannt',
	'History rename action must be parsed.'
);

$detailHistoryHtml = <<<'HTML'
<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="view view-status-aenderungen view-id-status_aenderungen view-display-id-block_1">
	<div class="views-row">
		<div class="views-field views-field-field-datum"><div class="field-content"><time datetime="2023-03-22T12:00:00Z">22. März 2023</time> (veröffentlicht)</div></div>
		<div class="views-field views-field-field-status"><div class="field-content">gefundener Status: in Planung</div></div>
		<div class="views-field views-field-body"><div class="field-content"></div></div>
	</div>
</div>
<div class="view view-status-aenderungen view-id-status_aenderungen view-display-id-block_1">
	<div class="views-row">
		<div class="views-field views-field-field-datum"><div class="field-content"><time datetime="2023-08-11T12:00:00Z">11. August 2023</time></div></div>
		<div class="views-field views-field-field-status"><div class="field-content">Statusänderung: in Vorbereitung</div></div>
		<div class="views-field views-field-body"><div class="field-content"></div></div>
	</div>
</div>
<div class="view view-status-aenderungen view-id-status_aenderungen view-display-id-block_2">
	<div class="views-row">
		<div class="views-field views-field-field-datum"><div class="field-content"><time datetime="2025-07-06T12:00:00Z">6. Juli 2025</time> (Beobachtung gestartet)</div></div>
		<div class="views-field views-field-field-status"><div class="field-content">gefundener Status: fertiggestellt</div></div>
		<div class="views-field views-field-body"><div class="field-content"></div></div>
	</div>
</div>
</body></html>
HTML;
$detailHistory = radnetzDashboardParseDetailHistoryHtml($detailHistoryHtml, '/bauprogramm/2023/argentinierstrasse');
expectSame(count($detailHistory), 3, 'Detail-page protocols from both sources must be parsed.');
expectSame($detailHistory[0]['quelle'] ?? null, 'bauprogramm', 'Bauprogramm detail protocol source failed.');
expectSame($detailHistory[0]['initial'] ?? null, true, 'Published Bauprogramm event must be marked as initial.');
expectSame($detailHistory[1]['status'] ?? null, 'in Vorbereitung', 'Detail status-change prefix must be normalized.');
expectSame($detailHistory[2]['quelle'] ?? null, 'projektkarte', 'Projektkarte detail protocol source failed.');
expectSame($detailHistory[2]['datum'] ?? null, '2025-07-06', 'Project-card observation start date missing.');
expectSame($detailHistory[2]['status'] ?? null, 'fertiggestellt', 'Project-card observation start status missing.');
expectSame($detailHistory[2]['initial'] ?? null, true, 'Project-card observation start must be marked as initial.');
expectSame(
	count(radnetzDashboardMergeHistory([$detailHistory[0]], $detailHistory)),
	3,
	'History merge must deduplicate stable event ids.'
);
expectSame(
	array_column(radnetzDashboardMergeHistory([$detailHistory[1]], [$detailHistory[0], $detailHistory[2]]), 'id'),
	array_column($detailHistory, 'id'),
	'History merge must retain cached non-initial detail events between audits.'
);
radnetzDashboardAssertDetailHistoryComplete(
	'/bauprogramm/2023/argentinierstrasse',
	$detailHistory,
	[$detailHistory[0], $detailHistory[2]]
);
$incompleteDetailRejected = false;
try {
	radnetzDashboardAssertDetailHistoryComplete(
		'/bauprogramm/2023/argentinierstrasse',
		array_slice($detailHistory, 0, 2),
		$detailHistory
	);
} catch (RuntimeException $error) {
	$incompleteDetailRejected = str_contains($error->getMessage(), '1 bereits bekannte Ereignisse');
}
expectSame(
	$incompleteDetailRejected,
	true,
	'A detail-page refresh must not silently drop a cached history event.'
);

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
		'Statusverlauf' => 'veraltet',
		'_searchText' => 'must-not-repeat',
	],
];
$feature = radnetzDashboardViewFeature(
	$row,
	$mapProject,
	'bauprogramm',
	'Bauprogramm Stadt Wien',
	['in bau' => ['name' => 'in Bau', 'color' => '#c17d11']],
	$previous,
	[$measureEvent]
);
expectSame($feature['properties']['Budget'] ?? null, 'bleibt erhalten', 'Previous enrichment must be preserved.');
expectSame($feature['properties']['Status'] ?? null, 'in Bau', 'Current list status must replace stale status.');
expectSame($feature['properties']['Aktueller Projektstatus'] ?? null, 'in Bau', 'Explicit current project status missing.');
expectSame($feature['properties']['Projektverlauf'][0]['datum'] ?? null, '2024-01-15', 'Structured project history missing.');
expectSame(isset($feature['properties']['Statusverlauf']), false, 'Legacy status-history string must not survive enrichment.');
expectSame($feature['properties']['_sourceEntityId'] ?? null, '203', 'Source entity id missing.');
expectSame(str_contains($feature['properties']['_searchText'] ?? '', 'must-not-repeat'), false, 'Search text must not include stale search text recursively.');
expectSame(count($feature['geometry']['geometries'] ?? []), 3, 'Previous secondary geometry must be preserved.');
expectSame($feature['geometry']['geometries'][0]['coordinates'][0] ?? null, [16.3, 48.2], 'Live primary geometry must replace stale primary geometry.');

fwrite(STDOUT, "Radnetz-Dashboard builder tests: OK\n");
