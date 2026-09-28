<?php

const KS_ASSET_VERSION_ENTRY_LIMIT = 100000;
const KS_ASSET_VERSION_MAX_SECONDS = 3.0;
const KS_ASSET_VERSION_MAX_DEPTH = 2;

function ksStaticAsset($name)
{
	return preg_match(
		'/\.(?:avif|bin|bmp|css|csv|geojson|gif|gpx|ico|jpeg|jpg|js|json|kml|kmz|mvt|pbf|pmtiles|png|svg|tif|tiff|topojson|txt|wasm|webp|woff|woff2|xml)$/i',
		$name
	) === 1;
}

function ksJoinUrl($base, $name)
{
	if ($base === '/') return '/' . ltrim($name, '/');
	return rtrim($base, '/') . '/' . ltrim($name, '/');
}

function ksFileVersion($path)
{
	$mtime = is_file($path) ? filemtime($path) : false;
	return $mtime === false ? '' : (string)$mtime;
}

function ksDirectoryVersion($path)
{
	$mtime = is_dir($path) ? filemtime($path) : false;
	return $mtime === false ? '' : (string)$mtime;
}

function ksDatasetVersion($directory)
{
	foreach (array('.ks-version', 'ks-version.txt') as $name) {
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
	if (is_array($pmtiles) && count($pmtiles) > 0) {
		$latest = 0;
		foreach ($pmtiles as $path) {
			$mtime = filemtime($path);
			if ($mtime !== false) $latest = max($latest, $mtime);
		}
		if ($latest > 0) return (string)$latest;
	}

	return '';
}

function ksScanBudgetExceeded(&$state, $urlPrefix)
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
	$directory,
	$urlPrefix,
	&$files,
	&$prefixes,
	&$state,
	$root = false,
	$depth = 0
) {
	if (!is_dir($directory) || is_link($directory)) return;
	if (ksScanBudgetExceeded($state, $urlPrefix)) return;

	if (!$root) {
		$datasetVersion = ksDatasetVersion($directory);
		if ($datasetVersion !== '') {
			$prefixes[rtrim($urlPrefix, '/') . '/'] = $datasetVersion;
			return;
		}

		if ($depth >= KS_ASSET_VERSION_MAX_DEPTH) {
			$directoryVersion = ksDirectoryVersion($directory);
			if ($directoryVersion !== '') {
				$prefix = rtrim($urlPrefix, '/') . '/';
				$prefixes[$prefix] = $directoryVersion;
				$state['coarsePrefixes'][] = $prefix;
			}
			return;
		}
	}

	try {
		$entries = new DirectoryIterator($directory);
	} catch (Exception $error) {
		return;
	}

	foreach ($entries as $entry) {
		if (ksScanBudgetExceeded($state, $urlPrefix)) return;
		if ($entry->isDot()) continue;

		$name = $entry->getFilename();
		if (
			$name === ''
			|| (isset($name[0]) && $name[0] === '.')
			|| $name === 'asset-versions.php'
			|| $name === 'php-health.php'
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
				$state,
				false,
				$depth + 1
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

$files = array();
$prefixes = array();
$state = array(
	'visited' => 0,
	'truncated' => false,
	'truncatedPrefixes' => array(),
	'coarsePrefixes' => array(),
	'deadline' => microtime(true) + KS_ASSET_VERSION_MAX_SECONDS,
);

try {
	ksScanAssets(
		__DIR__,
		'/',
		$files,
		$prefixes,
		$state,
		true,
		0
	);
	ksort($files, SORT_STRING);
	ksort($prefixes, SORT_STRING);
	$state['truncatedPrefixes'] = array_values(array_unique(
		$state['truncatedPrefixes']
	));
	$state['coarsePrefixes'] = array_values(array_unique(
		$state['coarsePrefixes']
	));

	echo json_encode(array(
		'schema' => 1,
		'files' => $files,
		'prefixes' => $prefixes,
		'truncated' => $state['truncated'],
		'truncatedPrefixes' => $state['truncatedPrefixes'],
		'coarsePrefixes' => $state['coarsePrefixes'],
		'scannedEntries' => $state['visited'],
	));
	echo "\n";
} catch (Exception $error) {
	http_response_code(500);
	echo json_encode(array(
		'schema' => 1,
		'files' => new stdClass(),
		'prefixes' => new stdClass(),
		'error' => 'asset-version-manifest-failed',
	));
	echo "\n";
}
