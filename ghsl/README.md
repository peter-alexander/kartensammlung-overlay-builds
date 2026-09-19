# GHSL COG build

This directory prepares selected official JRC Global Human Settlement Layer rasters for direct browser-side COG access in the Kartensammlung.

## Products

- `GHS-SMOD R2023A`: 1975–2030, 5-year interval, WGS84 30 arcsec (~1 km), version 2.0.
- `GHS-AGE R2025A`: dominant age of the built stock, 1975–2020 in 5-year classes, World Mollweide 100 m, version 1.0.

The original JRC downloads are ZIP-packaged GeoTIFFs with companion ArcGIS CLR color tables. The build extracts both, embeds the official palette and rewrites the raster as a Cloud-Optimized GeoTIFF (COG) with nearest-neighbour overviews. AGE codes 0–10 remain unchanged. SMOD is safely normalized from Int16 with NoData -200 to Byte with NoData 0; all thematic class codes 10–30 remain unchanged.

## Build

```bash
bash ghsl/build.sh all
bash ghsl/build.sh smod
bash ghsl/build.sh age
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
├── smod/
│   ├── ghs-smod-1975.tif
│   ├── …
│   └── ghs-smod-2030.tif
└── release.json
```

## Deployment

The workflow uploads the files below `GHSL/` on the existing Easyname tile host:

- `https://tiles.radlobby.at/GHSL/age/ghs-age-100m.tif`
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
