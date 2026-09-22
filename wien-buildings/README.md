# Wiener Gebäude – vollständiger LOD1-Fallback

Dieser Build erzeugt einen gekachelten Wiener Gebäudedatensatz aus dem offiziellen
OGD-Baukörpermodell `ogdwien:FMZKBKMOGD`.

Zweck ist ein vollständiger LOD1-Fallback für die Kartensammlung. Der vom
Stadtplan Wien verwendete `buildings2d`-/`buildings3d`-Datensatz lässt einzelne
Gebäude aus. Das OGD-Baukörpermodell wird deshalb als Primärquelle für LOD1
verwendet; das detaillierte Wiener LOD2 ersetzt diese Prismen nur dort, wo
tatsächlich LOD2-Geometrie vorhanden ist.

## Verwendete Klassen

- `11` Gebäude
- `12` Überbauung / Verbindungsgang
- `13` Flugdach
- `14` Glashaus
- `19` Sonstige Gebäudefläche

## Höhen

Die Quellattribute werden in für MapLibre und den Solar-Renderer direkt nutzbare
relative Höhen übersetzt:

- `render_height = O_KOTE - (T_KOTE ?? HOEHE_DGM)`
- `render_min_height = max(0, U_KOTE - (T_KOTE ?? HOEHE_DGM))`

Damit bleiben auch Überbauungen mit einer Unterkante oberhalb des Geländes
darstellbar.

## Ausgabe

`build/WienBuildings/`

- `release.json`: Quelle, Erstellungszeitpunkt, Feature-Zahlen, Höhenmodell und
  Index der tatsächlich vorhandenen Z15-Kacheln.
- `tilejson.json`: TileJSON für den sichtbaren MapLibre-Layer.
- `tiles/12/{x}/{y}.pbf` bis `tiles/15/{x}/{y}.pbf`: ungekomprimierte
  Vektorkacheln.
- Source-Layer: `wien_buildings`.

Z12–Z14 dienen der Kartenanzeige. Z15 bleibt die vollständige Eingabe für die
3D-/Schattenberechnung.

Die PBF-Dateien sind bewusst ungekomprimiert, damit der Solar-Loader dieselben
Kacheln direkt als MVT lesen kann. Tippecanoe darf keine Gebäude wegen
Dichte- oder Tile-Größen-Grenzen verwerfen.

## Aktualisierung

Der zugrunde liegende Wiener OGD-Datensatz wird unregelmäßig aktualisiert.
Der Produktionsworkflow läuft deshalb monatlich sowie bei Änderungen an diesem
Build.

## Lokal

```bash
TIPPECANOE_BIN=tippecanoe bash wien-buildings/run.sh
```

Datenquelle: Stadt Wien – data.wien.gv.at, CC BY 4.0

## Historischer Gebäudeschlüssel

Zusätzlich bleibt `BEZUG` aus dem FMZK erhalten. Das Feld ist der historische
Adresscode und dient zur kontrollierten Verknüpfung mit dem älteren Wiener
LOD2.1-Dachmodell, dessen `gml:name` denselben historischen Code verwendet.
`BW_GEB_ID` bleibt der aktuelle Gebäudeschlüssel; `BEZUG` wird nicht als heutige
Identität interpretiert.
