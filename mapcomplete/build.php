<?php
declare(strict_types=1);

const MAPCOMPLETE_STATUS_URL = 'https://cache.mapcomplete.org/summary/status.json';
const MAPCOMPLETE_LAYER_RAW_URL = 'https://source.mapcomplete.org/MapComplete/MapComplete/raw/branch/master/assets/layers/';
const MAPCOMPLETE_ASSET_RAW_URL = 'https://source.mapcomplete.org/MapComplete/MapComplete/raw/branch/master/';
const MAPCOMPLETE_CACHE_FILE = __DIR__ . '/build/MapcompleteLayers.json';
const MAPCOMPLETE_LOCK_FILE = __DIR__ . '/build/MapcompleteLayers.lock';
const MAPCOMPLETE_ICON_DIRECTORY = __DIR__ . '/build/Icons';
const MAPCOMPLETE_MAPPING_FILE = __DIR__ . '/icon-sections.json';
const MAPCOMPLETE_OSM_OVERLAYS_FILE = __DIR__ . '/OsmColors.js';

function mapcompleteFetch(string $url): string {
	$curl = curl_init($url);
	if ($curl === false) {
		throw new RuntimeException('cURL konnte nicht initialisiert werden.');
	}

	curl_setopt_array($curl, [
		CURLOPT_RETURNTRANSFER => true,
		CURLOPT_FOLLOWLOCATION => true,
		CURLOPT_USERAGENT => 'Kartensammlung MapComplete layer cache/1.0',
		CURLOPT_CONNECTTIMEOUT => 10,
		CURLOPT_TIMEOUT => 30,
	]);
	$body = curl_exec($curl);
	$error = curl_error($curl);
	$status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
	curl_close($curl);

	if ($body === false) {
		throw new RuntimeException('cURL-Fehler: ' . $error);
	}
	if ($status < 200 || $status >= 300) {
		throw new RuntimeException('HTTP ' . $status . ' für ' . $url);
	}

	return $body;
}

function mapcompleteStatus(): array {
	$status = json_decode(mapcompleteFetch(MAPCOMPLETE_STATUS_URL), true, 512, JSON_THROW_ON_ERROR);
	if (!is_array($status) || !isset($status['layers']) || !is_array($status['layers'])) {
		throw new RuntimeException('MapComplete-Status enthält keine Layerliste.');
	}

	$layers = [];
	foreach ($status['layers'] as $layerId) {
		if (!is_string($layerId) || !preg_match('/^[a-zA-Z0-9_.-]+$/', $layerId)) {
			continue;
		}
		$layers[$layerId] = true;
	}

	$layers = array_keys($layers);
	sort($layers, SORT_NATURAL | SORT_FLAG_CASE);
	if ($layers === []) {
		throw new RuntimeException('MapComplete-Status enthält keine gültigen Layer-IDs.');
	}

	$databases = array_values(array_filter(
		$status['suitableDatabases'] ?? [],
		static fn ($value): bool => is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1
	));

	return [
		'layers' => $layers,
		'suitableDatabases' => $databases,
	];
}

function mapcompleteLocalizedTitle(mixed $title, string $fallback): string {
	if (is_string($title) && trim($title) !== '') {
		return trim($title);
	}
	if (!is_array($title)) {
		return $fallback;
	}

	foreach (['de', 'en'] as $language) {
		if (isset($title[$language]) && is_string($title[$language]) && trim($title[$language]) !== '') {
			return trim($title[$language]);
		}
	}

	return $fallback;
}

function mapcompleteMarkerIcon(string $contents, string $extension, string $markerColor): string {
	if (preg_match('/^#[0-9A-Fa-f]{6}$/', $markerColor) !== 1) {
		throw new InvalidArgumentException('Ungültige OSM-Section-Farbe.');
	}
	$mimeType = match ($extension) {
		'svg' => 'image/svg+xml',
		'png' => 'image/png',
		'webp' => 'image/webp',
		'jpg', 'jpeg' => 'image/jpeg',
		default => throw new InvalidArgumentException('Nicht unterstuetztes MapComplete-Iconformat.'),
	};
	$embeddedIcon = 'data:' . $mimeType . ';base64,' . base64_encode($contents);

	// Gleiche Form, Groesse und Schattierung wie die Marker aus OsmOverlays.js.
	// Die Farbmatrix setzt alle sichtbaren Pixel des eingebetteten Theme-Icons
	// auf Weiss, behaelt dabei aber dessen Transparenz bei.
	return '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="50" viewBox="0 0 36 50">'
		. '<defs>'
		. '<filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.4"/></filter>'
		. '<filter id="white" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter>'
		. '</defs>'
		. '<g filter="url(#shadow)"><path d="m18 3.9658a13.9 13.9 0 0 0-13.9 13.9 13.9 13.9 0 0 0 2.541 7.9629h-0.044922l11.404 20.205 11.404-20.205h-0.04492a13.9 13.9 0 0 0 2.541-7.9629 13.9 13.9 0 0 0-13.9-13.9z" fill="' . htmlspecialchars($markerColor, ENT_QUOTES | ENT_XML1, 'UTF-8') . '"/></g>'
		. '<image href="' . htmlspecialchars($embeddedIcon, ENT_QUOTES | ENT_XML1, 'UTF-8') . '" x="9" y="9" width="18" height="18" preserveAspectRatio="xMidYMid meet" filter="url(#white)"/>'
		. '</svg>';
}

function mapcompleteIconPath(mixed $icon): ?string {
	if (is_array($icon) && array_key_exists('render', $icon)) {
		return mapcompleteIconPath($icon['render']);
	}
	if (!is_string($icon)) {
		return null;
	}
	if (!preg_match('~\./assets/[^;|"\']+?\.(?:svg|png|webp|jpe?g)~i', $icon, $matches)) {
		return null;
	}
	return $matches[0];
}

function mapcompleteDefaultIcon(array $layer): ?string {
	$renderings = $layer['pointRendering'] ?? [];
	if (!is_array($renderings)) {
		return null;
	}
	if (array_key_exists('marker', $renderings)) {
		$renderings = [$renderings];
	}

	foreach ($renderings as $rendering) {
		if (!is_array($rendering)) {
			continue;
		}
		$markers = $rendering['marker'] ?? [];
		if (!is_array($markers)) {
			$markers = [$markers];
		} elseif (array_key_exists('icon', $markers)) {
			$markers = [$markers];
		}

		foreach ($markers as $marker) {
			$path = is_array($marker)
				? mapcompleteIconPath($marker['icon'] ?? null)
				: mapcompleteIconPath($marker);
			if ($path !== null) {
				return $path;
			}
		}
	}

	return null;
}

function mapcompleteCacheIcon(string $layerId, mixed $icon, string $markerColor): ?array {
	$icon = mapcompleteIconPath($icon);
	if ($icon === null || !str_starts_with($icon, './assets/')) {
		return null;
	}

	$relativePath = substr($icon, 2);
	$extension = strtolower((string)pathinfo($relativePath, PATHINFO_EXTENSION));
	if (!in_array($extension, ['svg', 'png', 'webp', 'jpg', 'jpeg'], true)) {
		return null;
	}

	$segments = explode('/', $relativePath);
	if (in_array('..', $segments, true)) {
		return null;
	}

	if (!is_dir(MAPCOMPLETE_ICON_DIRECTORY)
		&& !mkdir(MAPCOMPLETE_ICON_DIRECTORY, 0775, true)
		&& !is_dir(MAPCOMPLETE_ICON_DIRECTORY)) {
		throw new RuntimeException('MapComplete-Iconverzeichnis konnte nicht angelegt werden.');
	}

	$safeLayerId = preg_replace('/[^a-zA-Z0-9_-]+/', '-', $layerId) ?: 'layer';
	$fileName = $safeLayerId . '-' . substr(hash('sha256', 'osm-marker-v3:' . $markerColor . ':' . $relativePath), 0, 10) . '.svg';
	$target = MAPCOMPLETE_ICON_DIRECTORY . '/' . $fileName;
	if (is_file($target)) {
		return ['url' => '/Maps/MapComplete/Icons/' . $fileName];
	}

	$contents = mapcompleteFetch(MAPCOMPLETE_ASSET_RAW_URL . implode('/', array_map('rawurlencode', $segments)));
	$markerIcon = mapcompleteMarkerIcon($contents, $extension, $markerColor);
	$tmpFile = tempnam(MAPCOMPLETE_ICON_DIRECTORY, 'icon-');
	if ($tmpFile === false || file_put_contents($tmpFile, $markerIcon, LOCK_EX) === false || !rename($tmpFile, $target)) {
		if ($tmpFile !== false && is_file($tmpFile)) {
			@unlink($tmpFile);
		}
		throw new RuntimeException('MapComplete-Icon konnte nicht gespeichert werden.');
	}
	@chmod($target, 0664);

	return [
		'url' => '/Maps/MapComplete/Icons/' . $fileName,
	];
}

function mapcompleteRecolorCachedMarkerIcon(string $layerId, ?array $icon, string $markerColor): ?array {
	if (preg_match('/^#[0-9A-Fa-f]{6}$/', $markerColor) !== 1) {
		throw new InvalidArgumentException('Ungültige OSM-Section-Farbe.');
	}

	$url = $icon['url'] ?? null;
	if (!is_string($url) || preg_match('~^Cache/MapcompleteIcons/(?P<file>[a-zA-Z0-9_.-]+\.svg)$~', $url, $match) !== 1) {
		return null;
	}

	$source = MAPCOMPLETE_ICON_DIRECTORY . '/' . $match['file'];
	if (!is_file($source)) {
		return null;
	}

	$svg = (string)file_get_contents($source);
	$pattern = '~(<g filter="url\(#shadow\)"><path\b[^>]*\bfill=")(?P<color>#[0-9A-Fa-f]{6})(")~';
	if (preg_match($pattern, $svg, $colorMatch) !== 1) {
		return null;
	}
	if (strcasecmp($colorMatch['color'], $markerColor) === 0) {
		return $icon;
	}

	$recolored = preg_replace_callback(
		$pattern,
		static fn (array $matches): string => $matches[1] . $markerColor . $matches[3],
		$svg,
		1,
		$count
	);
	if (!is_string($recolored) || $count !== 1) {
		return null;
	}

	$safeLayerId = preg_replace('/[^a-zA-Z0-9_-]+/', '-', $layerId) ?: 'layer';
	$fileName = $safeLayerId . '-' . substr(
		hash('sha256', 'osm-marker-v3-fallback:' . $markerColor . ':' . $match['file']),
		0,
		10
	) . '.svg';
	$target = MAPCOMPLETE_ICON_DIRECTORY . '/' . $fileName;
	if (!is_file($target)) {
		$tmpFile = tempnam(MAPCOMPLETE_ICON_DIRECTORY, 'icon-');
		if ($tmpFile === false || file_put_contents($tmpFile, $recolored, LOCK_EX) === false || !rename($tmpFile, $target)) {
			if ($tmpFile !== false && is_file($tmpFile)) {
				@unlink($tmpFile);
			}
			throw new RuntimeException('MapComplete-Ersatzicon konnte nicht gespeichert werden.');
		}
		@chmod($target, 0664);
	}

	return [
		'url' => '/Maps/MapComplete/Icons/' . $fileName,
	];
}

function mapcompleteFetchLayerDefinitions(array $layerIds, int $concurrency = 12): array {
	$pending = array_values(array_unique(array_filter(
		$layerIds,
		static fn ($id): bool => is_string($id) && $id !== ''
	)));
	$multi = curl_multi_init();
	$active = [];
	$definitions = [];

	$addNext = static function () use (&$pending, &$active, $multi): bool {
		$id = array_shift($pending);
		if ($id === null) {
			return false;
		}

		$encodedId = rawurlencode($id);
		$curl = curl_init(MAPCOMPLETE_LAYER_RAW_URL . $encodedId . '/' . $encodedId . '.json');
		if ($curl === false) {
			return true;
		}
		curl_setopt_array($curl, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_FOLLOWLOCATION => true,
			CURLOPT_USERAGENT => 'Kartensammlung MapComplete layer catalog/2.0',
			CURLOPT_CONNECTTIMEOUT => 5,
			CURLOPT_TIMEOUT => 20,
		]);
		curl_multi_add_handle($multi, $curl);
		$active[spl_object_id($curl)] = ['handle' => $curl, 'id' => $id];
		return true;
	};

	try {
		while (count($active) < $concurrency && $addNext()) {
		}

		do {
			do {
				$status = curl_multi_exec($multi, $running);
			} while ($status === CURLM_CALL_MULTI_PERFORM);

			while ($info = curl_multi_info_read($multi)) {
				$curl = $info['handle'];
				$key = spl_object_id($curl);
				$id = $active[$key]['id'] ?? null;
				$httpStatus = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
				if ($id !== null && $info['result'] === CURLE_OK && $httpStatus >= 200 && $httpStatus < 300) {
					try {
						$definition = json_decode(curl_multi_getcontent($curl), true, 512, JSON_THROW_ON_ERROR);
						if (is_array($definition)) {
							$definitions[$id] = $definition;
						}
					} catch (Throwable $exception) {
						// Die Statusliste bleibt die Source of Truth. Fehlende oder ungültige
						// Metadaten dürfen einen funktionierenden MVT-Layer nicht entfernen.
					}
				}

				curl_multi_remove_handle($multi, $curl);
				curl_close($curl);
				unset($active[$key]);
				$addNext();
			}

			if ($running > 0) {
				$selected = curl_multi_select($multi, 1.0);
				if ($selected === -1) {
					usleep(10000);
				}
			}
		} while ($running > 0 || $active !== []);
	} finally {
		foreach ($active as $request) {
			curl_multi_remove_handle($multi, $request['handle']);
			curl_close($request['handle']);
		}
		curl_multi_close($multi);
	}

	return $definitions;
}

function mapcompletePreviousLayerMetadata(array $catalog): array {
	if (($catalog['version'] ?? null) === 2 && isset($catalog['layers']) && is_array($catalog['layers'])) {
		return $catalog['layers'];
	}

	// Einmalige Migration des bisherigen theme-basierten Cacheformats. Sie
	// bewahrt vor allem Icons für abgeleitete Layer-IDs ohne eigene Quelldatei.
	$layers = [];
	foreach ($catalog as $themeId => $theme) {
		if (!is_array($theme)) {
			continue;
		}
		$layerIds = array_is_list($theme) ? $theme : ($theme['layers'] ?? []);
		if (!is_array($layerIds)) {
			continue;
		}
		foreach ($layerIds as $layerId) {
			if (!is_string($layerId) || isset($layers[$layerId])) {
				continue;
			}
			$layers[$layerId] = [
				'name' => mapcompleteLocalizedTitle($theme['title'] ?? null, $layerId),
				'icon' => isset($theme['icon']) && is_array($theme['icon']) ? $theme['icon'] : null,
			];
		}
	}
	return $layers;
}

function mapcompleteLayerData(
	string $layerId,
	?array $definition,
	?array $previous,
	bool $cacheIcon,
	string $markerColor = '#2A9D4B'
): array {
	$name = mapcompleteLocalizedTitle($definition['name'] ?? null, '');
	if ($name === '') {
		$name = mapcompleteLocalizedTitle($previous['name'] ?? null, $layerId);
	}

	$icon = isset($previous['icon']) && is_array($previous['icon']) ? $previous['icon'] : null;
	if ($cacheIcon && $definition !== null) {
		try {
			$layerIcon = mapcompleteDefaultIcon($definition);
			if ($layerIcon !== null) {
				$icon = mapcompleteCacheIcon($layerId, $layerIcon, $markerColor);
			}
		} catch (Throwable $exception) {
			// Ein fehlendes Icon darf den Layerkatalog nicht unbrauchbar machen.
		}
	}
	if ($cacheIcon && $icon !== null) {
		try {
			$icon = mapcompleteRecolorCachedMarkerIcon($layerId, $icon, $markerColor) ?? $icon;
		} catch (Throwable $exception) {
			// Wiederverwendete Icons bleiben verfügbar; die Validierung meldet Farbabweichungen.
		}
	}

	$data = [
		'name' => $name,
		'icon' => $icon,
	];
	$minZoom = $definition['minzoom'] ?? ($previous['minZoom'] ?? null);
	if (is_int($minZoom) || is_float($minZoom)) {
		$data['minZoom'] = $minZoom;
	}
	$osmTags = $definition['source']['osmTags'] ?? ($previous['osmTags'] ?? null);
	if (is_string($osmTags) || is_array($osmTags)) {
		$data['osmTags'] = $osmTags;
	}

	return $data;
}

function mapcompleteSectionColors(): array {
	if (!is_readable(MAPCOMPLETE_OSM_OVERLAYS_FILE)) {
		throw new RuntimeException('OsmOverlays.js für Section-Farben nicht lesbar.');
	}

	$source = (string)file_get_contents(MAPCOMPLETE_OSM_OVERLAYS_FILE);
	if (preg_match('/const\s+osmColors\s*=\s*\{(?P<body>.*?)\};/s', $source, $palette) !== 1) {
		throw new RuntimeException('OSM-Section-Farbpalette nicht gefunden.');
	}

	preg_match_all(
		'/"(?P<section>[^"]+)"\s*:\s*"(?P<color>#[0-9A-Fa-f]{6})"/',
		$palette['body'],
		$matches,
		PREG_SET_ORDER
	);
	$colors = [];
	foreach ($matches as $match) {
		$colors[$match['section']] = strtoupper($match['color']);
	}
	if ($colors === []) {
		throw new RuntimeException('OSM-Section-Farbpalette ist leer.');
	}

	return $colors;
}

function mapcompleteRefresh(): bool {
	$cacheDirectory = dirname(MAPCOMPLETE_CACHE_FILE);
	if (!is_dir($cacheDirectory) && !mkdir($cacheDirectory, 0775, true) && !is_dir($cacheDirectory)) {
		throw new RuntimeException('Cache-Verzeichnis konnte nicht angelegt werden.');
	}

	$lock = fopen(MAPCOMPLETE_LOCK_FILE, 'c');
	if ($lock === false) {
		throw new RuntimeException('Cache-Sperre konnte nicht geöffnet werden.');
	}
	if (!flock($lock, LOCK_EX | LOCK_NB)) {
		fclose($lock);
		return false;
	}

	try {
		$status = mapcompleteStatus();
		$layerIds = $status['layers'];
		$definitions = mapcompleteFetchLayerDefinitions($layerIds);
		$previousLayers = mapcompletePreviousLayerMetadata(mapcompleteCachedLayers());
		$mapping = mapcompleteMapping();
		$sectionColors = mapcompleteSectionColors();
		$additional = $mapping['additional'] ?? [];
		$iconLayerIds = array_fill_keys(array_keys($additional), true);
		$layers = [];
		foreach ($layerIds as $layerId) {
			$layers[$layerId] = mapcompleteLayerData(
				$layerId,
				$definitions[$layerId] ?? null,
				isset($previousLayers[$layerId]) && is_array($previousLayers[$layerId]) ? $previousLayers[$layerId] : null,
				isset($iconLayerIds[$layerId]),
				$sectionColors[$additional[$layerId]['sec'] ?? ''] ?? '#2A9D4B'
			);
		}

		$output = [
			'version' => 2,
			'source' => MAPCOMPLETE_STATUS_URL,
			'updatedAt' => gmdate(DATE_ATOM),
			'suitableDatabases' => $status['suitableDatabases'],
			'layers' => $layers,
		];

		$json = json_encode($output, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
		$tmpFile = tempnam($cacheDirectory, 'MapcompleteLayers-');
		if ($tmpFile === false || file_put_contents($tmpFile, $json, LOCK_EX) === false || !rename($tmpFile, MAPCOMPLETE_CACHE_FILE)) {
			if ($tmpFile !== false && is_file($tmpFile)) {
				@unlink($tmpFile);
			}
			throw new RuntimeException('MapComplete-Cache konnte nicht gespeichert werden.');
		}
		@chmod(MAPCOMPLETE_CACHE_FILE, 0664);
	} finally {
		flock($lock, LOCK_UN);
		fclose($lock);
	}

	return true;
}

function mapcompleteCachedLayers(): array {
	if (!is_file(MAPCOMPLETE_CACHE_FILE)) {
		return [];
	}

	try {
		$data = json_decode((string)file_get_contents(MAPCOMPLETE_CACHE_FILE), true, 512, JSON_THROW_ON_ERROR);
		return is_array($data) ? $data : [];
	} catch (Throwable $exception) {
		return [];
	}
}

function mapcompleteMapping(): array {
	if (!is_file(MAPCOMPLETE_MAPPING_FILE)) {
		return [];
	}

	try {
		$data = json_decode((string)file_get_contents(MAPCOMPLETE_MAPPING_FILE), true, 512, JSON_THROW_ON_ERROR);
		return is_array($data) ? $data : [];
	} catch (Throwable $exception) {
		return [];
	}
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
	try {
		mapcompleteRefresh();
		exit(0);
	} catch (Throwable $exception) {
		fwrite(STDERR, 'MapComplete-Refresh fehlgeschlagen: ' . $exception->getMessage() . PHP_EOL);
		exit(1);
	}
}
