#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import duckdb

RELEASE = "2026-08-19.0"
S3_BASE = "s3://overturemaps-us-west-2/release"
TARGETS = (
	"Perchtoldsdorf",
	"Mödling",
	"Leoben",
	"Bruck an der Mur",
)


def normalize(value: str) -> str:
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


def hierarchy_summary(hierarchies: object) -> list[dict]:
	if not isinstance(hierarchies, list) or not hierarchies:
		return []
	first = hierarchies[0]
	if not isinstance(first, list):
		return []
	return [
		{
			"division_id": item.get("division_id"),
			"subtype": item.get("subtype"),
			"name": item.get("name"),
		}
		for item in first
		if isinstance(item, dict)
	]


def main() -> None:
	division_path = f"{S3_BASE}/{RELEASE}/theme=divisions/type=division/*.parquet"
	area_path = f"{S3_BASE}/{RELEASE}/theme=divisions/type=division_area/*.parquet"

	connection = duckdb.connect()
	connection.execute("INSTALL httpfs;")
	connection.execute("LOAD httpfs;")
	connection.execute("SET s3_region='us-west-2';")
	connection.execute("SET s3_url_style='path';")
	connection.execute("SET preserve_insertion_order=false;")

	rows = connection.execute(
		f"""
		SELECT
			a.id,
			a.division_id,
			a.subtype,
			a.admin_level,
			a.country,
			a.region,
			d.names,
			d.hierarchies
		FROM read_parquet('{area_path}', hive_partitioning=1) a
		LEFT JOIN read_parquet('{division_path}', hive_partitioning=1) d
			ON d.id = a.division_id
		WHERE a.is_land = TRUE
			AND a.country = 'AT';
		"""
	).fetchall()
	connection.close()

	target_lookup = {normalize(name): name for name in TARGETS}
	matches: dict[str, list[dict]] = {name: [] for name in TARGETS}

	for area_id, division_id, subtype, admin_level, country, region, names, hierarchies in rows:
		all_names = names_from_struct(names)
		normalized_names = {normalize(name) for name in all_names}
		for normalized, target in target_lookup.items():
			if normalized not in normalized_names:
				continue
			matches[target].append({
				"id": str(area_id),
				"division_id": str(division_id),
				"subtype": str(subtype),
				"admin_level": int(admin_level) if admin_level is not None else None,
				"country": country,
				"region": region,
				"names": all_names,
				"hierarchy": hierarchy_summary(hierarchies),
			})

	payload = {
		"release": RELEASE,
		"matches": matches,
	}
	Path("austria-places-audit.json").write_text(
		json.dumps(payload, ensure_ascii=False, indent="\t") + "\n",
		encoding="utf-8",
	)

	for target in TARGETS:
		print(f"TARGET\t{target}")
		for item in matches[target]:
			print(
				f"MATCH\t{target}\t{item['subtype']}\t"
				f"admin_level={item['admin_level']}\tregion={item['region']}\t"
				f"division_id={item['division_id']}"
			)


if __name__ == "__main__":
	main()
