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

fwrite(STDOUT, "Radnetz-Dashboard builder tests: OK\n");
