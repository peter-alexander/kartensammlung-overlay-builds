# Overture administrative boundaries

This build creates a self-hosted PMTiles source for the Kartensammlung administration-boundary overlay from the Overture Maps `divisions` theme.

## Output

`build/OvertureAdmin/overture-admin.pmtiles` contains two source layers:

- `admin_boundary`: visible land-clipped administrative boundary lines from `division_boundary`.
- `admin_area`: land-clipped administrative polygons from `division_area`, intended as transparent interaction geometry for hover/click.

The first production candidate deliberately excludes Overture point labels. Country/area names for interaction are carried by `admin_area` instead.

Each area feature contains a compact default hierarchy:

- `name`
- `subtype`
- `admin_level`
- `country`
- `region`
- `hierarchy_names` — ordered names separated by U+001F, from country to the current division.
- `hierarchy_subtypes` — matching ordered Overture subtypes separated by U+001F.
- `has_perspective`

Boundary features are non-interactive and keep only properties useful for styling:

- `subtype`
- `admin_level`
- `country`
- `region`
- `is_disputed`
- `has_perspective`

## Source policy

Only `is_land = TRUE` areas and boundaries are used. Maritime/territorial geometries are excluded from this cartographic overlay.

The initial PMTiles build includes:

- `country`
- `dependency`
- `region`
- `county`

`macroregion` and `macrocounty` are still audited, but the current Overture release does not provide land-clipped `division_area` geometries for them, so they are not useful as interactive V1 layers.

All Overture division subtypes are audited on every run. Deeper levels can be added via `--subtypes` after their real-world coverage and output size have been reviewed.

Default minimum zooms are encoded per feature and the current test maximum zoom is 14.

## Audit

Every run writes `audit.json` with source counts by subtype for:

- `division`
- `division_area` (including land/territorial counts)
- `division_boundary` (including disputed/perspective counts)
- emitted PMTiles features

This is used to decide which deeper administrative levels should be enabled and whether the maximum zoom should remain 14 or be adjusted.

## Attribution

`© OpenStreetMap contributors, Overture Maps Foundation`
