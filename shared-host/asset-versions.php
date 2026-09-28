<?php

declare(strict_types=1);

const KS_ASSET_VERSION_ENTRY_LIMIT = 100000;

function ksStaticAsset(string $name): bool
{
	return preg_match(
		'/\.(?:avif|bin|bmp|css|csv|geojson|gif|gpx|ico|jpeg|jpg|js|json|kml|kmz|mvt|pbf|pmtiles|png|svg|tif|tiff|topojson|txt|wasm|webp|woff|woff2|xml)$/i',
		$name
	) === 1;
}

function ksJoinUrl(string $base, string $name): string
{
	if ($base === '/') return '/' . ltrim($name, '/');
	return rtrim($base, '/') . '/' . ltrim($name, '/');
}

function ksDatasetVersion(string $directory): string
{
	foreach (['.ks-version', 'ks-version.txt'] as $name) {
		$path = rtrim($directory, '/') . '/' . $name;
		if (!is_file($path)) continue;

		$value = trim((string)file_get_contents($path));
		if ($value !== '') return $value;

		$mtime = filemtime($path);
		if ($mtime !== false) return (string)$mtime;
	}

	$tilejson = rtrim($directory, '/') . '/tilejson.json';
	$tiles = rtrim($directory, '/') . '/tiles';
	if (is_file($tilejson) && is_dir($tiles)) {
		$mtime = filemtime($tilejson);
		if ($mtime !== false) return (string)$mtime;
	}

	return '';
}

function ksScanAssets(
	string $directory,
	string $urlPrefix,
	array &$files,
	array &$prefixes,
	array &$state,
	bool $root = false
): void {
	if (!is_dir($directory) || is_link($directory)) return;

	if (!$root) {
		$datasetVersion = ksDatasetVersion($directory);
		if ($datasetVersion !== '') {
			$prefixes[rtrim($urlPrefix, '/') . '/']
				= $datasetVersion;
			return;
		}
	}

	$entries = scandir($directory);
	if ($entries === false) return;

	foreach ($entries as $name) {
		if (
			$name === '.'
			|| $name === '..'
			|| str_starts_with($name, '.')
			|| $name === 'asset-versions.php'
		) {
			continue;
		}

		$state['visited']++;
		if ($state['visited'] > KS_ASSET_VERSION_ENTRY_LIMIT) {
			$state['truncated'] = true;
			$mtime = filemtime($directory);
			if ($mtime !== false) {
				$prefixes[rtrim($urlPrefix, '/') . '/']
					= (string)$mtime;
			}
			return;
		}

		$path = rtrim($directory, '/') . '/' . $name;
		$url = ksJoinUrl($urlPrefix, $name);

		if (is_link($path)) continue;
		if (is_dir($path)) {
			ksScanAssets(
				$path,
				$url,
				$files,
				$prefixes,
				$state
			);
			continue;
		}

		if (!is_file($path) || !ksStaticAsset($name)) continue;
		$mtime = filemtime($path);
		if ($mtime !== false) {
			$files[$url] = (string)$mtime;
		}
	}
}

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, max-age=0');
header('Pragma: no-cache');
header('Access-Control-Allow-Origin: *');

$files = [];
$prefixes = [];
$state = [
	'visited' => 0,
	'truncated' => false,
];

try {
	ksScanAssets(
		__DIR__,
		'/',
		$files,
		$prefixes,
		$state,
		true
	);
	ksort($files, SORT_STRING);
	ksort($prefixes, SORT_STRING);

	echo json_encode([
		'schema' => 1,
		'files' => $files,
		'prefixes' => $prefixes,
		'truncated' => $state['truncated'],
	], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
	echo "\n";
} catch (Throwable $error) {
	http_response_code(500);
	echo json_encode([
		'schema' => 1,
		'files' => new stdClass(),
		'prefixes' => new stdClass(),
		'error' => 'asset-version-manifest-failed',
	]);
	echo "\n";
}
