#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

import duckdb

S3_BASE = "s3://overturemaps-us-west-2/release"
VIENNA_REGION = "AT-9"
VIENNA_DISTRICTS = (
	"Innere Stadt",
	"Leopoldstadt",
	"Landstraße",
	"Wieden",
	"Margareten",
	"Mariahilf",
	"Neubau",
	"Josefstadt",
	"Alsergrund",
	"Favoriten",
	"Simmering",
	"Meidling",
	"Hietzing",
	"Penzing",
	"Rudolfsheim-Fünfhaus",
	"Ottakring",
	"Hernals",
	"Währing",
	"Döbling",
	"Brigittenau",
	"Floridsdorf",
	"Donaustadt",
	"Liesing",
)


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser()
	parser.add_argument("--release", default="2026-08-19.0")
	parser.add_argument("--output", type=Path, default=Path("vienna-admin-audit.json"))
	return parser.parse_args()


def normalize_name(value: str) -> str:
	value = unicodedata.normalize("NFKD", value)
	value = "".join(char for char in value if not unicodedata.combining(char))
	value = value.casefold()
	return re.sub(r"[^a-z0-9]+", " ", value).strip()


def names_from_struct(names: object) -> list[str]:
	if not isinstance(names, dict):
		return []
	result: list[str] = []
	primary = names.get("primary")
	if isinstance(primary, str) and primary.strip():
		result.append(primary.strip())
	common = names.get("common")
	if isinstance(common, dict):
		for value in common.values():
			if isinstance(value, str) and value.strip():
				result.append(value.strip())
	return list(dict.fromkeys(result))


def best_name(names: object) -> str:
	values = names_from_struct(names)
	if not values:
		return ""
	if isinstance(names, dict):
		common = names.get("common")
		if isinstance(common, dict):
			for key in ("de", "de-AT", "de-DE"):
				value = common.get(key)
				if isinstance(value, str) and value.strip():
					return value.strip()
	return values[0]


def hierarchy_summary(hierarchies: object) -> list[dict]:
	if not isinstance(hierarchies, list) or not hierarchies:
		return []
	hierarchy = hierarchies[0]
	if not isinstance(hierarchy, list):
		return []
	result: list[dict] = []
	for item in hierarchy:
		if not isinstance(item, dict):
			continue
		result.append({
			"division_id": item.get("division_id"),
			"subtype": item.get("subtype"),
			"name": item.get("name"),
		})
	return result


def main() -> None:
	args = parse_args()
	division_path = f"{S3_BASE}/{args.release}/theme=divisions/type=division/*.parquet"
	area_path = f"{S3_BASE}/{args.release}/theme=divisions/type=division_area/*.parquet"
	boundary_path = f"{S3_BASE}/{args.release}/theme=divisions/type=division_boundary/*.parquet"

	connection = duckdb.connect()
	connection.execute("INSTALL httpfs;")
	connection.execute("LOAD httpfs;")
	connection.execute("SET s3_region='us-west-2';")
	connection.execute("SET s3_url_style='path';")
	connection.execute("SET preserve_insertion_order=false;")

	area_rows = connection.execute(
		f"""
		SELECT
			a.id,
			a.division_id,
			a.subtype,
			a.admin_level,
			a.names,
			a.country,
			a.region,
			d.parent_division_id,
			d.hierarchies
		FROM read_parquet('{area_path}', hive_partitioning=1) a
		LEFT JOIN read_parquet('{division_path}', hive_partitioning=1) d
			ON d.id = a.division_id
		WHERE a.is_land = TRUE
			AND a.country = 'AT'
			AND a.region = '{VIENNA_REGION}';
		"""
	).fetchall()

	boundary_rows = connection.execute(
		f"""
		SELECT
			subtype,
			admin_level,
			COUNT(*) AS total
		FROM read_parquet('{boundary_path}', hive_partitioning=1)
		WHERE is_land = TRUE
			AND country = 'AT'
			AND region = '{VIENNA_REGION}'
		GROUP BY subtype, admin_level
		ORDER BY subtype, admin_level;
		"""
	).fetchall()
	connection.close()

	district_lookup = {normalize_name(name): name for name in VIENNA_DISTRICTS}
	district_matches: dict[str, list[dict]] = {name: [] for name in VIENNA_DISTRICTS}
	area_counts: Counter = Counter()
	admin_candidates: list[dict] = []

	for (
		area_id,
		division_id,
		subtype,
		admin_level,
		names,
		country,
		region,
		parent_division_id,
		hierarchies,
	) in area_rows:
		subtype = str(subtype)
		area_counts[(subtype, admin_level)] += 1
		all_names = names_from_struct(names)
		entry = {
			"id": str(area_id),
			"division_id": str(division_id),
			"subtype": subtype,
			"admin_level": int(admin_level) if admin_level is not None else None,
			"name": best_name(names),
			"names": all_names,
			"country": country,
			"region": region,
			"parent_division_id": str(parent_division_id) if parent_division_id else None,
			"hierarchy": hierarchy_summary(hierarchies),
		}

		for candidate_name in all_names:
			normalized = normalize_name(candidate_name)
			if normalized in district_lookup:
				district_matches[district_lookup[normalized]].append(entry)
				break

		if subtype in {"country", "dependency", "region", "county", "localadmin", "borough"}:
			admin_candidates.append(entry)

	payload = {
		"release": args.release,
		"region": VIENNA_REGION,
		"area_counts": [
			{
				"subtype": subtype,
				"admin_level": int(admin_level) if admin_level is not None else None,
				"count": count,
			}
			for (subtype, admin_level), count in sorted(
				area_counts.items(),
				key=lambda item: (item[0][0], -1 if item[0][1] is None else item[0][1]),
			)
		],
		"boundary_counts": [
			{
				"subtype": str(subtype),
				"admin_level": int(admin_level) if admin_level is not None else None,
				"count": int(total),
			}
			for subtype, admin_level, total in boundary_rows
		],
		"district_matches": district_matches,
		"matched_district_count": sum(1 for matches in district_matches.values() if matches),
		"missing_districts": [name for name, matches in district_matches.items() if not matches],
		"admin_candidates": sorted(
			admin_candidates,
			key=lambda item: (
				item["subtype"],
				-1 if item["admin_level"] is None else item["admin_level"],
				item["name"],
			),
		),
	}
	args.output.write_text(json.dumps(payload, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")

	print(json.dumps({
		"release": payload["release"],
		"region": payload["region"],
		"matched_district_count": payload["matched_district_count"],
		"missing_districts": payload["missing_districts"],
		"area_counts": payload["area_counts"],
		"boundary_counts": payload["boundary_counts"],
	}, ensure_ascii=False, indent="\t"))

	for district, matches in district_matches.items():
		for match in matches:
			print(
				f"DISTRICT\t{district}\t{match['subtype']}\t"
				f"admin_level={match['admin_level']}\t{match['division_id']}"
			)


if __name__ == "__main__":
	main()
