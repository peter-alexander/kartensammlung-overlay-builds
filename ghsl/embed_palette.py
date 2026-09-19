#!/usr/bin/env python3

from __future__ import annotations

import pathlib
import sys

from osgeo import gdal


def fail(message: str) -> None:
	raise SystemExit(message)


def read_clr(path: pathlib.Path) -> dict[int, tuple[int, int, int, int]]:
	entries: dict[int, tuple[int, int, int, int]] = {}

	for line_number, raw in enumerate(path.read_text(encoding="utf-8-sig", errors="replace").splitlines(), start=1):
		line = raw.strip()
		if not line or line.startswith("#"):
			continue

		parts = line.replace(",", " ").split()
		if len(parts) < 4:
			continue

		try:
			value = int(float(parts[0]))
			red = int(float(parts[1]))
			green = int(float(parts[2]))
			blue = int(float(parts[3]))
			alpha = int(float(parts[4])) if len(parts) >= 5 else 255
		except ValueError:
			continue

		if value < 0 or value > 255:
			continue
		if any(component < 0 or component > 255 for component in (red, green, blue, alpha)):
			fail(f"{path}:{line_number}: ungültiger RGBA-Wert")

		entries[value] = (red, green, blue, alpha)

	if not entries:
		fail(f"Keine verwertbaren Farbtabelleneinträge in {path}")

	return entries


def main() -> None:
	if len(sys.argv) not in {3, 4}:
		fail("Usage: embed_palette.py <raster.tif> <palette.clr> [transparent-code]")

	raster_path = pathlib.Path(sys.argv[1])
	clr_path = pathlib.Path(sys.argv[2])
	transparent_code = int(sys.argv[3]) if len(sys.argv) == 4 else None

	entries = read_clr(clr_path)
	if transparent_code is not None:
		entries[transparent_code] = (0, 0, 0, 0)

	dataset = gdal.Open(str(raster_path), gdal.GA_Update)
	if dataset is None:
		fail(f"Raster kann nicht zum Schreiben geöffnet werden: {raster_path}")

	band = dataset.GetRasterBand(1)
	if band is None:
		fail(f"Band 1 fehlt: {raster_path}")

	color_table = gdal.ColorTable()
	for value, rgba in sorted(entries.items()):
		color_table.SetColorEntry(value, rgba)

	band.SetRasterColorTable(color_table)
	band.SetRasterColorInterpretation(gdal.GCI_PaletteIndex)
	band.FlushCache()
	dataset.FlushCache()
	dataset = None

	check = gdal.Open(str(raster_path), gdal.GA_ReadOnly)
	if check is None:
		fail(f"Raster kann nach Palette-Update nicht gelesen werden: {raster_path}")

	check_band = check.GetRasterBand(1)
	check_table = check_band.GetRasterColorTable()
	if check_table is None or check_table.GetCount() <= max(entries):
		fail(f"Farbpalette wurde nicht korrekt eingebettet: {raster_path}")

	for value, rgba in entries.items():
		actual = check_table.GetColorEntry(value)
		if actual is None or tuple(actual) != tuple(rgba):
			fail(
				f"Farbwert {value} stimmt nicht: erwartet {rgba}, erhalten {actual}"
			)

	print(f"Palette eingebettet: {raster_path} ({len(entries)} definierte Klassen)")


if __name__ == "__main__":
	main()
