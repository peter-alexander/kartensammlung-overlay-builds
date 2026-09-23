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
- 614 konservative `hybrid-a`-Gebäude,
- 72 `hybrid-b-absolute`-Gebäude,
- 1 manuell bestätigte `manual-pilot-strong`-Ausnahme (TU Wien),
- 1 manuell bestätigte `manual-pilot-hybrid`-Ausnahme (Straußengasse 14),
- insgesamt 1.897 Gebäude auf 684 benötigten LOD2.1-Quellblättern.

Von den ursprünglich 1.063 sicheren `legacy-subset`-Kandidaten sind damit
686 automatisch freigegeben. **377 bleiben weiterhin zurückgestellt**; bei
ihnen ist die historische/heutige Grundrissabweichung oder eine andere
Plausibilitätsmetrik für den derzeitigen konservativen Rollout zu groß.

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


## Hybrid-Restflächen

Für `legacy-subset`-Fälle wird das aktuelle OGD-Feature weiterhin vollständig
durch die exakten `KS_ID`-Filter aus dem nativen/solaren LOD1-Fallback
entfernt. Damit heutige Anbauten nicht verloren gehen, erzeugt der
LOD2.1-Build zusätzlich ein synthetisches LOD1-Restmesh:

1. historische LOD2.1-`GroundSurface`-Polygone je historischem Code
   vereinigen,
2. diesen historischen Grundriss **ohne Render-Puffer (0 m)** von jedem heute
   zugehörigen FMZK-Polygon **einzeln** abziehen,
3. Differenzteile mit höchstens **5 cm mittlerer geometrischer Dicke**
   (`2 × Fläche / Umfang`) als numerische Sliver verwerfen,
4. jede verbleibende Restfläche mit den aktuellen
   `O_KOTE/T_KOTE/HOEHE_DGM/U_KOTE`-Werten genau dieses FMZK-Teils als
   flaches LOD1 extrudieren,
5. historisches LOD2.1 und aktuelle Restmeshes gemeinsam im bestehenden
   `KSL21B01`-Format speichern.

Die Behandlung pro FMZK-Teil ist wichtig, weil ein heutiges Gebäude mehrere
Baukörper mit stark unterschiedlichen Höhen enthalten kann.

Der Straußengasse-Pilot bestätigt, dass die Restflächen reale Änderungen und
keine Vermessungssäume sind:

- `009238`: 234,62 m² Restfläche (33,09 %),
- `113842`: 216,85 m² (30,14 %),
- `212535`: 529,54 m² (20,10 %).

Die Nahtprobe mit -0,05 / 0 / +0,05 / +0,25 m zeigt: bei **0 m** entstehen
an den drei Pilotgebäuden nur numerische Mikro-Komponenten von zusammen
0,005 / 0,033 / 0,077 m²; ihre maximale mittlere Dicke liegt bei nur
0,2 / 3,0 / 2,4 mm. +0,25 m bleibt daher nur eine Diagnosevariante, nicht die
Render-Geometrie.

Eine stadtweite Auditprobe zeigte zugleich, dass eine reine 2-m²-Flächengrenze
zu grob wäre: reale kompakte Restteile von etwa 1–2 m² erreichen 15–54 cm
mittlere Dicke. Deshalb wird nach **Dünnheit statt Fläche** gefiltert.


## Hybrid-A Rollout

Für den ersten automatischen Hybrid-Rollout gilt eine strengere Teilmenge der
`legacy-subset`-Klasse:

- historischer Grundriss zu mindestens 99,9 % im heutigen Grundriss,
- heutige Überdeckung mindestens 60 %,
- Schwerpunktversatz höchstens 6 m,
- Höhenabweichung höchstens `max(6 m, 30 %)`.

Damit ergeben sich **614 Hybrid-A-Kandidaten**. Davon haben 605 nach den
stadtweiten Matchmetriken mindestens 2 m² erwartete heutige Restfläche.

In einem ersten Test mit der alten 2-m²-Flächengrenze erzeugten 9 Kandidaten
kein Restmesh. Der nachfolgende Form-Audit zeigte jedoch, dass Fläche allein
kein geeignetes Sliver-Kriterium ist. Die Produktionsregel verwendet deshalb
stattdessen die oben beschriebene 5-cm-Dünnheitsgrenze; auch kompakte
Restflächen unter 2 m² bleiben damit erhalten.


## Hybrid-B absolute

Die relative 99,9-%-Grenze von Hybrid-A ist für kleine Gebäude unnötig streng:
Ein geometrisch sehr kleiner historischer Überstand kann dort relativ stärker
ins Gewicht fallen. Gleichzeitig enthält der bereits validierte Hybrid-A-Satz
selbst historische Überstände bis **0,58 m²** außerhalb des heutigen
Grundrisses.

`hybrid-b-absolute` erweitert den Rollout deshalb nur um Kandidaten, die
weiterhin die Hybrid-A-Regeln für heutige Überdeckung, Schwerpunkt und Höhe
erfüllen und zusätzlich:

- mindestens 99,5 % historische Überdeckung erreichen,
- höchstens **0,58 m²** historischen Grundriss außerhalb des heutigen
  Grundrisses besitzen,
- nicht bereits Hybrid-A sind.

Die stadtweite Analyse liefert damit 72 zusätzliche Gebäude. Im erzeugten
Produktionssnapshot beträgt der tatsächliche größte historische Überstand
**0,56 m²**. Damit akzeptiert diese Klasse absolut keine größere
Grundrissabweichung als im bereits produktiv getesteten Hybrid-A-Satz.

Ein isolierter Build aller 72 Gebäude wurde vor dem Produktionsrollout mit
denselben exakten FMZK-Geometrien, Restmesh-Regeln und
5-cm-Sliver-Prüfungen validiert.
