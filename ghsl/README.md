# GHSL COG build

This directory prepares selected official JRC Global Human Settlement Layer rasters for direct browser-side COG access in the Kartensammlung.

## Products

- `GHS-SMOD R2023A`: 1975–2030, 5-year interval, WGS84 30 arcsec (~1 km), version 2.0.
- `GHS-AGE R2025A`: dominant age of the built stock, 1975–2020 in 5-year classes, World Mollweide 100 m, version 1.0.
- `GHS-BUILT-H R2023A`: Average of the Net Building Height (ANBH), reference year 2018, World Mollweide 100 m, version 1.0.

The original JRC downloads are ZIP-packaged GeoTIFFs. SMOD and AGE include companion ArcGIS CLR color tables; their build embeds the official palette and creates COGs with nearest-neighbour overviews. AGE codes 0–10 remain unchanged. SMOD is safely normalized from Int16 with NoData -200 to Byte with NoData 0; all thematic class codes 10–30 remain unchanged.

The ANBH build deliberately keeps the original numeric band type, World Mollweide projection, 100 m grid, extent, geotransform, NoData value and full-resolution height values. It does not reproject or recolor the source. The output uses lossless DEFLATE with a floating-point predictor and average-resampled internal overviews for display. Validation compares source and COG values around cities on six continents and writes a machine-readable report.

## Build

```bash
bash ghsl/build.sh all
bash ghsl/build.sh smod
bash ghsl/build.sh age
bash ghsl/build.sh height
```

Requirements:

- curl
- unzip
- GDAL with the COG driver
- Python 3
- Python GDAL bindings (`python3-gdal`)

Outputs:

```text
ghsl/output/
├── age/
│   └── ghs-age-100m.tif
├── height/
│   └── ghs-built-h-anbh-2018-100m.tif
├── smod/
│   ├── ghs-smod-1975.tif
│   ├── …
│   └── ghs-smod-2030.tif
├── validation/
│   └── ghs-built-h-anbh-2018-100m.json
└── release.json
```

## Deployment

The workflow uploads the files below `GHSL/` on the existing Easyname tile host:

- `https://tiles.radlobby.at/GHSL/age/ghs-age-100m.tif`
- `https://tiles.radlobby.at/GHSL/height/ghs-built-h-anbh-2018-100m.tif`
- `https://tiles.radlobby.at/GHSL/smod/ghs-smod-YYYY.tif`
- `https://tiles.radlobby.at/GHSL/release.json`

The tile host must keep HTTP byte-range requests and CORS enabled because the browser reads only the required COG ranges. `cog-tiler-wasm` then renders the embedded categorical palette directly and can still query the original class value at a point.

## Sources

SMOD pattern:

```text
https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/
GHS_SMOD_GLOBE_R2023A/
GHS_SMOD_EYYYY_GLOBE_R2023A_4326_30ss/
V2-0/
GHS_SMOD_EYYYY_GLOBE_R2023A_4326_30ss_V2_0.zip
```

AGE:

```text
https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/
GHS_AGE_GLOBE_R2025A/V1-0/
GHS_AGE_1975052020_GLOBE_R2025A_54009_100_V1_0.zip
```

ANBH 2018:

```text
https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/
GHS_BUILT_H_GLOBE_R2023A/
GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100/
V1-0/
GHS_BUILT_H_ANBH_E2018_GLOBE_R2023A_54009_100_V1_0.zip
```

## ANBH validation

`ghsl/build.sh height` fails unless all of these checks pass:

- one band, unchanged numeric GDAL data type;
- unchanged raster dimensions, geotransform, World Mollweide projection and NoData value;
- original 100 m pixel size;
- lossless equality of 17 × 17 pixel windows around Wien, New York, São Paulo, Lagos, Delhi and Sydney;
- at least four internal overviews;
- GDAL `LAYOUT=COG`, 512-pixel blocks and lossless DEFLATE compression.

The report in `ghsl/output/validation/` also records the original archive URL, size and SHA-256, COG structure, overview dimensions, and regional min/max/mean ANBH sample values.

Reuse: European Union / JRC GHSL data, source acknowledgment required.


## Deploy eines vorhandenen Actions-Artefakts

Ein bereits vollständig gebautes GHSL-Artefakt kann ohne erneuten Rasterbuild deployed werden.

Im Workflow **Build GHSL COGs**:

- `deploy = true`
- `artifact_run_id = <Workflow-Run-ID>`
- `target` wird in diesem Fall ignoriert.

Der Workflow lädt dann die `ghsl-cogs-*`-Artefakte dieses Runs mit `actions/download-artifact` und überträgt sie direkt nach `tiles.radlobby.at/GHSL/`.

Für den vollständig validierten Produktions-Test vom 19. September 2026:

```text
Run ID: 35450480802
Artifact ID: 10585864839
Artifact SHA-256: 081d9230ff6b1fdb8f00331bfe9fc9b3f151c3d1fb48874e9d354dae008bed70
```
