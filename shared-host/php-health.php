<?php

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, max-age=0');
header('Pragma: no-cache');
header('Access-Control-Allow-Origin: *');

$versionPath = __DIR__ . '/WienBuildings/LOD1/ks-version.txt';
$readable = is_readable($versionPath);
$version = $readable
	? trim((string)file_get_contents($versionPath))
	: '';

echo json_encode(array(
	'ok' => true,
	'php' => PHP_VERSION,
	'versionReadable' => $readable,
	'version' => $version,
));
echo "\n";
