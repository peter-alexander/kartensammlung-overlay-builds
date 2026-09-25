<?php
declare(strict_types=1);

const RADNETZ_DASHBOARD_CACHE_DIR = __DIR__ . '/../../Cache/RadnetzDashboard';
const RADNETZ_DASHBOARD_CACHE_FILE = RADNETZ_DASHBOARD_CACHE_DIR . '/projects.geojson';
const RADNETZ_DASHBOARD_RETRY_FILE = RADNETZ_DASHBOARD_CACHE_DIR . '/refresh.failed';
const RADNETZ_DASHBOARD_CACHE_TTL = 1800;
const RADNETZ_DASHBOARD_RETRY_TTL = 1800;
const RADNETZ_DASHBOARD_HTTP_TIMEOUT = 45;
const RADNETZ_DASHBOARD_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const RADNETZ_DASHBOARD_USER_AGENT = 'Kartensammlung Radnetz-Dashboard Proxy/1.0 (+https://www.kartensammlung.at/)';
const RADNETZ_DASHBOARD_BASE_URL = 'https://radnetz-dashboard.radlobby.at/';
const RADNETZ_DASHBOARD_FALLBACK_URL = 'https://fahrrad.lima-city.de/Maps/RadnetzDashboard.geojson';
const RADNETZ_DASHBOARD_MIN_PROJECTS = 1000;
const RADNETZ_DASHBOARD_MAX_LIST_PAGES = 25;

if (!defined('RADNETZ_DASHBOARD_LIBRARY_ONLY')) {
	radnetzDashboardMain();
}

function radnetzDashboardMain(): void
{
	header('Content-Type: application/geo+json; charset=utf-8');
	header('Cache-Control: public, max-age=300, stale-if-error=604800');

	try {
		$forceRefresh = filter_var($_GET['refresh'] ?? false, FILTER_VALIDATE_BOOLEAN);
		radnetzDashboardEnsureCacheDirectory();
		if (!$forceRefresh) {
			$fresh = radnetzDashboardReadCache(RADNETZ_DASHBOARD_CACHE_TTL);
			if ($fresh !== null) radnetzDashboardRespond($fresh, 'fresh');
			$stale = radnetzDashboardReadCache();
			if ($stale !== null && !radnetzDashboardRefreshAllowed()) {
				radnetzDashboardRespond($stale, 'stale-backoff', 'Die Radlobby-Datenquelle ist vorübergehend nicht erreichbar.');
			}
		}

		$lockFile = RADNETZ_DASHBOARD_CACHE_DIR . '/projects.lock';
		$lock = fopen($lockFile, 'c+');
		if ($lock === false) throw new RuntimeException('Cache-Sperre konnte nicht geöffnet werden.');

		if (!flock($lock, LOCK_EX | LOCK_NB)) {
			$stale = radnetzDashboardReadCache();
			if ($stale !== null) {
				fclose($lock);
				radnetzDashboardRespond($stale, 'stale-refreshing', 'Die Radlobby-Daten werden gerade aktualisiert.');
			}
			fclose($lock);
			throw new RuntimeException('Radnetz-Dashboard-Aktualisierung läuft bereits.');
		}

		try {
			if (!$forceRefresh) {
				$fresh = radnetzDashboardReadCache(RADNETZ_DASHBOARD_CACHE_TTL);
				if ($fresh !== null) radnetzDashboardRespond($fresh, 'fresh-after-wait');
			}
			$payload = radnetzDashboardBuildPayload();
			radnetzDashboardAtomicWrite($payload);
			@unlink(RADNETZ_DASHBOARD_RETRY_FILE);
			radnetzDashboardRespond($payload, 'miss');
		} catch (Throwable $e) {
			radnetzDashboardMarkRefreshFailure();
			$stale = radnetzDashboardReadCache();
			if ($stale !== null) {
				radnetzDashboardRespond($stale, 'stale-error', 'Die Radlobby-Daten konnten nicht aktualisiert werden.');
			}
			throw $e;
		} finally {
			flock($lock, LOCK_UN);
			fclose($lock);
		}
	} catch (Throwable $e) {
		error_log('RadnetzDashboard: ' . $e->getMessage());
		http_response_code(502);
		echo json_encode([
			'type' => 'FeatureCollection',
			'features' => [],
			'error' => 'Radnetz-Dashboard konnte nicht geladen werden.',
		], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
	}
}

function radnetzDashboardEnsureCacheDirectory(): void
{
	if (!is_dir(RADNETZ_DASHBOARD_CACHE_DIR)
		&& !mkdir(RADNETZ_DASHBOARD_CACHE_DIR, 0775, true)
		&& !is_dir(RADNETZ_DASHBOARD_CACHE_DIR)
	) {
		throw new RuntimeException('Cache-Verzeichnis konnte nicht erstellt werden.');
	}
}

function radnetzDashboardReadCache(?int $maxAge = null): ?array
{
	if (!is_file(RADNETZ_DASHBOARD_CACHE_FILE)) return null;
	$mtime = filemtime(RADNETZ_DASHBOARD_CACHE_FILE);
	if ($mtime === false || ($maxAge !== null && $mtime + $maxAge < time())) return null;
	$data = json_decode((string)file_get_contents(RADNETZ_DASHBOARD_CACHE_FILE), true);
	return is_array($data) && ($data['type'] ?? '') === 'FeatureCollection' && isset($data['features']) ? $data : null;
}

function radnetzDashboardRefreshAllowed(): bool
{
	$mtime = is_file(RADNETZ_DASHBOARD_RETRY_FILE) ? filemtime(RADNETZ_DASHBOARD_RETRY_FILE) : false;
	return $mtime === false || $mtime + RADNETZ_DASHBOARD_RETRY_TTL < time();
}

function radnetzDashboardMarkRefreshFailure(): void
{
	@file_put_contents(RADNETZ_DASHBOARD_RETRY_FILE, gmdate('c') . PHP_EOL, LOCK_EX);
}

function radnetzDashboardAtomicWrite(array $payload): void
{
	$json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
	$tmp = RADNETZ_DASHBOARD_CACHE_FILE . '.tmp.' . bin2hex(random_bytes(4));
	if (file_put_contents($tmp, $json . PHP_EOL, LOCK_EX) === false || !rename($tmp, RADNETZ_DASHBOARD_CACHE_FILE)) {
		@unlink($tmp);
		throw new RuntimeException('Radnetz-Dashboard-Cache konnte nicht geschrieben werden.');
	}
}

function radnetzDashboardRespond(array $payload, string $cache, string $warning = ''): never
{
	$payload['metadata'] = is_array($payload['metadata'] ?? null) ? $payload['metadata'] : [];
	$payload['metadata']['cache'] = $cache;
	if ($warning !== '') $payload['metadata']['warning'] = $warning;
	echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
	exit;
}

function radnetzDashboardBuildPayload(): array
{
	$previous = radnetzDashboardPreviousPayload();

	try {
		return radnetzDashboardBuildLivePayload($previous);
	} catch (Throwable $liveError) {
		if ($previous === null) {
			throw new RuntimeException(
				'Live-Abruf fehlgeschlagen und kein gültiger veröffentlichter Stand verfügbar: ' . $liveError->getMessage(),
				0,
				$liveError
			);
		}

		$previous['metadata'] = is_array($previous['metadata'] ?? null) ? $previous['metadata'] : [];
		$previous['metadata']['sourceMode'] = 'stale-production-fallback';
		$previous['metadata']['fallbackCheckedAt'] = gmdate('c');
		$previous['metadata']['warning'] = 'Live-Abruf fehlgeschlagen; letzter veröffentlichter Stand wird beibehalten.';
		$previous['metadata']['liveError'] = $liveError->getMessage();
		return $previous;
	}
}

function radnetzDashboardBuildLivePayload(?array $previous = null): array
{
	$statuses = [];
	try {
		$statuses = radnetzDashboardStatuses(radnetzDashboardHttp(
			RADNETZ_DASHBOARD_BASE_URL . 'statuses.json',
			'application/json',
			1,
			10
		));
	} catch (Throwable) {
		// Die Kartenansicht liefert die tatsächlich verwendete Farbe je Projekt mit.
	}

	$previousByKey = radnetzDashboardPreviousFeaturesByKey($previous);
	$features = [];
	$sourceStats = [];
	foreach (radnetzDashboardSourceDefinitions() as $typeKey => $source) {
		[$rows, $pages] = radnetzDashboardFetchListRows($source['type'], $typeKey);
		$years = radnetzDashboardYearsFromRows($rows);

		// The unfiltered category map is the completeness baseline. This matters
		// especially for "Weitere Bauprojekte", where many projects have no year.
		// Year-specific views then override matching projects so historical colors
		// and geometries come from the official view for that exact year.
		$mapProjects = radnetzDashboardFetchMapProjects($source['type']);
		$overviewMapProjects = count($mapProjects);
		$overviewMapPaths = array_fill_keys(array_keys($mapProjects), true);
		$yearOnlyMapPaths = [];
		$mapProjectsByYear = [];

		foreach ($years as $year) {
			$yearProjects = radnetzDashboardFetchMapProjects($source['type'], $year);
			$mapProjectsByYear[$year] = count($yearProjects);
			foreach ($yearProjects as $path => $mapProject) {
				if (!isset($overviewMapPaths[$path])) $yearOnlyMapPaths[$path] = $year;
				$mapProjects[$path] = $mapProject;
			}
		}

		$matchedMapPaths = [];

		foreach ($rows as $path => $row) {
			$mapProject = $mapProjects[$path] ?? null;
			if ($mapProject !== null) $matchedMapPaths[$path] = true;
			$key = radnetzDashboardProjectKey($typeKey, (string)($row['Jahr'] ?? ''), (string)($row['Titel'] ?? ''));
			$features[] = radnetzDashboardViewFeature(
				$row,
				$mapProject,
				$typeKey,
				$source['label'],
				$statuses,
				$previousByKey[$key] ?? null
			);
		}

		foreach (array_diff_key($mapProjects, $matchedMapPaths) as $mapProject) {
			$row = radnetzDashboardMapFallbackRow($mapProject);
			$key = radnetzDashboardProjectKey($typeKey, (string)($row['Jahr'] ?? ''), (string)($row['Titel'] ?? ''));
			$features[] = radnetzDashboardViewFeature(
				$row,
				$mapProject,
				$typeKey,
				$source['label'],
				$statuses,
				$previousByKey[$key] ?? null
			);
		}

		$sourceStats[$typeKey] = [
			'listProjects' => count($rows),
			'mapProjects' => count($mapProjects),
			'overviewMapProjects' => $overviewMapProjects,
			'yearOnlyMapProjects' => count($yearOnlyMapPaths),
			'yearOnlyMapPaths' => $yearOnlyMapPaths,
			'listPages' => $pages,
			'mapViews' => count($years) + 1,
			'mapYears' => $years,
			'mapProjectsByYear' => $mapProjectsByYear,
			'mapOnlyProjects' => count(array_diff_key($mapProjects, $matchedMapPaths)),
		];
	}

	$count = count($features);
	$mappable = count(array_filter($features, static fn(array $feature): bool => $feature['geometry'] !== null));
	if ($count < RADNETZ_DASHBOARD_MIN_PROJECTS || $mappable < RADNETZ_DASHBOARD_MIN_PROJECTS) {
		$sourceSummary = [];
		foreach ($sourceStats as $typeKey => $stats) {
			$yearCounts = [];
			foreach (($stats['mapProjectsByYear'] ?? []) as $year => $yearCount) {
				$yearCounts[] = $year . ':' . $yearCount;
			}
			$sourceSummary[] = sprintf(
				'%s list=%d map=%d years=[%s]',
				$typeKey,
				(int)($stats['listProjects'] ?? 0),
				(int)($stats['mapProjects'] ?? 0),
				implode(',', $yearCounts)
			);
		}
		throw new RuntimeException(
			"Unplausibel unvollständiger Dashboard-Abruf: {$count} Projekte, {$mappable} kartierbar; "
			. implode('; ', $sourceSummary)
		);
	}
	if ($previous !== null && isset($previous['features']) && $count < count($previous['features']) * 0.9) {
		throw new RuntimeException('Live-Abruf enthält mehr als zehn Prozent weniger Projekte als der veröffentlichte Stand.');
	}

	$unmapped = $count - $mappable;

	$years = array_values(array_unique(array_filter(array_map(
		static fn(array $feature): string => trim((string)($feature['properties']['Jahr'] ?? '')),
		$features
	))));
	sort($years, SORT_NATURAL);
	$statusCounts = [];
	$typeCounts = [];
	$statusColors = [];
	foreach ($features as $feature) {
		$status = (string)($feature['properties']['Status'] ?? 'Ohne Status');
		$type = (string)($feature['properties']['Projekttyp'] ?? '');
		$statusCounts[$status] = ($statusCounts[$status] ?? 0) + 1;
		$typeCounts[$type] = ($typeCounts[$type] ?? 0) + 1;
		$statusColors[$status] ??= (string)($feature['properties']['Statusfarbe'] ?? '#6b7280');
	}
	foreach ($statusCounts as $status => $_count) {
		$key = mb_strtolower($status, 'UTF-8');
		$statuses[$key] ??= ['name' => $status, 'color' => $statusColors[$status] ?? '#6b7280'];
	}

	return [
		'type' => 'FeatureCollection',
		'features' => $features,
		'metadata' => [
			'generatedAt' => gmdate('c'),
			'source' => RADNETZ_DASHBOARD_BASE_URL,
			'sourceMode' => 'dashboard-rendered-views',
			'sources' => [
				RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte?type=2',
				RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte?type=2&jahr={year}',
				RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte?type=3',
				RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte?type=3&jahr={year}',
				RADNETZ_DASHBOARD_BASE_URL . 'bauprojekte?type=2',
				RADNETZ_DASHBOARD_BASE_URL . 'bauprojekte?type=3',
			],
			'projects' => $count,
			'mappableProjects' => $mappable,
			'unmappedProjects' => $unmapped,
			'sourceStats' => $sourceStats,
			'years' => $years,
			'statuses' => array_values($statuses),
			'statusCounts' => $statusCounts,
			'typeCounts' => $typeCounts,
		],
	];
}

function radnetzDashboardSourceDefinitions(): array
{
	return [
		'bauprogramm' => ['type' => 2, 'label' => 'Bauprogramm Stadt Wien'],
		'weitere' => ['type' => 3, 'label' => 'Weitere Bauprojekte'],
	];
}

function radnetzDashboardPreviousPayload(): ?array
{
	try {
		$payload = json_decode(
			radnetzDashboardHttp(
				RADNETZ_DASHBOARD_FALLBACK_URL,
				'application/geo+json, application/json',
				1,
				15
			),
			true,
			512,
			JSON_THROW_ON_ERROR
		);
		if (!is_array($payload)
			|| ($payload['type'] ?? '') !== 'FeatureCollection'
			|| !is_array($payload['features'] ?? null)
			|| count($payload['features']) < RADNETZ_DASHBOARD_MIN_PROJECTS
		) {
			return null;
		}
		return $payload;
	} catch (Throwable) {
		return null;
	}
}

function radnetzDashboardPreviousFeaturesByKey(?array $payload): array
{
	$out = [];
	foreach ($payload['features'] ?? [] as $feature) {
		if (!is_array($feature) || !is_array($feature['properties'] ?? null)) continue;
		$properties = $feature['properties'];
		$typeKey = (string)($properties['_projectType'] ?? '');
		if ($typeKey === '') {
			$typeKey = ($properties['Projekttyp'] ?? '') === 'Weitere Bauprojekte' ? 'weitere' : 'bauprogramm';
		}
		$key = radnetzDashboardProjectKey($typeKey, (string)($properties['Jahr'] ?? ''), (string)($properties['Titel'] ?? ''));
		if ($key !== '') $out[$key] = $feature;
	}
	return $out;
}

function radnetzDashboardProjectKey(string $typeKey, string $year, string $title): string
{
	$title = mb_strtolower(trim($title), 'UTF-8');
	$title = preg_replace('/[\p{P}\p{Z}\p{C}]+/u', '', $title) ?? $title;
	return $title === '' ? '' : implode('|', [$typeKey, trim($year), $title]);
}

function radnetzDashboardYearsFromRows(array $rows): array
{
	$years = [];
	foreach ($rows as $row) {
		$year = trim((string)($row['Jahr'] ?? ''));
		if ($year === '' || !preg_match('/^(?:19|20)\\d{2}$/', $year)) continue;
		$years[] = $year;
	}
	$years = array_values(array_unique($years, SORT_STRING));
	sort($years, SORT_NATURAL);
	return $years;
}

function radnetzDashboardMapUrl(int $type, ?string $year = null): string
{
	$params = ['type' => $type];
	$year = trim((string)$year);
	if ($year !== '') $params['jahr'] = $year;
	return RADNETZ_DASHBOARD_BASE_URL . 'bauprogramm/karte?' . http_build_query($params);
}

function radnetzDashboardFetchMapProjects(int $type, ?string $year = null): array
{
	$html = radnetzDashboardHttp(
		radnetzDashboardMapUrl($type, $year),
		'text/html,application/xhtml+xml'
	);
	$projects = radnetzDashboardParseMapHtml($html);

	$year = trim((string)$year);
	if ($year === '') return $projects;

	$projects = array_filter(
		$projects,
		static fn(array $project): bool => trim((string)($project['popup']['Jahr'] ?? '')) === $year
	);
	if (!$projects) {
		throw new RuntimeException("Drupal-Kartenansicht enthält keine Projekte für Typ {$type} und Jahr {$year}.");
	}
	return $projects;
}

function radnetzDashboardParseMapHtml(string $html): array
{
	$selector = strpos($html, 'data-drupal-selector="drupal-settings-json"');
	if ($selector === false) $selector = strpos($html, "data-drupal-selector='drupal-settings-json'");
	$start = $selector === false ? false : strpos($html, '>', $selector);
	$end = $start === false ? false : strpos($html, '</script>', $start + 1);
	if ($start === false || $end === false) {
		throw new RuntimeException('Drupal-Karteneinstellungen fehlen.');
	}

	$settings = json_decode(substr($html, $start + 1, $end - $start - 1), true, 512, JSON_THROW_ON_ERROR);
	$projects = [];
	foreach (($settings['leaflet'] ?? []) as $map) {
		foreach (($map['features'] ?? []) as $feature) {
			if (!is_array($feature)) continue;
			$popup = (string)($feature['popup']['value'] ?? '');
			$path = radnetzDashboardPopupPath($popup);
			if ($path === '') continue;
			$projects[$path] = [
				'path' => $path,
				'entityId' => trim((string)($feature['entity_id'] ?? '')),
				'geometry' => radnetzDashboardMapGeometry($feature),
				'color' => radnetzDashboardMapColor($feature),
				'popup' => radnetzDashboardPopupProperties($popup),
			];
		}
	}

	if (!$projects) throw new RuntimeException('Drupal-Kartenansicht enthält keine Projekte.');
	return $projects;
}

function radnetzDashboardPopupPath(string $popup): string
{
	if (!preg_match('~<a\b[^>]*href=["\']([^"\']+)["\']~i', $popup, $match)) return '';
	$url = html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
	$path = parse_url($url, PHP_URL_PATH);
	return is_string($path) ? '/' . ltrim($path, '/') : '';
}

function radnetzDashboardPopupProperties(string $popup): array
{
	$title = '';
	if (preg_match('~<b>\s*<a\b[^>]*>(.*?)</a>\s*</b>~si', $popup, $match)) {
		$title = radnetzDashboardHtmlText($match[1]);
	}
	$measure = '';
	if (preg_match('~</b>\s*<br\s*/?>\s*(.*?)\s*<br\s*/?>~si', $popup, $match)) {
		$measure = radnetzDashboardHtmlText($match[1]);
	}
	$status = '';
	if (preg_match('~Status:\s*(.*?)\s*(?:<br\s*/?>|$)~si', $popup, $match)) {
		$status = radnetzDashboardHtmlText($match[1]);
	}
	$year = '';
	if (preg_match('~(?:Bauprogramm|weiteres Projekt)\s+(\d{4})~iu', radnetzDashboardHtmlText($popup), $match)) {
		$year = $match[1];
	}
	$districts = [];
	if (preg_match_all('~<a\b[^>]*href=["\']/bezirk/[^"\']+["\'][^>]*>(.*?)</a>~si', $popup, $matches)) {
		$districts = array_values(array_filter(array_map('radnetzDashboardHtmlText', $matches[1])));
	}
	return [
		'Titel' => $title,
		'Maßnahme' => $measure,
		'Bezirk' => implode(', ', $districts),
		'Jahr' => $year,
		'Status' => $status,
	];
}

function radnetzDashboardHtmlText(string $html): string
{
	$text = html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
	return preg_replace('/\s+/u', ' ', trim($text)) ?? trim($text);
}

function radnetzDashboardMapColor(array $feature): string
{
	// Leaflet GeometryCollections/MultiPolylines may carry the effective style
	// on their rendered child components. Prefer that child style over a
	// wrapper-level fallback so the exported color matches the official map.
	foreach (($feature['component'] ?? []) as $component) {
		if (!is_array($component)) continue;
		$color = radnetzDashboardMapColor($component);
		if ($color !== '') return $color;
	}

	foreach ([$feature['path'] ?? null, $feature['icon']['options'] ?? null] as $json) {
		if (!is_string($json) || $json === '') continue;
		$options = json_decode($json, true);
		if (!is_array($options)) continue;
		$color = strtolower(trim((string)($options['color'] ?? '')));
		if (preg_match('/^#[0-9a-f]{6}$/', $color)) return $color;
	}
	return '';
}

function radnetzDashboardMapGeometry(array $feature): ?array
{
	$type = strtolower((string)($feature['type'] ?? ''));
	if ($type === 'point') {
		return isset($feature['lon'], $feature['lat'])
			? ['type' => 'Point', 'coordinates' => [(float)$feature['lon'], (float)$feature['lat']]]
			: null;
	}
	if ($type === 'linestring') {
		$coordinates = radnetzDashboardMapPoints($feature['points'] ?? []);
		return count($coordinates) >= 2 ? ['type' => 'LineString', 'coordinates' => $coordinates] : null;
	}
	if ($type === 'multipolyline') {
		$coordinates = [];
		foreach (($feature['component'] ?? []) as $component) {
			$line = radnetzDashboardMapPoints($component['points'] ?? []);
			if (count($line) >= 2) $coordinates[] = $line;
		}
		return $coordinates ? ['type' => 'MultiLineString', 'coordinates' => $coordinates] : null;
	}
	if ($type === 'geometrycollection') {
		$geometries = [];
		foreach (($feature['component'] ?? []) as $component) {
			$geometry = is_array($component) ? radnetzDashboardMapGeometry($component) : null;
			if ($geometry !== null) $geometries[] = $geometry;
		}
		return $geometries ? ['type' => 'GeometryCollection', 'geometries' => $geometries] : null;
	}
	return null;
}

function radnetzDashboardMapPoints(array $points): array
{
	$out = [];
	foreach ($points as $point) {
		if (!is_array($point) || !isset($point['lon'], $point['lat'])) continue;
		$out[] = [(float)$point['lon'], (float)$point['lat']];
	}
	return $out;
}

function radnetzDashboardFetchListRows(int $type, string $typeKey): array
{
	$rows = [];
	$pages = 0;
	for ($page = 0; $page < RADNETZ_DASHBOARD_MAX_LIST_PAGES; $page++) {
		$html = radnetzDashboardHttp(
			RADNETZ_DASHBOARD_BASE_URL . 'bauprojekte?' . http_build_query(['type' => $type, 'page' => $page]),
			'text/html,application/xhtml+xml'
		);
		$parsed = radnetzDashboardParseListHtml($html, $typeKey);
		$pages++;
		foreach ($parsed['rows'] as $path => $row) $rows[$path] = $row;
		if (!$parsed['hasNext']) return [$rows, $pages];
	}
	throw new RuntimeException('Dashboard-Projektliste überschreitet das Seitenlimit.');
}

function radnetzDashboardParseListHtml(string $html, string $typeKey): array
{
	$document = new DOMDocument();
	$previous = libxml_use_internal_errors(true);
	try {
		$loaded = $document->loadHTML($html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
	} finally {
		libxml_clear_errors();
		libxml_use_internal_errors($previous);
	}
	if (!$loaded) throw new RuntimeException('Dashboard-Projektliste ist kein gültiges HTML.');

	$xpath = new DOMXPath($document);
	$rows = [];
	foreach ($xpath->query('//tbody/tr[td[@headers="view-title-table-column"]]') ?: [] as $rowNode) {
		$titleCell = radnetzDashboardTableCell($xpath, $rowNode, 'view-title-table-column');
		if ($titleCell === null) continue;
		$linkNodes = $xpath->query('.//a[not(.//img)]', $titleCell);
		$link = $linkNodes && $linkNodes->length ? $linkNodes->item($linkNodes->length - 1) : null;
		if (!$link instanceof DOMElement) continue;
		$path = radnetzDashboardNormalizePath($link->getAttribute('href'));
		$title = radnetzDashboardNodeText($link);
		if ($path === '' || $title === '') continue;

		$districtCell = radnetzDashboardTableCell($xpath, $rowNode, 'view-field-bezirk-table-column');
		$districtCodes = [];
		if ($districtCell !== null) {
			foreach ($xpath->query('.//a', $districtCell) ?: [] as $districtLink) {
				if ($districtLink instanceof DOMElement) {
					$code = radnetzDashboardDistrictCodeFromPath($districtLink->getAttribute('href'));
					if ($code !== '') $districtCodes[] = $code;
				}
			}
		}
		$districtCodes = array_values(array_unique($districtCodes));
		$lengths = radnetzDashboardTableLengths(radnetzDashboardTableText($xpath, $rowNode, 'view-field-geometry-table-column'));
		$yearText = radnetzDashboardTableText($xpath, $rowNode, 'view-field-jahr-table-column');
		preg_match('/\b(?:19|20)\d{2}\b/', $yearText, $yearMatch);

		$rows[$path] = [
			'_path' => $path,
			'_fromList' => true,
			'_districtCodes' => $districtCodes,
			'Jahr' => $yearMatch[0] ?? '',
			'Titel' => $title,
			'Maßnahme' => radnetzDashboardTableText($xpath, $rowNode, 'view-field-massnahme-table-column'),
			'Bezirk' => radnetzDashboardTableText($xpath, $rowNode, 'view-field-bezirk-table-column'),
			'Status' => radnetzDashboardNormalizeStatus(radnetzDashboardTableText($xpath, $rowNode, 'view-field-status-table-column')),
			'Netze' => radnetzDashboardTableText($xpath, $rowNode, 'view-field-netze-table-column'),
			'Radrouten' => radnetzDashboardTableText($xpath, $rowNode, 'view-field-route-table-column'),
			'Tags' => radnetzDashboardTableText($xpath, $rowNode, 'view-field-tags-table-column'),
			'Ankündigung' => radnetzDashboardTableDate($xpath, $rowNode, 'view-field-ankuendigung-table-column'),
			'Baubeginn' => radnetzDashboardTableDate($xpath, $rowNode, 'view-field-baubeginn-table-column'),
			'Bauende' => radnetzDashboardTableDate($xpath, $rowNode, 'view-field-bauende-table-column'),
			'Fertigstellung' => radnetzDashboardTableDate($xpath, $rowNode, 'view-field-datum-ende-table-column'),
			'Rückbau' => radnetzDashboardTableDate($xpath, $rowNode, 'view-field-entfernung-table-column'),
			'Letzte Statusänderung' => radnetzDashboardTableDate($xpath, $rowNode, 'view-field-status-change-table-column'),
			'Länge' => $lengths['route'],
			'Anlagenlänge' => $lengths['facility'],
		];
	}

	$next = $xpath->query('//nav[contains(concat(" ", normalize-space(@class), " "), " pager ")]//a[@rel="next"]');
	return ['rows' => $rows, 'hasNext' => $next !== false && $next->length > 0];
}

function radnetzDashboardTableCell(DOMXPath $xpath, DOMNode $row, string $header): ?DOMElement
{
	$nodes = $xpath->query('./td[@headers="' . $header . '"]', $row);
	$node = $nodes && $nodes->length ? $nodes->item(0) : null;
	return $node instanceof DOMElement ? $node : null;
}

function radnetzDashboardTableText(DOMXPath $xpath, DOMNode $row, string $header): string
{
	$cell = radnetzDashboardTableCell($xpath, $row, $header);
	return $cell === null ? '' : radnetzDashboardNodeText($cell);
}

function radnetzDashboardNodeText(DOMNode $node): string
{
	return preg_replace('/\s+/u', ' ', trim($node->textContent)) ?? trim($node->textContent);
}

function radnetzDashboardTableDate(DOMXPath $xpath, DOMNode $row, string $header): string
{
	$cell = radnetzDashboardTableCell($xpath, $row, $header);
	if ($cell === null) return '';
	$times = $xpath->query('.//time[@datetime]', $cell);
	if ($times && $times->length && $times->item(0) instanceof DOMElement) {
		$value = $times->item(0)->getAttribute('datetime');
		return substr($value, 0, 10);
	}
	return radnetzDashboardNodeText($cell);
}

function radnetzDashboardTableLengths(string $text): array
{
	$route = '';
	$facility = '';
	if (preg_match('/Strecke:\s*([0-9.,]+)\s*m/iu', $text, $match)) $route = $match[1];
	if (preg_match('/Anlage:\s*([0-9.,]+)\s*m/iu', $text, $match)) $facility = $match[1];
	return ['route' => $route, 'facility' => $facility];
}

function radnetzDashboardNormalizePath(string $url): string
{
	$url = html_entity_decode(trim($url), ENT_QUOTES | ENT_HTML5, 'UTF-8');
	$path = parse_url($url, PHP_URL_PATH);
	return is_string($path) && $path !== '' ? '/' . ltrim($path, '/') : '';
}

function radnetzDashboardDistrictCodeFromPath(string $path): string
{
	$slug = basename(radnetzDashboardNormalizePath($path));
	$codes = [
		'innere-stadt' => '1010', 'leopoldstadt' => '1020', 'landstrasse' => '1030',
		'wieden' => '1040', 'margareten' => '1050', 'mariahilf' => '1060', 'neubau' => '1070',
		'josefstadt' => '1080', 'alsergrund' => '1090', 'favoriten' => '1100', 'simmering' => '1110',
		'meidling' => '1120', 'hietzing' => '1130', 'penzing' => '1140', 'rudolfsheim-fuenfhaus' => '1150',
		'ottakring' => '1160', 'hernals' => '1170', 'waehring' => '1180', 'doebling' => '1190',
		'brigittenau' => '1200', 'floridsdorf' => '1210', 'donaustadt' => '1220', 'liesing' => '1230',
	];
	return $codes[$slug] ?? '';
}

function radnetzDashboardNormalizeStatus(string $status): string
{
	$status = preg_replace('/\s+/u', ' ', trim($status)) ?? trim($status);
	foreach ([
		'nicht angekündigt', 'in Bauvorbereitung', 'in Vorbereitung', 'fertiggestellt',
		'angekündigt', 'in Planung', 'in Arbeit', 'verschoben', 'rückgebaut', 'abgesagt', 'in Bau',
	] as $known) {
		if (mb_strtolower(mb_substr($status, 0, mb_strlen($known)), 'UTF-8') === mb_strtolower($known, 'UTF-8')) {
			return $known;
		}
	}
	return $status;
}

function radnetzDashboardMapFallbackRow(array $mapProject): array
{
	return array_replace($mapProject['popup'] ?? [], [
		'_path' => (string)($mapProject['path'] ?? ''),
		'_fromList' => false,
		'_districtCodes' => [],
	]);
}

function radnetzDashboardViewFeature(
	array $row,
	?array $mapProject,
	string $typeKey,
	string $typeLabel,
	array $statuses,
	?array $previous
): array {
	$properties = is_array($previous['properties'] ?? null) ? $previous['properties'] : [];
	$status = radnetzDashboardNormalizeStatus((string)($row['Status'] ?? ($mapProject['popup']['Status'] ?? '')));
	$statusEntry = $statuses[mb_strtolower($status, 'UTF-8')] ?? null;
	$districtCodes = array_values(array_unique(array_filter($row['_districtCodes'] ?? [])));
	if (!$districtCodes && isset($properties['_districtCodes'])) {
		preg_match_all('/\b(?:10[1-9]0|1[12][0-9]0)\b/', (string)$properties['_districtCodes'], $matches);
		$districtCodes = array_values(array_unique($matches[0] ?? []));
	}
	$entityId = trim((string)($mapProject['entityId'] ?? ''));
	$path = (string)($row['_path'] ?? ($mapProject['path'] ?? ''));
	$title = trim((string)($row['Titel'] ?? ($mapProject['popup']['Titel'] ?? '')));
	$year = trim((string)($row['Jahr'] ?? ($mapProject['popup']['Jahr'] ?? '')));
	$id = (string)($properties['Projekt-ID'] ?? ($previous['id'] ?? ''));
	if ($id === '') $id = $entityId !== '' ? 'radnetz-' . $entityId : substr(hash('sha256', implode('|', [$typeKey, $year, $title, $path])), 0, 20);
	$color = trim((string)($mapProject['color'] ?? ''));
	if ($color === '') $color = (string)($statusEntry['color'] ?? '#6b7280');
	$district = $districtCodes
		? implode(', ', array_map('radnetzDashboardDistrictName', $districtCodes))
		: (string)($row['Bezirk'] ?? ($mapProject['popup']['Bezirk'] ?? ''));

	$current = [
		'Projekt-ID' => $id,
		'Projekttyp' => $typeLabel,
		'Jahr' => $year,
		'Titel' => $title,
		'Maßnahme' => $row['Maßnahme'] ?? ($mapProject['popup']['Maßnahme'] ?? ''),
		'Bezirk' => $district,
		'Postleitzahl' => implode(', ', $districtCodes),
		'Status' => $status,
		'Projektliste' => $path === '' ? RADNETZ_DASHBOARD_BASE_URL : RADNETZ_DASHBOARD_BASE_URL . ltrim($path, '/'),
		'Statusfarbe' => $color,
		'_projectType' => $typeKey,
		'_sourceEntityId' => $entityId,
		'_districtCodes' => ',' . implode(',', $districtCodes) . ',',
	];
	if (($row['_fromList'] ?? false) === true) {
		$current = array_replace($current, [
			'Letzte Statusänderung' => $row['Letzte Statusänderung'] ?? '',
			'Ankündigung' => $row['Ankündigung'] ?? '',
			'Baubeginn' => $row['Baubeginn'] ?? '',
			'Bauende' => $row['Bauende'] ?? '',
			'Fertigstellung' => $row['Fertigstellung'] ?? '',
			'Rückbau' => $row['Rückbau'] ?? '',
			'Netze' => $row['Netze'] ?? '',
			'Radrouten' => $row['Radrouten'] ?? '',
			'Tags' => $row['Tags'] ?? '',
			'Länge' => $row['Länge'] ?? '',
			'Anlagenlänge' => $row['Anlagenlänge'] ?? '',
			'_lengthMeters' => radnetzDashboardNumericValue((string)($row['Länge'] ?? '')),
			'_facilityLengthMeters' => radnetzDashboardNumericValue((string)($row['Anlagenlänge'] ?? '')),
		]);
	}
	$properties = array_replace($properties, $current);
	$searchValues = [];
	foreach ($properties as $key => $value) {
		if (!str_starts_with((string)$key, '_') && is_scalar($value)) $searchValues[] = (string)$value;
	}
	$properties['_searchText'] = mb_strtolower(implode(' ', $searchValues), 'UTF-8');
	$properties = array_filter(
		$properties,
		static fn(mixed $value, string $key): bool => str_starts_with($key, '_') || $value !== '',
		ARRAY_FILTER_USE_BOTH
	);

	return [
		'type' => 'Feature',
		'id' => $id,
		'properties' => $properties,
		'geometry' => radnetzDashboardMergedGeometry($mapProject['geometry'] ?? null, $previous['geometry'] ?? null),
	];
}

function radnetzDashboardMergedGeometry(?array $live, mixed $previous): ?array
{
	if ($live === null) return null;
	if (!is_array($previous) || ($previous['type'] ?? '') !== 'GeometryCollection') return $live;

	$liveParts = ($live['type'] ?? '') === 'GeometryCollection'
		? array_values(array_filter($live['geometries'] ?? [], 'is_array'))
		: [$live];
	$previousParts = array_values(array_filter($previous['geometries'] ?? [], 'is_array'));
	if (!$liveParts || count($previousParts) <= count($liveParts)) return $live;

	return [
		'type' => 'GeometryCollection',
		'geometries' => array_merge($liveParts, array_slice($previousParts, count($liveParts))),
	];
}

function radnetzDashboardFetchAll(array $urls): array
{
	$bodies = [];
	foreach ($urls as $key => $url) {
		$bodies[$key] = radnetzDashboardHttp($url, $key === 'statuses' ? 'application/json' : 'text/csv');
	}
	return $bodies;
}

function radnetzDashboardHttp(
	string $url,
	string $accept,
	int $attempts = 3,
	int $timeout = RADNETZ_DASHBOARD_HTTP_TIMEOUT
): string
{
	$lastError = 'Unbekannter HTTP-Fehler.';
	$attempts = max(1, $attempts);
	$timeout = max(1, $timeout);

	for ($attempt = 1; $attempt <= $attempts; $attempt++) {
		$body = '';
		$ch = curl_init($url);
		if ($ch === false) {
			throw new RuntimeException('HTTP-Anfrage konnte nicht initialisiert werden.');
		}

		curl_setopt_array($ch, [
			CURLOPT_RETURNTRANSFER => false,
			CURLOPT_FOLLOWLOCATION => true,
			CURLOPT_MAXREDIRS => 5,
			CURLOPT_CONNECTTIMEOUT => 12,
			CURLOPT_TIMEOUT => $timeout,
			CURLOPT_ENCODING => '',
			CURLOPT_USERAGENT => RADNETZ_DASHBOARD_USER_AGENT,
			CURLOPT_HTTPHEADER => ['Accept: ' . $accept],
			CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
				if (strlen($body) + strlen($chunk) > RADNETZ_DASHBOARD_MAX_RESPONSE_BYTES) {
					return 0;
				}

				$body .= $chunk;
				return strlen($chunk);
			},
		]);

		curl_exec($ch);
		$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
		$error = curl_error($ch);
		curl_close($ch);

		if ($error === '' && $status >= 200 && $status < 300 && $body !== '') {
			return $body;
		}

		$lastError = $error !== '' ? $error : 'HTTP ' . $status;

		if ($attempt < $attempts) {
			sleep($attempt * 3);
		}
	}

	throw new RuntimeException($lastError);
}

function radnetzDashboardStatuses(string $json): array
{
	$data = json_decode($json, true);
	if (!is_array($data)) throw new RuntimeException('Ungültige Statusliste.');
	$out = [];
	foreach ($data as $entry) {
		$name = trim((string)($entry['name'] ?? ''));
		$color = trim((string)($entry['field_color'] ?? ''));
		if ($name === '' || !preg_match('/^#[0-9a-f]{6}$/i', $color)) continue;
		$out[mb_strtolower($name, 'UTF-8')] = ['name' => $name, 'color' => strtolower($color)];
	}
	if (!$out) throw new RuntimeException('Leere Statusliste.');
	return $out;
}

function radnetzDashboardParseCsv(string $csv): array
{
	$stream = fopen('php://temp', 'w+');
	if ($stream === false) throw new RuntimeException('CSV konnte nicht geöffnet werden.');
	fwrite($stream, $csv);
	rewind($stream);
	$header = fgetcsv($stream);
	if (!is_array($header)) throw new RuntimeException('CSV-Kopfzeile fehlt.');
	$header = array_map(static fn(string $value): string => trim($value), $header);
	$header[0] = preg_replace('/^\xEF\xBB\xBF/', '', $header[0]) ?? $header[0];
	$rows = [];
	while (($values = fgetcsv($stream)) !== false) {
		if ($values === [null] || !array_filter($values, static fn(mixed $value): bool => trim((string)$value) !== '')) continue;
		$values = array_pad($values, count($header), '');
		$row = array_combine($header, array_slice($values, 0, count($header)));
		if (is_array($row)) $rows[] = array_map(static fn(mixed $value): string => trim((string)$value), $row);
	}
	fclose($stream);
	return $rows;
}

function radnetzDashboardFeature(array $row, string $typeKey, string $typeLabel, array $statuses, int $index): array
{
	$status = trim((string)($row['Status'] ?? ''));
	$statusEntry = $statuses[mb_strtolower($status, 'UTF-8')] ?? null;
	$district = trim((string)($row['Bezirk'] ?? ''));
	$districtCodes = radnetzDashboardDistrictCodes($district);
	$districtNames = array_map('radnetzDashboardDistrictName', $districtCodes);
	$geometries = [];
	foreach (['Strecke Shape', 'Anlage Shape'] as $field) {
		$geometry = radnetzDashboardParseWkt((string)($row[$field] ?? ''));
		if ($geometry !== null) radnetzDashboardAppendGeometry($geometries, $geometry);
	}
	$geometry = count($geometries) === 1
		? $geometries[0]
		: ($geometries ? ['type' => 'GeometryCollection', 'geometries' => $geometries] : null);
	$title = trim((string)($row['Titel'] ?? ''));
	$year = trim((string)($row['Jahr'] ?? ''));
	$id = substr(hash('sha256', implode('|', [$typeKey, $year, $title, $district, $index])), 0, 20);
	$projectUrl = RADNETZ_DASHBOARD_BASE_URL . 'bauprojekte?' . http_build_query(array_filter([
		'type' => $typeKey === 'bauprogramm' ? 2 : 3,
		'jahr' => $year,
		'title' => $title,
	], static fn(mixed $value): bool => $value !== ''));

	$properties = [
		'Projekt-ID' => $id,
		'Projekttyp' => $typeLabel,
		'Jahr' => $year,
		'Titel' => $title,
		'Maßnahme' => $row['Maßnahme'] ?? '',
		'Bezirk' => implode(', ', $districtNames) ?: $district,
		'Postleitzahl' => $district,
		'Status' => $status,
		'Letzte Statusänderung' => $row['letzte Statusaenderung'] ?? '',
		'Statusverlauf' => $row['Statusaenderungen Protokoll'] ?? '',
		'Verschoben nach' => $row['verschoben nach'] ?? '',
		'Ankündigung' => $row['Ankuendigung'] ?? '',
		'Veröffentlicht am' => $row['Veroeffentlicht am'] ?? '',
		'Baubeginn' => $row['Baubeginn'] ?? '',
		'Bauende' => $row['Bauende'] ?? '',
		'Fertigstellung' => $row['Fertigstellung'] ?? '',
		'Rückbau' => $row['Rückbau'] ?? '',
		'Budget' => $row['Budget'] ?? '',
		'Netze' => $row['Netze'] ?? '',
		'Radrouten' => $row['Radrouten'] ?? '',
		'Tags' => $row['Tags'] ?? '',
		'Medienberichte' => $row['Medienberichte'] ?? '',
		'Länge' => $row['Länge'] ?? '',
		'Anlagenlänge' => $row['Anlagenlänge'] ?? '',
		'Projektliste' => $projectUrl,
		'Statusfarbe' => $statusEntry['color'] ?? '#6b7280',
		'_projectType' => $typeKey,
		'_districtCodes' => ',' . implode(',', $districtCodes) . ',',
		'_lengthMeters' => radnetzDashboardNumericValue((string)($row['Länge'] ?? '')),
		'_facilityLengthMeters' => radnetzDashboardNumericValue((string)($row['Anlagenlänge'] ?? '')),
		'_searchText' => mb_strtolower(implode(' ', array_values($row)), 'UTF-8'),
	];
	$properties = array_filter($properties, static fn(mixed $value, string $key): bool => str_starts_with($key, '_') || $value !== '', ARRAY_FILTER_USE_BOTH);
	return ['type' => 'Feature', 'id' => $id, 'properties' => $properties, 'geometry' => $geometry];
}

function radnetzDashboardNumericValue(string $value): float
{
	$value = preg_replace('/[^0-9,.-]+/', '', trim($value)) ?? '';
	if ($value === '') return 0.0;
	if (str_contains($value, ',') && str_contains($value, '.')) {
		$value = str_replace('.', '', $value);
	}
	$value = str_replace(',', '.', $value);
	return is_numeric($value) ? max(0.0, (float)$value) : 0.0;
}

function radnetzDashboardDistrictCodes(string $value): array
{
	preg_match_all('/\b(?:10[1-9]0|1[12][0-9]0)\b/', $value, $matches);
	return array_values(array_unique($matches[0] ?? []));
}

function radnetzDashboardDistrictName(string $code): string
{
	$names = [
		'1010' => '1. Innere Stadt', '1020' => '2. Leopoldstadt', '1030' => '3. Landstraße',
		'1040' => '4. Wieden', '1050' => '5. Margareten', '1060' => '6. Mariahilf',
		'1070' => '7. Neubau', '1080' => '8. Josefstadt', '1090' => '9. Alsergrund',
		'1100' => '10. Favoriten', '1110' => '11. Simmering', '1120' => '12. Meidling',
		'1130' => '13. Hietzing', '1140' => '14. Penzing', '1150' => '15. Rudolfsheim-Fünfhaus',
		'1160' => '16. Ottakring', '1170' => '17. Hernals', '1180' => '18. Währing',
		'1190' => '19. Döbling', '1200' => '20. Brigittenau', '1210' => '21. Floridsdorf',
		'1220' => '22. Donaustadt', '1230' => '23. Liesing',
	];
	return $names[$code] ?? $code;
}

function radnetzDashboardAppendGeometry(array &$target, array $geometry): void
{
	if (($geometry['type'] ?? '') === 'GeometryCollection') {
		foreach ($geometry['geometries'] ?? [] as $child) {
			if (is_array($child)) radnetzDashboardAppendGeometry($target, $child);
		}
		return;
	}
	$target[] = $geometry;
}

function radnetzDashboardParseWkt(string $wkt): ?array
{
	$wkt = trim(preg_replace('/^SRID=\d+;/i', '', trim($wkt)) ?? '');
	if ($wkt === '' || preg_match('/\bEMPTY$/i', $wkt)) return null;
	if (!preg_match('/^([A-Z]+)(?:\s+Z?M?)?\s*(\(.*\))$/is', $wkt, $match)) return null;
	$type = strtoupper($match[1]);
	$content = radnetzDashboardStripOuterParens($match[2]);
	return match ($type) {
		'POINT' => ($point = radnetzDashboardCoordinate($content)) ? ['type' => 'Point', 'coordinates' => $point] : null,
		'LINESTRING' => ($line = radnetzDashboardCoordinateList($content)) ? ['type' => 'LineString', 'coordinates' => $line] : null,
		'MULTILINESTRING' => radnetzDashboardMultiLineString($content),
		'POLYGON' => radnetzDashboardPolygon($content),
		'MULTIPOLYGON' => radnetzDashboardMultiPolygon($content),
		'GEOMETRYCOLLECTION' => radnetzDashboardGeometryCollection($content),
		default => null,
	};
}

function radnetzDashboardStripOuterParens(string $value): string
{
	$value = trim($value);
	if (str_starts_with($value, '(') && str_ends_with($value, ')')) return trim(substr($value, 1, -1));
	return $value;
}

function radnetzDashboardSplitTopLevel(string $value): array
{
	$parts = [];
	$start = 0;
	$depth = 0;
	$length = strlen($value);
	for ($i = 0; $i < $length; $i++) {
		if ($value[$i] === '(') $depth++;
		elseif ($value[$i] === ')') $depth--;
		elseif ($value[$i] === ',' && $depth === 0) {
			$parts[] = trim(substr($value, $start, $i - $start));
			$start = $i + 1;
		}
	}
	$parts[] = trim(substr($value, $start));
	return array_values(array_filter($parts, static fn(string $part): bool => $part !== ''));
}

function radnetzDashboardCoordinate(string $value): ?array
{
	$values = preg_split('/\s+/', trim($value));
	if (!is_array($values) || count($values) < 2 || !is_numeric($values[0]) || !is_numeric($values[1])) return null;
	$lon = (float)$values[0];
	$lat = (float)$values[1];
	if ($lon < -180 || $lon > 180 || $lat < -90 || $lat > 90) return null;
	return [$lon, $lat];
}

function radnetzDashboardCoordinateList(string $value): array
{
	return array_values(array_filter(array_map('radnetzDashboardCoordinate', radnetzDashboardSplitTopLevel($value))));
}

function radnetzDashboardMultiLineString(string $content): ?array
{
	$lines = array_values(array_filter(array_map(
		static fn(string $part): array => radnetzDashboardCoordinateList(radnetzDashboardStripOuterParens($part)),
		radnetzDashboardSplitTopLevel($content)
	)));
	return $lines ? ['type' => 'MultiLineString', 'coordinates' => $lines] : null;
}

function radnetzDashboardPolygon(string $content): ?array
{
	$rings = array_values(array_filter(array_map(
		static fn(string $part): array => radnetzDashboardCoordinateList(radnetzDashboardStripOuterParens($part)),
		radnetzDashboardSplitTopLevel($content)
	)));
	return $rings ? ['type' => 'Polygon', 'coordinates' => $rings] : null;
}

function radnetzDashboardMultiPolygon(string $content): ?array
{
	$polygons = [];
	foreach (radnetzDashboardSplitTopLevel($content) as $part) {
		$polygon = radnetzDashboardPolygon(radnetzDashboardStripOuterParens($part));
		if ($polygon) $polygons[] = $polygon['coordinates'];
	}
	return $polygons ? ['type' => 'MultiPolygon', 'coordinates' => $polygons] : null;
}

function radnetzDashboardGeometryCollection(string $content): ?array
{
	$geometries = [];
	foreach (radnetzDashboardSplitTopLevel($content) as $part) {
		$geometry = radnetzDashboardParseWkt($part);
		if ($geometry) radnetzDashboardAppendGeometry($geometries, $geometry);
	}
	return $geometries ? ['type' => 'GeometryCollection', 'geometries' => $geometries] : null;
}
