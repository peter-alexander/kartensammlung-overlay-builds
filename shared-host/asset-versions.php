<?php

declare(strict_types=1);

const KS_ASSET_VERSION_ENTRY_LIMIT = 100000;
const KS_ASSET_VERSION_MAX_SECONDS = 3.0;

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

function ksFileVersion(string $path): string
{
	$mtime = is_file($path) ? filemtime($path) : false;
	return $mtime === false ? '' : (string)$mtime;
}

function ksDatasetVersion(string $directory): string
{
	foreach (['.ks-version', 'ks-version.txt'] as $name) {
		$path = rtrim($directory, '/') . '/' . $name;
		if (!is_file($path)) continue;

		$value = trim((string)file_get_contents($path));
		if ($value !== '') return $value;

		$version = ksFileVersion($path);
		if ($version !== '') return $version;
	}

	$tilejson = rtrim($directory, '/') . '/tilejson.json';
	$tiles = rtrim($directory, '/') . '/tiles';
	if (is_file($tilejson) && is_dir($tiles)) {
		return ksFileVersion($tilejson);
	}

	$release = rtrim($directory, '/') . '/release.json';
	if (is_file($release)) {
		return ksFileVersion($release);
	}

	$pmtiles = glob(rtrim($directory, '/') . '/*.pmtiles');
	if (is_array($pmtiles) && $pmtiles !== []) {
		$latest = 0;
		foreach ($pmtiles as $path) {
			$mtime = filemtime($path);
			if ($mtime !== false) $latest = max($latest, $mtime);
		}
		if ($latest > 0) return (string)$latest;
	}

	return '';
}

function ksScanBudgetExceeded(array &$state, string $urlPrefix): bool
{
	if ($state['visited'] >= KS_ASSET_VERSION_ENTRY_LIMIT) {
		$state['truncated'] = true;
		$state['truncatedPrefixes'][] = rtrim($urlPrefix, '/') . '/';
		return true;
	}

	if (microtime(true) >= $state['deadline']) {
		$state['truncated'] = true;
		$state['truncatedPrefixes'][] = rtrim($urlPrefix, '/') . '/';
		return true;
	}

	return false;
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
	if (ksScanBudgetExceeded($state, $urlPrefix)) return;

	if (!$root) {
		$datasetVersion = ksDatasetVersion($directory);
		if ($datasetVersion !== '') {
			$prefixes[rtrim($urlPrefix, '/') . '/'] = $datasetVersion;
			return;
		}
	}

	try {
		$entries = new DirectoryIterator($directory);
	} catch (Throwable) {
		return;
	}

	foreach ($entries as $entry) {
		if (ksScanBudgetExceeded($state, $urlPrefix)) return;
		if ($entry->isDot()) continue;

		$name = $entry->getFilename();
		if (
			$name === ''
			|| str_starts_with($name, '.')
			|| $name === 'asset-versions.php'
		) {
			continue;
		}

		$state['visited']++;
		$path = $entry->getPathname();
		$url = ksJoinUrl($urlPrefix, $name);

		if ($entry->isLink()) continue;
		if ($entry->isDir()) {
			ksScanAssets(
				$path,
				$url,
				$files,
				$prefixes,
				$state
			);
			continue;
		}

		if (!$entry->isFile() || !ksStaticAsset($name)) continue;
		$mtime = $entry->getMTime();
		if ($mtime > 0) {
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
	'truncatedPrefixes' => [],
	'deadline' => microtime(true) + KS_ASSET_VERSION_MAX_SECONDS,
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
	$state['truncatedPrefixes'] = array_values(array_unique(
		$state['truncatedPrefixes']
	));

	echo json_encode([
		'schema' => 1,
		'files' => $files,
		'prefixes' => $prefixes,
		'truncated' => $state['truncated'],
		'truncatedPrefixes' => $state['truncatedPrefixes'],
		'scannedEntries' => $state['visited'],
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
