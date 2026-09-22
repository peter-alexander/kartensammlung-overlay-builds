# Wiener Baumdatensatz – Baumkataster + OpenStreetMap

Dieser Build erzeugt einen gemeinsamen Wiener Baumdatensatz für das sichtbare
Baumkataster-Overlay und für die Solar-/Schattenberechnung der Kartensammlung.

Die Quellen werden in dieser Reihenfolge zusammengeführt:

1. Wiener WFS `ogdwien:BAUMKATOGD` als hochwertige Primärquelle.
2. OpenStreetMap `natural=tree` für zusätzliche einzeln erfasste Bäume.
3. OpenStreetMap `natural=tree_row` als letzter punktbasierter Fallback.

Der Wiener Baumkataster gewinnt immer. OSM-Einzelbäume werden verworfen, wenn bereits
ein Baumkataster-Punkt innerhalb von 4 m liegt. Baumreihen werden entlang ihrer Geometrie
in Einzelpositionen aufgelöst und ebenfalls gegen Baumkataster und explizite OSM-Bäume
dedupliziert.

## Ausgabe

`build/Baumkataster/`

- `release.json`: Quellen, Erstellungszeitpunkt, Merge-Parameter, Feature-Zahlen, Tileschema und Index der tatsächlich vorhandenen Z15-Kacheln.
- `tilejson.json`: TileJSON für das sichtbare MapLibre-Overlay; enthält Bounds und eine mit `generatedAt` versionierte Tile-URL.
- `tiles/12/{x}/{y}.pbf` bis `tiles/15/{x}/{y}.pbf`: ungekomprimierte Vektorkacheln.
- Source-Layer: `baumkataster`.

Z12–Z14 dienen dem sichtbaren Kartenoverlay. Z15 bleibt die vollständige,
hochaufgelöste Eingabe für die 3D-/Schattenberechnung.

Leere Tippecanoe-Kacheln werden weiterhin nicht als Dateien erzeugt. Der Z15-Index in
`release.json` erlaubt dem Solar-Loader, solche Bereiche ohne HTTP-404 direkt als
leere Baumkacheln zu behandeln. Das sichtbare Overlay verwendet `tilejson.json`;
dessen Bounds verhindern unnötige Requests außerhalb des Wiener Datenbestands.

Es wird bewusst **kein paralleles PMTiles-Archiv** erzeugt. Sichtbares Overlay und
Solar-Loader verwenden denselben PBF-Datensatz.

Tippecanoe darf keine Bäume aus Dichte- oder Tile-Größen-Gründen verwerfen. Deshalb
werden `--no-feature-limit` und `--no-tile-size-limit` verwendet.

## Wiener Baumkataster

Vom WFS werden insbesondere übernommen:

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

Zusätzlich erhält jedes Feature `KS_SOURCE=wien_baumkataster` und eine stabile
`KS_ID`.

## OpenStreetMap

Die Wien-weite Overpass-Abfrage verwendet die Verwaltungsfläche
`ISO3166-2=AT-9` und lädt:

- Nodes mit `natural=tree`
- Ways mit `natural=tree_row`

Soweit vorhanden, werden OSM-Tags in dieselben Felder normalisiert, die auch der
Solar-Tree-Parser verwendet:

- `species` / `genus` → `GATTUNG_ART`
- `height` → `BAUMHOEHE_TXT`
- `diameter_crown` / `crown:diameter` → `KRONENDURCHMESSER_TXT`
- `circumference` bzw. `diameter` → `STAMMUMFANG`
- `start_date` → `PFLANZJAHR`
- `leaf_type` → `LEAF_TYPE`
- `leaf_cycle` → `LEAF_CYCLE`

OSM-Features erhalten `KS_SOURCE=osm_tree` oder `KS_SOURCE=osm_tree_row` sowie
`OSM_TYPE`, `OSM_ID` und eine stabile `KS_ID`.

Bei einer Baumreihe wird `tree_count` verwendet, wenn vorhanden. Andernfalls wird
mit 8 m Standardabstand gesampelt. Die erzeugten Punkte sind ausdrücklich eine
Approximation, solange keine Einzelbäume vorhanden sind.

## Validierung

Der Build bricht ab, wenn

- der WFS offensichtlich unvollständig ist,
- wesentliche WFS-Felder verschwunden sind,
- die Overpass-Antwort verdächtig klein ist,
- keine PBF-Kacheln für eine der Zoomstufen 12–15 erzeugt wurden.

Alle Merge- und Deduplizierungsparameter werden zusätzlich in `release.json`
dokumentiert.

## Lokal

```bash
TIPPECANOE_BIN=tippecanoe bash baumkataster/run.sh
```

Quellen:

- Stadt Wien – data.wien.gv.at, CC BY 4.0
- © OpenStreetMap contributors, ODbL
