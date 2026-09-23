# Wien LOD2.1 Fallback

Das Wiener LOD2.1 dient ausschließlich als **sekundärer Dach-Fallback** für
Gebäude, für die das aktuelle Maptoolkit/Stadtplan-LOD2 vollständig fehlt.

Priorität:

1. aktuelles Maptoolkit/Stadtplan-LOD2
2. geprüftes Wiener LOD2.1
3. aktuelles OGD-Baukörpermodell LOD1

## Matching

Primär wird der historische FMZK-Adresscode `BEZUG` mit `gml:name` des
LOD2.1 verknüpft. Räumliche Treffer ohne historischen Code werden analysiert,
aber nicht automatisch produktiv übernommen.

Für eine automatische Übernahme muss der historische Code außerdem eindeutig
sein: genau eine heutige `BW_GEB_ID`, keine bereits mit aktuellem
Maptoolkit-LOD2 versorgten Teile desselben Codes und keine weiteren heutigen
Gebäude-IDs mit demselben Code. Shared-Code-Fälle bleiben Analyseergebnis.

Die Plausibilitätsprüfung verwendet unter anderem:

- Flächenüberdeckung in beide Richtungen,
- Intersection-over-Union,
- Schwerpunktabstand,
- Höhenabweichung,
- Vorhandensein geneigter Dachflächen.

## Klassen

- `strong`: heutiger und historischer Grundriss stimmen weitgehend überein.
  Diese Fälle können das aktuelle OGD-LOD1 direkt ersetzen, sofern das LOD2.1
  tatsächlich geneigte Dachflächen enthält.
- `legacy-subset`: das historische Dach liegt nahezu vollständig innerhalb
  des heutigen, inzwischen größeren Gebäudes. Diese Fälle dürfen **nicht**
  pauschal das heutige LOD1 ersetzen. Für die Produktion ist ein Hybrid aus
  LOD2.1-Dach und heutiger Restfläche als LOD1 nötig.
- `plausible`: geometrisch möglich, aber für automatische Produktion zu
  unsicher.
- `reject`: nicht verwenden.

Die bekannten Pilotgebäude dienen als Regressionstest: TU Wien ist ein
`strong`-Fall; Straußengasse 2–14 sind `legacy-subset`-Fälle.

## Analyse

`wien-buildings/analyze-maptoolkit-gaps.mjs` ermittelt aus aktuellem OGD und
Maptoolkit die vollständig fehlenden Gebäude bzw. FMZK-Teile.

`wien-lod21/match-candidates.mjs` vergleicht diese Kandidaten mit dem
historischen CityGML.

`wien-lod21/merge-match-reports.mjs` führt parallele Batch-Berichte
stadtweit zusammen und dedupliziert Kandidaten an Blattgrenzen.


## Produktions-Snapshot

`targets.production.json` ist der derzeit freigegebene Produktionssatz. Er
wurde aus der vollständigen Stadtanalyse vom 22. September 2026 erzeugt und
enthält:

- 1.209 automatisch freigegebene `direct-strong`-Gebäude,
- 1 manuell bestätigte `manual-pilot-strong`-Ausnahme (TU Wien),
- 3 manuell bestätigte `manual-pilot-hybrid`-Ausnahmen in der Straußengasse,
- 538 benötigte LOD2.1-Quellblätter.

Die übrigen 1.063 sicheren `legacy-subset`-Kandidaten werden **noch nicht**
automatisch gebaut. Für sie muss zuerst die heutige zusätzliche Grundrissfläche
als LOD1 erhalten bleiben.

## Hybrid-Restgeometrie

Für `legacy-subset`-Fälle wird die zusätzliche heutige Gebäudefläche nicht im
Browser verschnitten. Der Build lädt stattdessen die exakt zugeordneten
aktuellen FMZK-Baukörper aus dem Wiener WFS und berechnet in EPSG:31256:

`aktueller OGD-Grundriss − historischer LOD2.1-Grundriss`

Dieser Rest wird als LOD1-Prisma direkt in dieselbe Binärkachel wie das
historische LOD2.1 geschrieben. Der Client kann dadurch weiterhin den ganzen
aktuellen OGD-Baukörper unterdrücken, ohne die inzwischen hinzugekommene
Gebäudefläche zu verlieren. Die Boolesche Operation findet nur beim Build statt
und verursacht daher keine zusätzliche Last bei Darstellung oder
Schattenberechnung.

Der erste Rollout bleibt absichtlich auf die drei bekannten
`manual-pilot-hybrid`-Gebäude in der Straußengasse beschränkt. Dafür existiert
`targets.hybrid-pilot.json`; erst nach visueller Kontrolle wird die Logik auf
die 1.063 automatisch erkannten Hybrid-Kandidaten erweitert.

Der Produktionsbuild schreibt die große Diagnose-/Matchliste nach
`targets.json`. `release.json` enthält nur die für den Client benötigte
Version, Tile-Verfügbarkeit und kompakte Zähler.

Der Snapshot kann mit `make-production-targets.mjs` aus einem erneut
validierten Stadtbericht regeneriert werden. Ein Rebuild benötigt dadurch
keine erneute stadtweite Matching-Analyse.


Für jedes Produktionsziel werden außerdem die exakten aktuellen OGD-`KS_ID`s
mitgeführt. LOD2.1 darf damit nur jene heutigen FMZK-Baukörper unterdrücken,
die der Matcher diesem historischen Dach tatsächlich zugeordnet hat; eine
pauschale Ausblendung der gesamten `BW_GEB_ID` ist für LOD2.1 nicht zulässig.
