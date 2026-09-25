<?php
declare(strict_types=1);

define('RADNETZ_DASHBOARD_LIBRARY_ONLY', true);
require __DIR__ . '/lib.php';

try {
	$payload = radnetzDashboardBuildPayload();

	if (($payload['type'] ?? '') !== 'FeatureCollection' || !isset($payload['features']) || !is_array($payload['features'])) {
		throw new RuntimeException('Radnetz-Dashboard-Build ergab keine FeatureCollection.');
	}

	$count = count($payload['features']);
	if ($count < 10) {
		throw new RuntimeException('Unplausibel wenige Radnetz-Dashboard-Projekte: ' . $count);
	}

	$directory = __DIR__ . '/build';
	if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
		throw new RuntimeException('Build-Verzeichnis konnte nicht erstellt werden.');
	}

	$json = json_encode(
		$payload,
		JSON_UNESCAPED_SLASHES
		| JSON_UNESCAPED_UNICODE
		| JSON_INVALID_UTF8_SUBSTITUTE
		| JSON_THROW_ON_ERROR
	);

	$file = $directory . '/RadnetzDashboard.geojson';
	if (file_put_contents($file, $json . PHP_EOL, LOCK_EX) === false) {
		throw new RuntimeException('GeoJSON konnte nicht geschrieben werden.');
	}

	$mappable = (int)($payload['metadata']['mappableProjects'] ?? 0);
	$unmapped = (int)($payload['metadata']['unmappedProjects'] ?? 0);
	$mode = (string)($payload['metadata']['sourceMode'] ?? 'unknown');
	fwrite(STDOUT, "Radnetz-Dashboard: {$count} Projekte, {$mappable} kartierbar, {$unmapped} ohne Geometrie ({$mode}).\n");
	foreach ($payload['features'] as $feature) {
		if (($feature['geometry'] ?? null) !== null) continue;
		$props = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
		fwrite(
			STDOUT,
			'Ohne Geometrie: '
			. trim((string)($props['Projekttyp'] ?? '')) . ' | '
			. trim((string)($props['Jahr'] ?? '')) . ' | '
			. trim((string)($props['Titel'] ?? '')) . ' | '
			. trim((string)($props['Projektliste'] ?? ''))
			. PHP_EOL
		);
	}
	if (isset($payload['metadata']['warning'])) {
		fwrite(STDERR, 'WARNUNG: ' . $payload['metadata']['warning'] . PHP_EOL);
	}
	if (isset($payload['metadata']['liveError'])) {
		fwrite(STDERR, 'Live-Fehler: ' . $payload['metadata']['liveError'] . PHP_EOL);
	}
	foreach (($payload['metadata']['sourceStats'] ?? []) as $typeKey => $stats) {
		if (!empty($stats['yearOnlyMapPaths'])) {
			fwrite(STDOUT, 'Nur in Jahreskarten (' . $typeKey . '): ' . json_encode($stats['yearOnlyMapPaths'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL);
		}
	}
	foreach (($payload['metadata']['historyStats'] ?? []) as $sourceKey => $stats) {
		fwrite(
			STDOUT,
			sprintf(
				"Projektverlauf %s: %d Ereignisse für %d Projekte auf %d Seiten; Native-Refresh %s mit %d Projekt- und %d Ereignisentitäten (%d ohne fachliches Datum).\n",
				$sourceKey,
				(int)($stats['events'] ?? 0),
				(int)($stats['projects'] ?? 0),
				(int)($stats['pages'] ?? 0),
				(string)($stats['nativeRefreshMode'] ?? 'unbekannt'),
				(int)($stats['nativeProjectEntitiesFetched'] ?? 0),
				(int)($stats['nativeEventEntitiesFetched'] ?? 0),
				(int)($stats['nativeCreatedDateFallbacks'] ?? 0)
			)
		);
	}
	if ($mode === 'stale-production-fallback' && isset($payload['metadata']['sourceStats'])) {
		fwrite(STDERR, 'Fallback-Quellstatistik: ' . json_encode($payload['metadata']['sourceStats'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL);
	}
} catch (Throwable $error) {
	fwrite(STDERR, $error->getMessage() . PHP_EOL);
	exit(1);
}
