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
- `tiles/12/{x}/{y}.pbf` bis `tiles/15/{x}/{y}.pbf`: gzip-komprimierte
  Vektorkacheln.
- Source-Layer: `wien_buildings`.

Die Web-Kacheln enthalten nur Attribute, die zur Laufzeit oder für die
bestehenden Gebäude-Audits benötigt werden: `render_height`,
`render_min_height`, `KS_ID`, `BW_GEB_ID`, `FMZK_ID`, `BEZUG` und `F_KLASSE`.
Die übrigen WFS-Attribute bleiben Teil der Normalisierung, werden aber nicht in
jede Vektorkachel dupliziert.

Z12–Z14 dienen der Kartenanzeige. Dort vereinfacht Tippecanoe die
Gebäudegeometrien mit dem Faktor 4. Es werden dabei weiterhin keine Gebäude
wegen Feature- oder Tile-Größen-Grenzen verworfen und auch die
Tiny-Polygon-Reduktion bleibt deaktiviert.

Z15 bleibt die vollständige Eingabe für die 3D-/Schattenberechnung. Mit
`--simplify-only-low-zooms` wird die Geometrie auf Z15 nicht vereinfacht.
Auch dort bleiben Feature- und Tile-Größen-Limits deaktiviert.

Die PBF-Dateien werden mit der normalen Tippecanoe-gzip-Kompression erzeugt.
Die frühere unkomprimierte Ausgabe war nur für einen alten Loader notwendig und
ist nicht mehr erforderlich.

## Aktualisierung

Der zugrunde liegende Wiener OGD-Datensatz wird unregelmäßig aktualisiert.
Der Produktionsworkflow läuft deshalb zweimal wöchentlich sowie bei Änderungen
an diesem Build.

## Lokal

```bash
TIPPECANOE_BIN=tippecanoe bash wien-buildings/run.sh
```

Datenquelle: Stadt Wien – data.wien.gv.at, CC BY 4.0

## Historischer Gebäudeschlüssel

`BEZUG` aus dem FMZK ist der historische Adresscode und dient zur kontrollierten
Verknüpfung mit dem älteren Wiener LOD2.1-Dachmodell, dessen `gml:name` denselben
historischen Code verwendet. `BW_GEB_ID` bleibt der aktuelle Gebäudeschlüssel;
`BEZUG` wird nicht als heutige Identität interpretiert. Beide Felder bleiben in
den Web-Kacheln erhalten, weil die bestehenden LOD2-/Gap-Audits darauf zugreifen.
