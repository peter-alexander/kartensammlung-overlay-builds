# Wiener Baumkataster – Solar-3D-Vektorkacheln

Dieser Build erzeugt aus dem vollständigen Wiener WFS-Datensatz `ogdwien:BAUMKATOGD`
ungekomprimierte Mapbox-Vector-Tiles für die Solar-/Schattenberechnung der Kartensammlung.

Die Stadtplan-Wien-PBFs enthalten nur ein reduziertes Darstellungs-Schema. Für die
3D-Baumgeometrie werden dagegen insbesondere Baumart, Baumhöhe, Kronendurchmesser und
Stammumfang benötigt. Deshalb wird hier direkt der WFS als Build-Quelle verwendet.

## Ausgabe

`build/Baumkataster/`

- `release.json`: Quelle, Erstellungszeitpunkt, Feature-Zahlen und Tileschema.
- `tiles/15/{x}/{y}.pbf`: ungekomprimierte Z15-Vektorkacheln.
- Source-Layer: `baumkataster`.

Z15 ist absichtlich die einzige erzeugte Zoomstufe. Die Kacheln dienen nicht als
allgemeines Kartenoverlay, sondern als räumlich gekachelte Eingabe für die
Baumschatten-Berechnung. Bei einer Standard-Extent-Größe von 4096 liegt die
Positionsquantisierung in Wien deutlich unter einem Meter.

Tippecanoe darf keine Bäume aus Dichte- oder Tile-Größen-Gründen verwerfen. Deshalb
werden `--no-feature-limit` und `--no-tile-size-limit` verwendet.

## Übernommene Attribute

- `OBJECTID`
- `BAUM_ID`
- `BEZIRK`
- `OBJEKT_STRASSE`
- `GEBIETSGRUPPE`
- `GATTUNG_ART`
- `PFLANZJAHR`, `PFLANZJAHR_TXT`
- `STAMMUMFANG`, `STAMMUMFANG_TXT`
- `BAUMHOEHE`, `BAUMHOEHE_TXT`
- `KRONENDURCHMESSER`, `KRONENDURCHMESSER_TXT`
- `BAUMNUMMER`

Der Build validiert, dass die für die Solar-Geometrie wesentlichen WFS-Felder weiterhin
vorhanden sind und bricht bei einem unerwarteten Schemasprung oder einem offensichtlich
unvollständigen Download ab.

## Lokal

```bash
TIPPECANOE_BIN=tippecanoe bash baumkataster/run.sh
```

Quelle: Stadt Wien, data.wien.gv.at, CC BY 4.0.
