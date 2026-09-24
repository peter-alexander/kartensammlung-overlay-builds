# Wien LOD2.1 Fallback

Das Wiener LOD2.1 dient primär als **sekundärer Dach-Fallback** für Gebäude,
für die das aktuelle Maptoolkit/Stadtplan-LOD2 vollständig fehlt. Zusätzlich
dürfen wenige streng auditierte Fälle ein nachweislich verlorenes geneigtes
Maptoolkit-Dach ersetzen.

Priorität:

1. aktuelles Maptoolkit/Stadtplan-LOD2
2. für explizit auditierte Dachverlust-Fälle: geprüftes Wiener LOD2.1 statt
   des exakt identifizierten fehlerhaften Maptoolkit-Features
3. geprüftes Wiener LOD2.1 als Fallback bei vollständig fehlendem Maptoolkit
4. aktuelles OGD-Baukörpermodell LOD1

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
- 3 geometrisch auditierte `hybrid-b-thin`-Gebäude,
- 7 geometrisch geclippte `hybrid-b-clip`-Gebäude,
- 169 vollständig auditierte `hybrid-c-clip`-Gebäude,
- 169 vollständig auditierte `hybrid-d-clip`-Gebäude,
- 26 traufhöhen-korrigierte `hybrid-eave-clip`-Gebäude,
- 2 höhensensitiv geteilte `hybrid-height-split`-Gebäude,
- 22 streng auditierte `maptoolkit-roof-replacement`-Gebäude,
- 1 manuell bestätigte `manual-pilot-strong`-Ausnahme (TU Wien),
- 1 manuell bestätigte `manual-pilot-hybrid`-Ausnahme (Straußengasse 14),
- insgesamt 2.295 Gebäude.

Von den ursprünglich 1.063 sicheren `legacy-subset`-Kandidaten sind damit
**1.062 automatisch freigegeben**. Der einzige nicht automatisch ausgewählte
Kandidat ist `113842` (Straußengasse 14), der bereits als manuell bestätigte
Hybrid-Ausnahme produktiv ist. Damit sind alle 1.063 sicheren
`legacy-subset`-Kandidaten im Produktionsmodell vertreten.

## Maptoolkit-Dachersatz

Die 22 `maptoolkit-roof-replacement`-Fälle sind **kein allgemeiner Vorrang
historischer Daten vor Maptoolkit**. Sie wurden zusätzlich zur
Grundriss-/Identitätsprüfung direkt gegen die aktuell ausgelieferten
`buildings3d`-Flächen geprüft.

Produktiv aufgenommen werden nur Fälle, bei denen:

- die historischen geneigten Dachflächen live ausschließlich flache
  Maptoolkit-Dachflächen treffen und keine geneigte Maptoolkit-Dachfläche,
- 100 % der verwendeten historischen Dach-Samples von diesen flachen
  Maptoolkit-Flächen getroffen werden,
- die aktuelle flache Maptoolkit-Höhe innerhalb des historischen
  Dachhöhenbereichs mit 25 cm Toleranz liegt,
- die betroffenen Maptoolkit-Features ausschließlich zur geprüften
  `BW_GEB_ID` gehören,
- alle zu ersetzenden Features und das LOD2.1-Ersatzobjekt in derselben
  Z15-Kachel liegen.

Die Datei `maptoolkit-roof-overrides.production.json` hält diese auditierte
Auswahl und die erwarteten Geometrie-Fingerprints fest. Im Client wird ein
Ersatz **fail-closed** aktiviert: Nur wenn das gültige LOD2.1-Ersatzobjekt im
gleichen Tile geladen ist und alle erwarteten Maptoolkit-Feature-Fingerprints
eindeutig vorhanden sind, werden genau diese Maptoolkit-Features entfernt und
das historische Dach eingeblendet. Ändert Maptoolkit die Geometrie oder ist
ein Fingerprint nicht eindeutig, bleibt das aktuelle Maptoolkit-Modell
unverändert sichtbar.

Die zweite auditierte Welle ergänzt die Codes `143213`, `200497` und `503621`. Alle drei erfüllen dieselben Surface-, Höhen-, Eigentums- und Single-Tile-Kriterien wie die erste Welle.

Der Produktionsbuild schreibt die große Diagnose-/Matchliste nach
`targets.json`. `release.json` enthält neben Version, Tile-Verfügbarkeit
und kompakten Zählern auch die kleine fail-safe Fingerprint-Liste für diese
Dachersatz-Fälle.

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


## Hybrid-B thin

Nach dem absoluten Hybrid-B-Rollout blieben zehn Kandidaten der ursprünglichen
Hybrid-B-Klasse übrig. Für sie wurde die historische Fläche außerhalb des
heutigen OGD-Grundrisses komponentenweise nach Fläche, Umfang und mittlerer
Dicke (`2 × Fläche / Umfang`) geprüft.

Drei Fälle bestehen ausschließlich aus dünnen geometrischen Säumen:

- `123321`: maximale mittlere Dicke 3,12 cm,
- `079387`: 3,30 cm,
- `088019`: 3,06 cm.

Sie liegen damit unter derselben **5-cm-Dünnheitsgrenze**, die bereits beim
Hybrid-Restmesh zum Verwerfen numerischer Sliver verwendet wird. Zusätzlich
erfüllen alle drei weiterhin die Hybrid-B-Regeln für Überdeckung, Schwerpunkt
und Höhe. Sie werden als `hybrid-b-thin` geführt.

Die übrigen sieben Hybrid-B-Fälle erreichen historische Außenkomponenten von
etwa 11 bis 66 cm mittlerer Dicke. Sie werden deshalb nicht über eine weitere
Toleranzregel freigegeben, sondern mit einem echten 3D-Clipping behandelt.


## Hybrid-B clip

Für die sieben verbliebenen Hybrid-B-Fälle reicht keine numerische
Toleranzregel mehr aus. Das historische LOD2.1 wird deshalb auf den heute
gültigen OGD-Grundriss geclippt.

Das Clipping arbeitet ohne vollständiges 3D-CSG:

1. historische GroundSurfaces aller CityGML-Objekte eines Codes vereinigen,
2. diesen historischen Grundriss mit der heutigen exakten FMZK-Geometrie
   schneiden,
3. jede historische Dachfläche in XY mit ihrem Objekt-Grundriss schneiden,
4. die Z-Werte neu entstandener Dachpunkte aus der ursprünglichen Dach-Ebene
   rekonstruieren,
5. entlang des tatsächlichen äußeren Zielrandes neue vertikale Wände vom
   historischen Basisniveau bis zur jeweiligen Dachkante erzeugen,
6. die heutige zusätzliche Gebäudefläche weiterhin als bestehendes
   Hybrid-LOD1-Restmesh ergänzen.

Freigegeben sind vorerst ausschließlich die sieben vollständig auditierten
Codes:

`011758`, `032459`, `045503`, `047031`, `061091`, `065479`,
`088729`.

Die Validierung prüft dabei nicht nur Summenlängen, sondern geometrisch:

- entfernte historische Fläche gegen die Matchanalyse (±0,05 m²),
- projizierte Dachabdeckung mindestens 99,5 %,
- Außenrand innerhalb eines 5-cm-Puffers der erzeugten Wände mindestens
  99,9 %,
- höchstens 1 cm tatsächlich unabgedeckte Randlänge,
- weiterhin vorhandene aktuelle Hybrid-Restmeshes.

Der gemeinsame Sieben-Fall-Test erreicht für alle sieben Codes praktisch
vollständige Dachabdeckung und **0,000 m unabgedeckten Außenrand** innerhalb
der 5-cm-Toleranz. Entfernt werden je nach Gebäude 1,326 bis 3,838 m²
historischer Überstand.


## Hybrid-C clip

Nach dem vollständigen Hybrid-B-Rollout verbleiben 169 Kandidaten der
ursprünglichen `hybrid-c`-Klasse. Sie erfüllen weiterhin:

- mindestens 60 % heutige Überdeckung,
- Schwerpunktabstand höchstens 8 m,
- Höhenabweichung höchstens `max(6 m, 30 %)`,

haben aber nur 98,0 bis 99,5 % historische Überdeckung. Eine bloße
Toleranzregel ist dafür nicht sinnvoll; deshalb wird auch diese Klasse mit
dem geschlossenen historischen 3D-Clipping behandelt.

Vor dem Produktionsrollout wurden **alle 169 Gebäude gemeinsam** gebaut und
mit denselben strengen geometrischen Kriterien wie Hybrid-B clip geprüft:

- entfernte historische Fläche gegen die Stadtanalyse (±0,05 m²),
- projizierte Dachabdeckung mindestens 99,5 %,
- geometrische Außenrandabdeckung durch Wände mindestens 99,9 %,
- höchstens 1 cm tatsächlich unabgedeckte Randlänge,
- weiterhin vorhandene aktuelle LOD1-Restmeshes.

Ein Sonderfall (`124241`) zeigte zwei durch die Overlay-Operation erzeugte
numerische Innenlöcher. Sie hatten zusammen nur 0,000888 m² Fläche und
maximal 0,143 mm mittlere Dicke. Solche Innenringe werden nun nach derselben
5-cm-Dünnheitsregel wie andere numerische Hybrid-Sliver geschlossen. Echte
Innenhöfe bleiben erhalten.

Mit dieser Bereinigung bestehen **169 von 169 Hybrid-C-Kandidaten** den
vollständigen Clipping-Audit.


## Hybrid-D clip

Nach Hybrid-C verbleiben 169 Kandidaten, die ausschließlich an der bisherigen
98-%-Grenze für die historische Grundrissüberdeckung scheitern. Alle erfüllen
weiterhin die übrigen automatischen Plausibilitätsregeln:

- historische Überdeckung mindestens 95,0 %,
- heutige Überdeckung mindestens 60 %,
- Schwerpunktabstand höchstens 8 m,
- Höhenabweichung höchstens `max(6 m, 30 %)`.

Da das historische 3D-Modell ohnehin auf den heutigen exakten OGD-Grundriss
geclippt wird, wurde die gesamte Gruppe gemeinsam getestet, statt die
Prozentgrenze weiter als reine Toleranzregel zu interpretieren.

Ein erster Test zeigte dabei eine JSTS-`GeometryCollection` aus einem
Polygon plus flächenlosen Linien-/Punktresten. Clip-Intersections werden
deshalb vor der weiteren Verarbeitung explizit auf ihre polygonalen
Bestandteile normalisiert. Flächenlose Overlay-Reste beeinflussen damit weder
Grundfläche noch Wandableitung.

Der vollständige Test aller 169 Hybrid-D-Kandidaten ergibt:

- **169/169 bestanden**,
- minimale projizierte Dachabdeckung: **99,9988 %**,
- geometrische Wandabdeckung: **100 % bei allen Gebäuden**,
- unabgedeckter Außenrand: **0,000 m bei allen Gebäuden**,
- historisch entfernte Fläche: 0,595 bis 50,294 m²,
- numerische Innenloch-Bereinigung bei 21 Gebäuden; maximale mittlere Dicke
  nur 0,389 mm.

Damit wird die gesamte geometrisch validierte 95–98-%-Gruppe als
`hybrid-d-clip` produktiv übernommen. Anschließend verbleiben 29 Kandidaten,
bei denen nicht die Grundrissgeometrie, sondern die Höhenplausibilität die
automatische Freigabe verhindert.


## Hybrid eave clip

Nach Hybrid-D verbleiben 29 Kandidaten ausschließlich wegen der bisherigen
Höhenprüfung. Diese Prüfung verglich jedoch zwei unterschiedliche Größen:

- aktuell: `O_KOTE - T_KOTE`, also die Höhe bis zur **Dachtraufe**,
- historisch: höchster `RoofSurface`-Punkt minus Boden, also bei geneigten
  Dächern die Höhe bis zum **First**.

Für diese 29 Fälle wurde deshalb eine separate Traufhöhenanalyse durchgeführt.
Als robuste historische Vergleichsgröße wird pro CityGML-Objekt der Median der
jeweiligen Mindest-Z-Werte aller `RoofSurface`-Flächen verwendet; bei mehreren
Objekten eines historischen Codes wird – analog zu den aktuellen FMZK-Teilen –
der höchste Objektwert herangezogen.

Die Datei `eave-height-analysis.generated.json` dokumentiert mehrere
verglichene Schätzer. Der Median der RoofSurface-Minima liefert:

- 26 von 29 Fällen innerhalb der bestehenden Produktionsgrenze
  `max(6 m, 30 %)`,
- mediane Abweichung zur aktuellen Traufenhöhe: **1,645 m**,
- nur drei weiterhin klar abweichende Fälle:
  `029048`, `074864` und `113842`.

Alle 26 erklärbaren Fälle wurden anschließend mit demselben geschlossenen
historischen 3D-Clipping wie Hybrid-C/D isoliert gebaut und geprüft. Der
26er-Test besteht vollständig.

Sie werden daher als `hybrid-eave-clip` geführt. Im Produktionssnapshot
werden zusätzlich die auditierte historische Traufenhöhe, deren Abweichung
zur aktuellen Traufe und die verwendete Toleranz gespeichert.

Die drei verbleibenden Fälle werden **nicht** automatisch über die neue
Höhenmetrik freigegeben: Bei ihnen ist sogar der historische First niedriger
als die heutige Traufe. Eine zusätzliche FMZK-Teilflächenanalyse ist in
`height-part-analysis.generated.json` dokumentiert:

- `029048`: Der aktuelle 14,621-m-Teilbaukörper überlappt den historischen
  Grundriss zu **95,65 %**; der historische First liegt nur bei 7,50 m.
  Das ist damit eine echte Höhenänderung innerhalb des historischen
  Baukörpers, nicht bloß ein neuer Anbau außerhalb des alten Grundrisses.
- `074864`: Eine aktuelle, 19,119 m hohe FMZK-Teilfläche von 7,492 m² liegt
  **vollständig** innerhalb des historischen Grundrisses. Der historische
  First liegt nur bei 12,634 m. Ein reines XY-Clipping würde diesen heutigen
  hohen Teil daher fälschlich durch das alte Dach ersetzen.
- `113842`: Der heutige Bestand ist ein Mischfall mit 14,17-m- und
  21,428-m-Teilflächen; die 21,428-m-Fläche überlappt den historischen
  Grundriss teilweise. Dieser Code bleibt ausschließlich wegen der bereits
  manuell bestätigten Straußengasse-Ausnahme produktiv.

Für `029048` und `074864` wurde anschließend genau dieses
**höhensensitive Teilflächen-Clipping** implementiert und isoliert getestet.
Das historische Dach wird nicht mehr gegen den gesamten aktuellen Grundriss
geschnitten. Stattdessen wird für jeden heutigen FMZK-Teil die lokal darüber
liegende maximale historische Dachhöhe bestimmt.

Ein heutiger FMZK-Teil bleibt vollständig als aktuelles LOD1 erhalten, wenn
seine `O_KOTE` mehr als **25 cm** über dem höchsten historischen Dachpunkt
in seiner eigenen Überlappungsfläche liegt. Teile ohne historische
Dachüberdeckung bleiben ebenfalls aktuell. Nur die übrigen kompatiblen
Teilflächen werden für das historische LOD2.1 freigegeben.

Der Zwei-Gebäude-Pilot ergibt:

- `029048`: 3 kompatible und 1 geschützter aktueller Teil;
  174,909 m² historisches LOD2.1 bleiben erhalten, 337,305 m² werden als
  aktuelles LOD1-Restmesh aufgebaut. Der 14,621-m-Baukörper
  `4006403822` bleibt vollständig aktuell; seine `O_KOTE` liegt lokal
  **7,04 m** über dem historischen Dach.
- `074864`: 1 kompatibler und 6 geschützte aktuelle Teile;
  116,769 m² historisches LOD2.1 bleiben erhalten, 160,136 m² werden als
  aktuelles LOD1-Restmesh aufgebaut. Unter anderem bleibt der 19,119-m-Teil
  `4005973513` vollständig aktuell; seine `O_KOTE` liegt lokal
  **6,68 m** über dem historischen Dach.

Für diese Sonderklasse werden an den internen Schnittkanten sowohl die
historische Clip-Wand als auch die aktuelle LOD1-Wand erzeugt. Dadurch bleibt
der zusammengesetzte Baukörper unabhängig davon geschlossen, welches der
beiden Dächer lokal höher liegt; der doppelte Wandbereich befindet sich im
Inneren des zusammengesetzten Volumens.

Der isolierte Test erreicht bei beiden Gebäuden **100 % projizierte
Dachabdeckung, 100 % historische Wandabdeckung und 0,000 m unabgedeckten
historischen Rand**. Die produktive Klasse `hybrid-height-split` ist
absichtlich auf genau diese beiden vollständig auditierten Codes begrenzt.
