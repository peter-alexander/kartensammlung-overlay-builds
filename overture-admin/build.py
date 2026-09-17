#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import duckdb

SCRIPT_DIR = Path(__file__).resolve().parent
STAC_URL = "https://stac.overturemaps.org/catalog.json"
S3_BASE = "s3://overturemaps-us-west-2/release"
RELEASE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.\d+$")
ATTRIBUTION = "© OpenStreetMap contributors, Overture Maps Foundation"
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
	"macroregion",
	"region",
	"macrocounty",
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


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Build a self-hosted Overture administrative-boundary PMTiles overlay."
	)
	parser.add_argument(
		"--release",
		default="latest",
		help="Overture release such as 2026-08-19.0. Default: latest STAC release.",
	)
	parser.add_argument(
		"--subtypes",
		default=",".join(DEFAULT_BUILD_SUBTYPES),
		help="Comma-separated Overture division subtypes to include in PMTiles.",
	)
	parser.add_argument(
		"--maxzoom",
		type=int,
		default=14,
		help="Maximum PMTiles zoom. Default: 14.",
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
		help="Run source audit and GeoJSON extraction without Tippecanoe.",
	)
	return parser.parse_args()


def validate_release(value: str) -> str:
	release = str(value or "").strip().rstrip("/")
	if not RELEASE_RE.fullmatch(release):
		raise ValueError(f"Invalid Overture release: {release!r}")
	return release


def resolve_release(value: str) -> str:
	if value != "latest":
		return validate_release(value)
	request = Request(
		STAC_URL,
		headers={"User-Agent": "kartensammlung-overlay-builds/overture-admin"},
	)
	with urlopen(request, timeout=30) as response:
		payload = json.load(response)
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


def write_feature(handle, geometry_json: str, properties: dict, minzoom: int) -> None:
	geometry = json.loads(geometry_json)
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
) -> Counter:
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
			AND a.subtype IN ({subtype_sql})
		ORDER BY a.subtype, a.id;
	"""
	cursor = connection.execute(query)
	counts: Counter = Counter()
	with output_path.open("w", encoding="utf-8") as handle:
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
				name = best_name(names)
				hierarchy_names, hierarchy_subtypes = hierarchy_properties(
					hierarchies,
					str(division_id),
					name,
				)
				properties = {
					"id": str(area_id),
					"division_id": str(division_id),
					"subtype": str(subtype),
					"admin_level": int(admin_level) if admin_level is not None else None,
					"country": str(country) if country else None,
					"region": str(region) if region else None,
					"name": name,
					"hierarchy_names": hierarchy_names,
					"hierarchy_subtypes": hierarchy_subtypes,
					"has_perspective": bool(perspectives is not None),
				}
				write_feature(
					handle,
					geometry_json,
					properties,
					MINZOOM_BY_SUBTYPE[str(subtype)],
				)
				counts[str(subtype)] += 1
	return counts


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
			AND subtype IN ({subtype_sql})
		ORDER BY subtype, id;
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
				properties = {
					"id": str(boundary_id),
					"subtype": str(subtype),
					"admin_level": int(admin_level) if admin_level is not None else None,
					"country": str(country) if country else None,
					"region": str(region) if region else None,
					"is_disputed": bool(is_disputed),
					"has_perspective": bool(perspectives is not None),
				}
				write_feature(
					handle,
					geometry_json,
					properties,
					MINZOOM_BY_SUBTYPE[str(subtype)],
				)
				counts[str(subtype)] += 1
	return counts


def build_pmtiles(
	tippecanoe: str,
	area_path: Path,
	boundary_path: Path,
	output_path: Path,
	maxzoom: int,
) -> None:
	command = [
		tippecanoe,
		"--force",
		"--output",
		str(output_path),
		"--minimum-zoom=0",
		f"--maximum-zoom={maxzoom}",
		"--projection=EPSG:4326",
		"--read-parallel",
		"--detect-shared-borders",
		"--no-feature-limit",
		"--no-tile-size-limit",
		"--name=Kartensammlung Overture administrative boundaries",
		"--description=Overture administrative boundary lines and transparent interaction areas",
		f"--attribution={ATTRIBUTION}",
		"-L",
		f"admin_boundary:{boundary_path}",
		"-L",
		f"admin_area:{area_path}",
	]
	subprocess.run(command, check=True)
	if not output_path.is_file() or output_path.stat().st_size < 7:
		raise RuntimeError("Tippecanoe did not create a valid PMTiles file.")
	with output_path.open("rb") as handle:
		if handle.read(7) != b"PMTiles":
			raise RuntimeError("Invalid PMTiles header.")


def main() -> None:
	args = parse_args()
	if not 0 <= args.maxzoom <= 23:
		raise ValueError("maxzoom must be between 0 and 23.")

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
	pmtiles_path = output_dir / "overture-admin.pmtiles"

	connection = open_duckdb()
	try:
		audit = source_audit(connection, division_path, area_path, boundary_path)
		subtype_sql = sql_string_list(selected_subtypes)
		connection.execute(
			f"""
			CREATE TEMP TABLE selected_divisions AS
			SELECT id, subtype, names, hierarchies, perspectives
			FROM read_parquet('{division_path}', hive_partitioning=1)
			WHERE subtype IN ({subtype_sql});
			"""
		)
		area_counts = export_areas(connection, area_path, selected_subtypes, area_geojson)
		boundary_counts = export_boundaries(
			connection,
			boundary_path,
			selected_subtypes,
			boundary_geojson,
		)
	finally:
		connection.close()

	missing_areas = [subtype for subtype in selected_subtypes if area_counts[subtype] == 0]
	if missing_areas:
		raise RuntimeError("No land areas emitted for selected subtype(s): " + ", ".join(missing_areas))

	audit.update(
		{
			"source": "Overture Maps divisions",
			"release": release,
			"generated_at": generated_at,
			"selected_subtypes": list(selected_subtypes),
			"minzoom_by_subtype": {
				subtype: MINZOOM_BY_SUBTYPE[subtype]
				for subtype in ALL_SUBTYPES
			},
			"maxzoom": args.maxzoom,
			"emitted": {
				"admin_area": dict(sorted(area_counts.items())),
				"admin_boundary": dict(sorted(boundary_counts.items())),
			},
		}
	)
	(output_dir / "audit.json").write_text(
		json.dumps(audit, ensure_ascii=False, indent="\t") + "\n",
		encoding="utf-8",
	)

	if not args.skip_tiles:
		build_pmtiles(args.tippecanoe, area_geojson, boundary_geojson, pmtiles_path, args.maxzoom)

	release_payload = {
		"source": "Overture Maps divisions",
		"release": release,
		"built_at": generated_at,
		"pmtiles": pmtiles_path.name if pmtiles_path.exists() else None,
		"layers": ["admin_boundary", "admin_area"],
		"selected_subtypes": list(selected_subtypes),
		"maxzoom": args.maxzoom,
		"attribution": ATTRIBUTION,
	}
	(output_dir / "release.json").write_text(
		json.dumps(release_payload, ensure_ascii=False, indent="\t") + "\n",
		encoding="utf-8",
	)

	print(f"Overture release: {release}")
	print("Selected subtypes: " + ", ".join(selected_subtypes))
	print("admin_area: " + ", ".join(f"{key}={value}" for key, value in sorted(area_counts.items())))
	print("admin_boundary: " + ", ".join(f"{key}={value}" for key, value in sorted(boundary_counts.items())))
	if pmtiles_path.exists():
		print(f"PMTiles: {pmtiles_path} ({pmtiles_path.stat().st_size} bytes)")


if __name__ == "__main__":
	main()
