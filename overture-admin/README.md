# Overture administrative boundaries

This build creates two self-hosted PMTiles files for the Kartensammlung administrative-boundary overlay.

## Output

### `overture-admin-boundary.pmtiles`

Visible geometry through the configured boundary maximum zoom (currently z14):

- `admin_boundary`: Overture `division_boundary` land boundaries.
- `admin_country_outline`: boundaries derived from the original high-detail Overture `country` / `dependency` land polygons with `ST_Boundary`, stored as real line geometry so coastlines are available at the same detail level as country borders without tiling full polygons through z14.
- `admin_vienna_district`: line boundaries derived from the 23 official Vienna district polygons from Stadt Wien OGD.

### `overture-admin-area.pmtiles`

Interaction geometry through the configured area maximum zoom (currently z11, overzoomed by MapLibre above that):

- `admin_area`: Overture land-clipped administrative polygons.
- `admin_vienna_district`: the same 23 official Vienna district polygons for hover and click interaction.

The country-outline layer contains only line geometry derived from the country/dependency polygons before Tippecanoe. Where an outline coincides with an explicit Overture land border, the explicit `admin_boundary` layer is rendered above it. Along the coast, the outline supplies the missing line geometry.

## Overture source policy

Only `is_land = TRUE` Overture areas and boundaries are used. Maritime/territorial boundary geometries are excluded from the normal administration layer.

The default global Overture build includes:

- `country`
- `dependency`
- `region`
- `county`

All Overture division subtypes are audited on every run. Deeper levels remain excluded until their coverage and output size are deliberately accepted.

Each Overture interaction area contains:

- `name`
- `subtype`
- `admin_level`
- `country`
- `region`
- `hierarchy_names` — ordered names separated by U+001F.
- `hierarchy_subtypes` — matching ordered subtypes separated by U+001F.
- `has_perspective`
- `source`

## Vienna districts

The build downloads `ogdwien:BEZIRKSGRENZEOGD` from the Stadt Wien WFS in EPSG:4326 on every run.

The source is validated before tiling:

- exactly 23 polygon/multipolygon features must be present;
- district numbers must be exactly 1 through 23;
- every district must have a name.

The emitted hierarchy is:

`Österreich → Wien → <district number>. <district name>`

Vienna districts start at z9.

## Audit

Every run writes `audit.json` with:

- Overture source counts by subtype;
- emitted Overture areas and boundaries;
- emitted high-detail country outlines;
- Vienna WFS source URL, license, district count and district numbers;
- configured area/boundary zooms.

`release.json` records the PMTiles filenames, source layers, attribution and build parameters.

## Attribution

- © OpenStreetMap contributors, Overture Maps Foundation
- Stadt Wien – data.wien.gv.at, CC BY 4.0
