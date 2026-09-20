#!/usr/bin/env python3
"""Merge a target-specific GHSL release manifest with the deployed manifest."""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys


def read_manifest(path: pathlib.Path) -> dict:
	data = json.loads(path.read_text(encoding="utf-8"))
	files = data.get("files")
	if not isinstance(files, list):
		raise SystemExit(f"{path}: files is missing or not a list")
	return data


def indexed_files(manifest: dict, label: str) -> dict[str, dict]:
	result: dict[str, dict] = {}
	for item in manifest["files"]:
		if not isinstance(item, dict):
			raise SystemExit(f"{label}: invalid file entry {item!r}")
		path = item.get("path")
		if not isinstance(path, str) or not path or path.startswith("/") or ".." in pathlib.PurePosixPath(path).parts:
			raise SystemExit(f"{label}: invalid relative path {path!r}")
		if path in result:
			raise SystemExit(f"{label}: duplicate path {path!r}")
		result[path] = item
	return result


def main() -> None:
	if len(sys.argv) != 4:
		raise SystemExit("usage: merge_release.py BASE UPDATE OUTPUT")

	base_path = pathlib.Path(sys.argv[1])
	update_path = pathlib.Path(sys.argv[2])
	output_path = pathlib.Path(sys.argv[3])
	base = read_manifest(base_path)
	update = read_manifest(update_path)

	files = indexed_files(base, "base")
	files.update(indexed_files(update, "update"))
	merged = {
		"source": "European Commission Joint Research Centre / GHSL",
		"built_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
		"files": [files[path] for path in sorted(files)],
	}

	temporary = output_path.with_suffix(output_path.suffix + ".part")
	temporary.write_text(json.dumps(merged, ensure_ascii=False, indent="\t") + "\n", encoding="utf-8")
	temporary.replace(output_path)
	print(f"Merged release manifest: {len(merged['files'])} files")


if __name__ == "__main__":
	main()
