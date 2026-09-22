# Wiener LOD2.1-Dachfallback – Pilot

Dieser Pilot konvertiert gezielt Gebäude aus dem amtlichen Wiener
**Generalisierten Dachmodell (LOD2.1)**, die im aktuellen Maptoolkit/Stadtplan-
Gebäudemodell fehlen und bei denen LOD2.1 gegenüber dem aktuellen OGD-LOD1
einen echten Dachgeometrie-Mehrwert bietet.

Pilotgebäude:

- Straußengasse 2–10 – historischer Adresscode `212535`
- Straußengasse 12 – `009238`
- Straußengasse 14 – `113842`
- TU Wien, Karlsplatz 13 – `006973`

Die WKO wird im Pilot bewusst nicht übernommen: Das alte LOD2.1 modelliert sie
ebenfalls nur mit Flachdach und der historische Join-Key stimmt dort nicht mehr
direkt mit dem aktuellen FMZK-Bestand überein.

## Ausgabe

`build/WienLOD21/`

- `release.json`: Version, Quellblätter, Pilotgebäude und vorhandene Z15-Kacheln.
- `tiles/15/{x}/{y}.bin`: binäres, bereits trianguliertes Meshformat
  `KSL21M01`.

Das Browser-Rendering muss dadurch weder CityGML parsen noch Dächer
triangulieren. Die Z-Werte sind pro Gebäude relativ zur historischen
Gebäudebasis gespeichert und werden im Client wie die anderen Wiener
Gebäudemodelle auf das aktuelle Terrain gesetzt.

Priorität im Client:

1. aktuelles Maptoolkit/Stadtplan-LOD2
2. geprüftes Wiener LOD2.1
3. aktuelles OGD-Baukörpermodell LOD1
