<?php
declare(strict_types=1);

const RADNETZ_DASHBOARD_CACHE_DIR = __DIR__ . '/../../Cache/RadnetzDashboard';
const RADNETZ_DASHBOARD_CACHE_FILE = RADNETZ_DASHBOARD_CACHE_DIR . '/projects.geojson';
const RADNETZ_DASHBOARD_RETRY_FILE = RADNETZ_DASHBOARD_CACHE_DIR . '/refresh.failed';
const RADNETZ_DASHBOARD_CACHE_TTL = 1800;
const RADNETZ_DASHBOARD_RETRY_TTL = 1800;
const RADNETZ_DASHBOARD_HTTP_TIMEOUT = 12;
const RADNETZ_DASHBOARD_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const RADNETZ_DASHBOARD_USER_AGENT = 'Kartensammlung Radnetz-Dashboard Proxy/1.0 (+https://www.kartensammlung.at/)';
const RADNETZ_DASHBOARD_BASE_URL = 'https://radnetz-dashboard.radlobby.at/';

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
	$responses = radnetzDashboardFetchAll([
		'bauprogramm' => RADNETZ_DASHBOARD_BASE_URL . 'bauprojekte.csv?type=2',
		'weitere' => RADNETZ_DASHBOARD_BASE_URL . 'bauprojekte.csv?type=3',
		'statuses' => RADNETZ_DASHBOARD_BASE_URL . 'statuses.json',
	]);
	$statuses = radnetzDashboardStatuses($responses['statuses']);
	$features = [];
	$unmapped = 0;
	foreach ([
		'bauprogramm' => 'Bauprogramm Stadt Wien',
		'weitere' => 'Weitere Bauprojekte',
	] as $key => $label) {
		foreach (radnetzDashboardParseCsv($responses[$key]) as $index => $row) {
			$feature = radnetzDashboardFeature($row, $key, $label, $statuses, $index);
			if ($feature['geometry'] === null) $unmapped++;
			$features[] = $feature;
		}
	}

	$years = array_values(array_unique(array_filter(array_map(
		static fn(array $feature): string => trim((string)($feature['properties']['Jahr'] ?? '')),
		$features
	))));
	sort($years, SORT_NATURAL);
	$statusCounts = [];
	$typeCounts = [];
	foreach ($features as $feature) {
		$status = (string)($feature['properties']['Status'] ?? 'Ohne Status');
		$type = (string)($feature['properties']['Projekttyp'] ?? '');
		$statusCounts[$status] = ($statusCounts[$status] ?? 0) + 1;
		$typeCounts[$type] = ($typeCounts[$type] ?? 0) + 1;
	}

	return [
		'type' => 'FeatureCollection',
		'features' => $features,
		'metadata' => [
			'generatedAt' => gmdate('c'),
			'source' => RADNETZ_DASHBOARD_BASE_URL,
			'projects' => count($features),
			'mappableProjects' => count($features) - $unmapped,
			'unmappedProjects' => $unmapped,
			'years' => $years,
			'statuses' => array_values($statuses),
			'statusCounts' => $statusCounts,
			'typeCounts' => $typeCounts,
		],
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

function radnetzDashboardHttp(string $url, string $accept): string
{
	$body = '';
	$ch = curl_init($url);
	if ($ch === false) throw new RuntimeException('HTTP-Anfrage konnte nicht initialisiert werden.');
	curl_setopt_array($ch, [
		CURLOPT_RETURNTRANSFER => false,
		CURLOPT_FOLLOWLOCATION => false,
		CURLOPT_CONNECTTIMEOUT => 8,
		CURLOPT_TIMEOUT => RADNETZ_DASHBOARD_HTTP_TIMEOUT,
		CURLOPT_ENCODING => '',
		CURLOPT_USERAGENT => RADNETZ_DASHBOARD_USER_AGENT,
		CURLOPT_HTTPHEADER => ['Accept: ' . $accept],
		CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
			if (strlen($body) + strlen($chunk) > RADNETZ_DASHBOARD_MAX_RESPONSE_BYTES) return 0;
			$body .= $chunk;
			return strlen($chunk);
		},
	]);
	curl_exec($ch);
	$status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
	$error = curl_error($ch);
	curl_close($ch);
	if ($error !== '' || $status < 200 || $status >= 300 || $body === '') {
		throw new RuntimeException($error !== '' ? $error : 'HTTP ' . $status);
	}
	return $body;
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
