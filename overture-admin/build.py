#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import duckdb

SCRIPT_DIR = Path(__file__).resolve().parent
STAC_URL = "https://stac.overturemaps.org/catalog.json"
S3_BASE = "s3://overturemaps-us-west-2/release"
RELEASE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.\d+$")
VIENNA_WFS_BASE = "https://data.wien.gv.at/daten/geo"
VIENNA_DATASET = "ogdwien:BEZIRKSGRENZEOGD"
OVERTURE_ATTRIBUTION = "© OpenStreetMap contributors, Overture Maps Foundation"
VIENNA_ATTRIBUTION = "Stadt Wien – data.wien.gv.at, CC BY 4.0"
ATTRIBUTION = f"{OVERTURE_ATTRIBUTION}; {VIENNA_ATTRIBUTION}"
ALL_SUBTYPES = (
	"country",
	"dependency",
	"macroregion",
	"region",
	"macrocounty",
	"county",
	"localadmin",
	"locality",
	"borough",
	"macrohood",
	"neighborhood",
	"microhood",
)
DEFAULT_BUILD_SUBTYPES = (
	"country",
	"dependency",
	"region",
	"county",
)
MINZOOM_BY_SUBTYPE = {
	"country": 0,
	"dependency": 0,
	"macroregion": 4,
	"region": 4,
	"macrocounty": 7,
	"county": 8,
	"localadmin": 10,
	"locality": 10,
	"borough": 11,
	"macrohood": 12,
	"neighborhood": 12,
	"microhood": 13,
}
VIENNA_DISTRICT_MINZOOM = 9


def log(message: str) -> None:
	stamp = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
	print(f"[{stamp}] {message}", flush=True)


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Build split self-hosted administrative-boundary PMTiles."
	)
	parser.add_argument(
		"--release",
		default="latest",
		help="Overture release such as 2026-08-19.0. Default: latest STAC release.",
	)
	parser.add_argument(
		"--subtypes",
		default=",".join(DEFAULT_BUILD_SUBTYPES),
		help="Comma-separated Overture division subtypes to include.",
	)
	parser.add_argument(
		"--boundary-maxzoom",
		type=int,
		default=14,
		help="Maximum zoom for visible boundary and coastline geometry. Default: 14.",
	)
	parser.add_argument(
		"--area-maxzoom",
		type=int,
		default=11,
		help="Maximum zoom for transparent interaction polygons. Default: 11.",
	)
	parser.add_argument(
		"--tippecanoe",
		default="tippecanoe",
		help="Tippecanoe executable.",
	)
	parser.add_argument(
		"--output-dir",
		type=Path,
		default=SCRIPT_DIR / "build" / "OvertureAdmin",
		help="Published output directory.",
	)
	parser.add_argument(
		"--work-dir",
		type=Path,
		default=SCRIPT_DIR / "build" / "tmp",
		help="Temporary GeoJSONSeq directory.",
	)
	parser.add_argument(
		"--skip-tiles",
		action="store_true",
		help="Run source audit and extraction without Tippecanoe.",
	)
	return parser.parse_args()


def validate_release(value: str) -> str:
	release = str(value or "").strip().rstrip("/")
	if not RELEASE_RE.fullmatch(release):
		raise ValueError(f"Invalid Overture release: {release!r}")
	return release


def fetch_json(url: str, *, timeout: int = 60, attempts: int = 3) -> object:
	last_error: Exception | None = None

	for attempt in range(1, attempts + 1):
		try:
			request = Request(
				url,
				headers={"User-Agent": "kartensammlung-overlay-builds/overture-admin"},
			)
			with urlopen(request, timeout=timeout) as response:
				return json.load(response)
		except Exception as exc:
			last_error = exc
			if attempt < attempts:
				time.sleep(attempt * 2)

	raise RuntimeError(f"Failed to download JSON after {attempts} attempts: {url}") from last_error


def resolve_release(value: str) -> str:
	if value != "latest":
		return validate_release(value)
	payload = fetch_json(STAC_URL, timeout=30)
	if not isinstance(payload, dict):
		raise RuntimeError("Overture STAC catalog returned an invalid response.")
	return validate_release(payload.get("latest", ""))


def parse_subtypes(value: str) -> tuple[str, ...]:
	requested = tuple(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))
	if not requested:
		raise ValueError("At least one Overture division subtype must be selected.")
	unknown = sorted(set(requested) - set(ALL_SUBTYPES))
	if unknown:
		raise ValueError("Unsupported Overture division subtype(s): " + ", ".join(unknown))
	return requested


def sql_string_list(values: tuple[str, ...]) -> str:
	return ", ".join("'" + value.replace("'", "''") + "'" for value in values)


def open_duckdb() -> duckdb.DuckDBPyConnection:
	connection = duckdb.connect()
	connection.execute("INSTALL spatial;")
	connection.execute("LOAD spatial;")
	connection.execute("INSTALL httpfs;")
	connection.execute("LOAD httpfs;")
	connection.execute("SET s3_region='us-west-2';")
	connection.execute("SET s3_url_style='path';")
	connection.execute("SET preserve_insertion_order=false;")
	return connection


def best_name(names: object) -> str:
	if not isinstance(names, dict):
		return ""
	common = names.get("common")
	if isinstance(common, dict):
		for key in ("de", "de-DE", "de-AT", "de-CH"):
			value = common.get(key)
			if isinstance(value, str) and value.strip():
				return value.strip()
		for key, value in common.items():
			if str(key).lower().startswith("de-") and isinstance(value, str) and value.strip():
				return value.strip()
	primary = names.get("primary")
	return primary.strip() if isinstance(primary, str) else ""


def hierarchy_properties(
	hierarchies: object,
	current_division_id: str,
	current_name: str,
) -> tuple[str, str]:
	if not isinstance(hierarchies, list) or not hierarchies:
		raise RuntimeError(f"Division {current_division_id} has no hierarchy.")
	default_hierarchy = hierarchies[0]
	if not isinstance(default_hierarchy, list) or not default_hierarchy:
		raise RuntimeError(f"Division {current_division_id} has an invalid default hierarchy.")

	names: list[str] = []
	subtypes: list[str] = []
	for item in default_hierarchy:
		if not isinstance(item, dict):
			continue
		name = str(item.get("name") or "").strip()
		subtype = str(item.get("subtype") or "").strip()
		division_id = str(item.get("division_id") or "").strip()
		if division_id == current_division_id and current_name:
			name = current_name
		if name:
			names.append(name)
			subtypes.append(subtype)
	if not names:
		raise RuntimeError(f"Division {current_division_id} has no named default hierarchy entries.")
	return "\u001f".join(names), "\u001f".join(subtypes)


def write_feature(handle, geometry: object, properties: dict, minzoom: int) -> None:
	if isinstance(geometry, str):
		if not geometry:
			raise RuntimeError("Encountered an empty geometry.")
		geometry = json.loads(geometry)
	if not isinstance(geometry, dict) or not geometry.get("type"):
		raise RuntimeError("Encountered an invalid geometry.")

	feature = {
		"type": "Feature",
		"properties": {key: value for key, value in properties.items() if value is not None},
		"geometry": geometry,
		"tippecanoe": {"minzoom": minzoom},
	}
	handle.write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")))
	handle.write("\n")


def rows_by_subtype(rows: list[tuple], columns: tuple[str, ...]) -> dict[str, dict[str, int]]:
	result: dict[str, dict[str, int]] = {}
	for row in rows:
		subtype = str(row[0])
		result[subtype] = {
			column: int(value or 0)
			for column, value in zip(columns, row[1:])
		}
	return result


def source_audit(
	connection: duckdb.DuckDBPyConnection,
	division_path: str,
	area_path: str,
	boundary_path: str,
) -> dict:
	division_rows = connection.execute(
		f"""
		SELECT
			subtype,
			COUNT(*) AS total,
			SUM(CASE WHEN perspectives IS NOT NULL THEN 1 ELSE 0 END) AS perspective_features
		FROM read_parquet('{division_path}', hive_partitioning=1)
		GROUP BY subtype
		ORDER BY subtype;
		"""
	).fetchall()
	area_rows = connection.execute(
		f"""
		SELECT
			subtype,
			COUNT(*) AS total,
			SUM(CASE WHEN is_land THEN 1 ELSE 0 END) AS land,
			SUM(CASE WHEN is_territorial THEN 1 ELSE 0 END) AS territorial
		FROM read_parquet('{area_path}', hive_partitioning=1)
		GROUP BY subtype
		ORDER BY subtype;
		"""
	).fetchall()
	boundary_rows = connection.execute(
		f"""
		SELECT
			subtype,
			COUNT(*) AS total,
			SUM(CASE WHEN is_land THEN 1 ELSE 0 END) AS land,
			SUM(CASE WHEN COALESCE(is_disputed, FALSE) THEN 1 ELSE 0 END) AS disputed,
			SUM(CASE WHEN perspectives IS NOT NULL THEN 1 ELSE 0 END) AS perspective_features
		FROM read_parquet('{boundary_path}', hive_partitioning=1)
		GROUP BY subtype
		ORDER BY subtype;
		"""
	).fetchall()
	return {
		"division": rows_by_subtype(division_rows, ("total", "perspective_features")),
		"division_area": rows_by_subtype(area_rows, ("total", "land", "territorial")),
		"division_boundary": rows_by_subtype(
			boundary_rows,
			("total", "land", "disputed", "perspective_features"),
		),
	}


def export_areas(
	connection: duckdb.DuckDBPyConnection,
	area_path: str,
	selected_subtypes: tuple[str, ...],
	output_path: Path,
	country_outline_path: Path,
) -> tuple[Counter, Counter]:
	subtype_sql = sql_string_list(selected_subtypes)
	query = f"""
		SELECT
			a.id,
			a.division_id,
			a.subtype,
			d.names,
			a.country,
			a.region,
			a.admin_level,
			d.hierarchies,
			d.perspectives,
			ST_AsGeoJSON(a.geometry) AS geometry_json
		FROM read_parquet('{area_path}', hive_partitioning=1) a
		INNER JOIN selected_divisions d ON d.id = a.division_id
		WHERE a.is_land = TRUE
			AND a.subtype IN ({subtype_sql});
	"""
	cursor = connection.execute(query)
	counts: Counter = Counter()
	outline_counts: Counter = Counter()

	with (
		output_path.open("w", encoding="utf-8") as area_handle,
		country_outline_path.open("w", encoding="utf-8") as outline_handle,
	):
		while True:
			rows = cursor.fetchmany(5000)
			if not rows:
				break
			for (
				area_id,
				division_id,
				subtype,
				names,
				country,
				region,
				admin_level,
				hierarchies,
				perspectives,
				geometry_json,
			) in rows:
				subtype = str(subtype)
				name = best_name(names)
				hierarchy_names, hierarchy_subtypes = hierarchy_properties(
					hierarchies,
					str(division_id),
					name,
				)
				properties = {
					"id": str(area_id),
					"division_id": str(division_id),
					"subtype": subtype,
					"admin_level": int(admin_level) if admin_level is not None else None,
					"country": str(country) if country else None,
					"region": str(region) if region else None,
					"name": name,
					"hierarchy_names": hierarchy_names,
					"hierarchy_subtypes": hierarchy_subtypes,
					"has_perspective": bool(perspectives is not None),
					"source": "Overture Maps",
				}
				write_feature(
					area_handle,
					geometry_json,
					properties,
					MINZOOM_BY_SUBTYPE[subtype],
				)
				counts[subtype] += 1

				if subtype in {"country", "dependency"}:
					write_feature(
						outline_handle,
						geometry_json,
						{
							"id": f"outline:{area_id}",
							"division_id": str(division_id),
							"subtype": subtype,
							"admin_level": int(admin_level) if admin_level is not None else None,
							"country": str(country) if country else None,
							"region": str(region) if region else None,
							"boundary_kind": "land_outline",
							"source": "Overture Maps division_area",
						},
						0,
					)
					outline_counts[subtype] += 1

	return counts, outline_counts


def export_boundaries(
	connection: duckdb.DuckDBPyConnection,
	boundary_path: str,
	selected_subtypes: tuple[str, ...],
	output_path: Path,
) -> Counter:
	subtype_sql = sql_string_list(selected_subtypes)
	query = f"""
		SELECT
			id,
			subtype,
			admin_level,
			country,
			region,
			is_disputed,
			perspectives,
			ST_AsGeoJSON(geometry) AS geometry_json
		FROM read_parquet('{boundary_path}', hive_partitioning=1)
		WHERE is_land = TRUE
			AND subtype IN ({subtype_sql});
	"""
	cursor = connection.execute(query)
	counts: Counter = Counter()

	with output_path.open("w", encoding="utf-8") as handle:
		while True:
			rows = cursor.fetchmany(10000)
			if not rows:
				break
			for (
				boundary_id,
				subtype,
				admin_level,
				country,
				region,
				is_disputed,
				perspectives,
				geometry_json,
			) in rows:
				subtype = str(subtype)
				properties = {
					"id": str(boundary_id),
					"subtype": subtype,
					"admin_level": int(admin_level) if admin_level is not None else None,
					"country": str(country) if country else None,
					"region": str(region) if region else None,
					"is_disputed": bool(is_disputed),
					"has_perspective": bool(perspectives is not None),
					"source": "Overture Maps",
				}
				write_feature(
					handle,
					geometry_json,
					properties,
					MINZOOM_BY_SUBTYPE[subtype],
				)
				counts[subtype] += 1

	return counts


def case_insensitive_property(properties: dict, *names: str) -> object:
	lookup = {str(key).upper(): value for key, value in properties.items()}
	for name in names:
		if name.upper() in lookup:
			return lookup[name.upper()]
	return None


def vienna_wfs_url() -> str:
	return VIENNA_WFS_BASE + "?" + urlencode(
		{
			"service": "WFS",
			"request": "GetFeature",
			"version": "1.1.0",
			"typeName": VIENNA_DATASET,
			"srsName": "EPSG:4326",
			"outputFormat": "json",
		}
	)


def export_vienna_districts(output_path: Path) -> dict:
	url = vienna_wfs_url()
	payload = fetch_json(url)
	if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
		raise RuntimeError("Vienna district WFS did not return a GeoJSON FeatureCollection.")

	features = payload.get("features")
	if not isinstance(features, list):
		raise RuntimeError("Vienna district WFS response has no feature list.")

	districts: list[tuple[int, str, dict, str]] = []
	for feature in features:
		if not isinstance(feature, dict):
			continue
		properties = feature.get("properties")
		geometry = feature.get("geometry")
		if not isinstance(properties, dict) or not isinstance(geometry, dict):
			continue
		if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
			raise RuntimeError(f"Unexpected Vienna district geometry: {geometry.get('type')!r}")

		number_raw = case_insensitive_property(properties, "BEZNR")
		name_raw = case_insensitive_property(properties, "NAMEK")
		try:
			number = int(number_raw)
		except (TypeError, ValueError):
			raise RuntimeError(f"Vienna district has invalid BEZNR: {number_raw!r}") from None
		name = str(name_raw or "").strip()
		if not name:
			raise RuntimeError(f"Vienna district {number} has no NAMEK.")

		source_id = str(feature.get("id") or f"BEZIRKSGRENZEOGD.{number}")
		districts.append((number, name, geometry, source_id))

	numbers = [number for number, _, _, _ in districts]
	if len(districts) != 23 or sorted(numbers) != list(range(1, 24)) or len(set(numbers)) != 23:
		raise RuntimeError(
			"Vienna district WFS validation failed: expected exactly districts 1 through 23, "
			f"got {sorted(numbers)!r}"
		)

	with output_path.open("w", encoding="utf-8") as handle:
		for number, name, geometry, source_id in sorted(districts):
			label = f"{number}. {name}"
			write_feature(
				handle,
				geometry,
				{
					"id": f"wien-district-{number}",
					"division_id": f"wien-district-{number}",
					"subtype": "borough",
					"admin_level": 2,
					"country": "AT",
					"region": "AT-9",
					"name": label,
					"hierarchy_names": f"Österreich\u001fWien\u001f{label}",
					"hierarchy_subtypes": "country\u001fregion\u001fborough",
					"has_perspective": False,
					"source": "Stadt Wien OGD",
					"source_id": source_id,
					"district_number": number,
				},
				VIENNA_DISTRICT_MINZOOM,
			)

	return {
		"dataset": VIENNA_DATASET,
		"url": url,
		"license": "CC BY 4.0",
		"count": len(districts),
		"district_numbers": sorted(numbers),
	}


def validate_pmtiles(path: Path) -> None:
	if not path.is_file() or path.stat().st_size < 7:
		raise RuntimeError(f"Tippecanoe did not create a valid PMTiles file: {path}")
	with path.open("rb") as handle:
		if handle.read(7) != b"PMTiles":
			raise RuntimeError(f"Invalid PMTiles header: {path}")


def build_pmtiles(
	tippecanoe: str,
	layers: tuple[tuple[str, Path], ...],
	output_path: Path,
	maxzoom: int,
	name: str,
	description: str,
	*,
	detect_shared_borders: bool = False,
) -> None:
	if not layers:
		raise ValueError("At least one Tippecanoe layer is required.")

	command = [
		tippecanoe,
		"--force",
		"--output",
		str(output_path),
		"--minimum-zoom=0",
		f"--maximum-zoom={maxzoom}",
		"--projection=EPSG:4326",
		"--read-parallel",
		"--no-feature-limit",
		"--no-tile-size-limit",
		f"--name={name}",
		f"--description={description}",
		f"--attribution={ATTRIBUTION}",
	]
	if detect_shared_borders:
		command.append("--detect-shared-borders")

	for layer_name, input_path in layers:
		command.extend(["-L", f"{layer_name}:{input_path}"])

	subprocess.run(command, check=True)
	validate_pmtiles(output_path)


def main() -> None:
	args = parse_args()
	for name, value in (
		("boundary-maxzoom", args.boundary_maxzoom),
		("area-maxzoom", args.area_maxzoom),
	):
		if not 0 <= value <= 23:
			raise ValueError(f"{name} must be between 0 and 23.")
	if args.area_maxzoom > args.boundary_maxzoom:
		raise ValueError("area-maxzoom must not exceed boundary-maxzoom.")

	release = resolve_release(args.release)
	selected_subtypes = parse_subtypes(args.subtypes)
	generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
	division_path = f"{S3_BASE}/{release}/theme=divisions/type=division/*.parquet"
	area_path = f"{S3_BASE}/{release}/theme=divisions/type=division_area/*.parquet"
	boundary_path = f"{S3_BASE}/{release}/theme=divisions/type=division_boundary/*.parquet"

	output_dir = args.output_dir.resolve()
	work_dir = args.work_dir.resolve()
	if output_dir.exists():
		shutil.rmtree(output_dir)
	if work_dir.exists():
		shutil.rmtree(work_dir)
	output_dir.mkdir(parents=True, exist_ok=True)
	work_dir.mkdir(parents=True, exist_ok=True)

	area_geojson = work_dir / "admin-area.geojsonseq"
	boundary_geojson = work_dir / "admin-boundary.geojsonseq"
	country_outline_geojson = work_dir / "admin-country-outline.geojsonseq"
	vienna_district_geojson = work_dir / "admin-vienna-district.geojsonseq"
	boundary_pmtiles = output_dir / "overture-admin-boundary.pmtiles"
	area_pmtiles = output_dir / "overture-admin-area.pmtiles"

	log(f"Using Overture release {release}")
	log("Auditing all Overture division subtypes")
	connection = open_duckdb()
	try:
		audit = source_audit(connection, division_path, area_path, boundary_path)
		log("Loading selected division metadata")
		subtype_sql = sql_string_list(selected_subtypes)
		connection.execute(
			f"""
			CREATE TEMP TABLE selected_divisions AS
			SELECT id, subtype, names, hierarchies, perspectives
			FROM read_parquet('{division_path}', hive_partitioning=1)
			WHERE subtype IN ({subtype_sql});
			"""
		)

		log("Streaming land-clipped administrative areas and high-detail country outlines")
		area_counts, outline_counts = export_areas(
			connection,
			area_path,
			selected_subtypes,
			area_geojson,
			country_outline_geojson,
		)

		log("Streaming land-clipped administrative boundaries")
		boundary_counts = export_boundaries(
			connection,
			boundary_path,
			selected_subtypes,
			boundary_geojson,
		)
	finally:
		connection.close()

	if sum(area_counts.values()) == 0:
		raise RuntimeError("No land areas were emitted for the selected Overture subtypes.")
	if sum(boundary_counts.values()) == 0:
		raise RuntimeError("No land boundaries were emitted for the selected Overture subtypes.")
	if outline_counts.get("country", 0) == 0:
		raise RuntimeError("No Overture country outlines were emitted.")

	log("Downloading and validating official Vienna district polygons")
	vienna = export_vienna_districts(vienna_district_geojson)

	log(
		"GeoJSONSeq sizes: "
		f"admin_area={area_geojson.stat().st_size} bytes, "
		f"admin_boundary={boundary_geojson.stat().st_size} bytes, "
		f"admin_country_outline={country_outline_geojson.stat().st_size} bytes, "
		f"admin_vienna_district={vienna_district_geojson.stat().st_size} bytes"
	)
	log(
		"Emitted admin_area: "
		+ ", ".join(f"{key}={value}" for key, value in sorted(area_counts.items()))
	)
	log(
		"Emitted admin_boundary: "
		+ ", ".join(f"{key}={value}" for key, value in sorted(boundary_counts.items()))
	)
	log(
		"Emitted admin_country_outline: "
		+ ", ".join(f"{key}={value}" for key, value in sorted(outline_counts.items()))
	)
	log(f"Emitted admin_vienna_district: {vienna['count']}")

	audit.update(
		{
			"source": "Overture Maps divisions + Stadt Wien OGD Bezirksgrenzen",
			"release": release,
			"generated_at": generated_at,
			"selected_subtypes": list(selected_subtypes),
			"minzoom_by_subtype": {
				subtype: MINZOOM_BY_SUBTYPE[subtype]
				for subtype in ALL_SUBTYPES
			},
			"vienna_district_minzoom": VIENNA_DISTRICT_MINZOOM,
			"boundary_maxzoom": args.boundary_maxzoom,
			"area_maxzoom": args.area_maxzoom,
			"vienna_districts": vienna,
			"emitted": {
				"admin_area": dict(sorted(area_counts.items())),
				"admin_boundary": dict(sorted(boundary_counts.items())),
				"admin_country_outline": dict(sorted(outline_counts.items())),
				"admin_vienna_district": {"borough": vienna["count"]},
			},
		}
	)
	(output_dir / "audit.json").write_text(
		json.dumps(audit, ensure_ascii=False, indent="\t") + "\n",
		encoding="utf-8",
	)

	if not args.skip_tiles:
		log(f"Building boundary PMTiles through z{args.boundary_maxzoom}")
		build_pmtiles(
			args.tippecanoe,
			(
				("admin_boundary", boundary_geojson),
				("admin_country_outline", country_outline_geojson),
				("admin_vienna_district", vienna_district_geojson),
			),
			boundary_pmtiles,
			args.boundary_maxzoom,
			"Kartensammlung administrative boundaries",
			"Administrative boundary lines, high-detail country land outlines, and Vienna districts",
		)
		log(f"Boundary PMTiles finished: {boundary_pmtiles.stat().st_size} bytes")

		log(f"Building area PMTiles through z{args.area_maxzoom}")
		build_pmtiles(
			args.tippecanoe,
			(
				("admin_area", area_geojson),
				("admin_vienna_district", vienna_district_geojson),
			),
			area_pmtiles,
			args.area_maxzoom,
			"Kartensammlung administrative interaction areas",
			"Administrative interaction polygons and official Vienna districts",
			detect_shared_borders=True,
		)
		log(f"Area PMTiles finished: {area_pmtiles.stat().st_size} bytes")

	release_payload = {
		"source": "Overture Maps divisions + Stadt Wien OGD Bezirksgrenzen",
		"release": release,
		"built_at": generated_at,
		"pmtiles": {
			"admin_boundary": boundary_pmtiles.name if boundary_pmtiles.exists() else None,
			"admin_area": area_pmtiles.name if area_pmtiles.exists() else None,
		},
		"layers": {
			"boundary_pmtiles": [
				"admin_boundary",
				"admin_country_outline",
				"admin_vienna_district",
			],
			"area_pmtiles": [
				"admin_area",
				"admin_vienna_district",
			],
		},
		"selected_subtypes": list(selected_subtypes),
		"boundary_maxzoom": args.boundary_maxzoom,
		"area_maxzoom": args.area_maxzoom,
		"vienna_district_minzoom": VIENNA_DISTRICT_MINZOOM,
		"attribution": ATTRIBUTION,
	}
	(output_dir / "release.json").write_text(
		json.dumps(release_payload, ensure_ascii=False, indent="\t") + "\n",
		encoding="utf-8",
	)

	print(f"Overture release: {release}")
	print("Selected subtypes: " + ", ".join(selected_subtypes))
	print(f"Vienna districts: {vienna['count']}")
	if boundary_pmtiles.exists():
		print(f"Boundary PMTiles: {boundary_pmtiles} ({boundary_pmtiles.stat().st_size} bytes)")
	if area_pmtiles.exists():
		print(f"Area PMTiles: {area_pmtiles} ({area_pmtiles.stat().st_size} bytes)")


if __name__ == "__main__":
	main()
