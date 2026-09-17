#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CORE_PATH = SCRIPT_DIR / "build.py"

spec = importlib.util.spec_from_file_location("overture_admin_core", CORE_PATH)
if spec is None or spec.loader is None:
	raise RuntimeError(f"Cannot load {CORE_PATH}")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(
		description="Build split Overture admin PMTiles for display lines and interactive areas."
	)
	parser.add_argument("--release", default="latest")
	parser.add_argument("--subtypes", default=",".join(core.DEFAULT_BUILD_SUBTYPES))
	parser.add_argument("--boundary-maxzoom", type=int, default=14)
	parser.add_argument("--area-maxzoom", type=int, default=11)
	parser.add_argument("--tippecanoe", default="tippecanoe")
	parser.add_argument(
		"--output-dir",
		type=Path,
		default=SCRIPT_DIR / "build" / "OvertureAdmin",
	)
	parser.add_argument(
		"--work-dir",
		type=Path,
		default=SCRIPT_DIR / "build" / "tmp",
	)
	parser.add_argument("--skip-tiles", action="store_true")
	return parser.parse_args()


def validate_pmtiles(path: Path) -> None:
	if not path.is_file() or path.stat().st_size < 7:
		raise RuntimeError(f"Tippecanoe did not create a valid PMTiles file: {path}")
	with path.open("rb") as handle:
		if handle.read(7) != b"PMTiles":
			raise RuntimeError(f"Invalid PMTiles header: {path}")


def build_layer_pmtiles(
	tippecanoe: str,
	input_path: Path,
	output_path: Path,
	layer_name: str,
	maxzoom: int,
	description: str,
	*,
	detect_shared_borders: bool = False,
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
		"--no-feature-limit",
		"--no-tile-size-limit",
		f"--name=Kartensammlung Overture {layer_name}",
		f"--description={description}",
		f"--attribution={core.ATTRIBUTION}",
	]
	if detect_shared_borders:
		command.append("--detect-shared-borders")
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
			raise ValueError(f"{name} must be between 0 and 23")
	if args.area_maxzoom > args.boundary_maxzoom:
		raise ValueError("area-maxzoom must not exceed boundary-maxzoom")

	release = core.resolve_release(args.release)
	selected_subtypes = core.parse_subtypes(args.subtypes)
	generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
	division_path = f"{core.S3_BASE}/{release}/theme=divisions/type=division/*.parquet"
	area_path = f"{core.S3_BASE}/{release}/theme=divisions/type=division_area/*.parquet"
	boundary_path = f"{core.S3_BASE}/{release}/theme=divisions/type=division_boundary/*.parquet"

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
	boundary_pmtiles = output_dir / "overture-admin-boundary.pmtiles"
	area_pmtiles = output_dir / "overture-admin-area.pmtiles"

	core.log(f"Using Overture release {release}")
	core.log("Auditing all Overture division subtypes")
	connection = core.open_duckdb()
	try:
		audit = core.source_audit(connection, division_path, area_path, boundary_path)
		core.log("Loading selected division metadata")
		subtype_sql = core.sql_string_list(selected_subtypes)
		connection.execute(
			f"""
			CREATE TEMP TABLE selected_divisions AS
			SELECT id, subtype, names, hierarchies, perspectives
			FROM read_parquet('{division_path}', hive_partitioning=1)
			WHERE subtype IN ({subtype_sql});
			"""
		)
		core.log("Streaming land-clipped administrative areas")
		area_counts = core.export_areas(connection, area_path, selected_subtypes, area_geojson)
		core.log("Streaming land-clipped administrative boundaries")
		boundary_counts = core.export_boundaries(
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

	core.log(
		f"GeoJSONSeq sizes: admin_area={area_geojson.stat().st_size} bytes, "
		f"admin_boundary={boundary_geojson.stat().st_size} bytes"
	)
	core.log(
		"Emitted admin_area: "
		+ ", ".join(f"{key}={value}" for key, value in sorted(area_counts.items()))
	)
	core.log(
		"Emitted admin_boundary: "
		+ ", ".join(f"{key}={value}" for key, value in sorted(boundary_counts.items()))
	)

	audit.update(
		{
			"source": "Overture Maps divisions",
			"release": release,
			"generated_at": generated_at,
			"selected_subtypes": list(selected_subtypes),
			"minzoom_by_subtype": {
				subtype: core.MINZOOM_BY_SUBTYPE[subtype]
				for subtype in core.ALL_SUBTYPES
			},
			"boundary_maxzoom": args.boundary_maxzoom,
			"area_maxzoom": args.area_maxzoom,
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
		core.log(f"Building admin_boundary PMTiles through z{args.boundary_maxzoom}")
		build_layer_pmtiles(
			args.tippecanoe,
			boundary_geojson,
			boundary_pmtiles,
			"admin_boundary",
			args.boundary_maxzoom,
			"Overture administrative boundary lines for display",
		)
		core.log(
			f"admin_boundary PMTiles finished: {boundary_pmtiles.stat().st_size} bytes"
		)

		core.log(f"Building admin_area PMTiles through z{args.area_maxzoom}")
		build_layer_pmtiles(
			args.tippecanoe,
			area_geojson,
			area_pmtiles,
			"admin_area",
			args.area_maxzoom,
			"Overture land-clipped administrative areas for hover and click interaction",
			detect_shared_borders=True,
		)
		core.log(f"admin_area PMTiles finished: {area_pmtiles.stat().st_size} bytes")

	release_payload = {
		"source": "Overture Maps divisions",
		"release": release,
		"built_at": generated_at,
		"pmtiles": {
			"admin_boundary": boundary_pmtiles.name if boundary_pmtiles.exists() else None,
			"admin_area": area_pmtiles.name if area_pmtiles.exists() else None,
		},
		"selected_subtypes": list(selected_subtypes),
		"boundary_maxzoom": args.boundary_maxzoom,
		"area_maxzoom": args.area_maxzoom,
		"attribution": core.ATTRIBUTION,
	}
	(output_dir / "release.json").write_text(
		json.dumps(release_payload, ensure_ascii=False, indent="\t") + "\n",
		encoding="utf-8",
	)

	print(f"Overture release: {release}")
	print("Selected subtypes: " + ", ".join(selected_subtypes))
	if boundary_pmtiles.exists():
		print(f"Boundary PMTiles: {boundary_pmtiles} ({boundary_pmtiles.stat().st_size} bytes)")
	if area_pmtiles.exists():
		print(f"Area PMTiles: {area_pmtiles} ({area_pmtiles.stat().st_size} bytes)")


if __name__ == "__main__":
	main()
