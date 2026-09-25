# Radnetz-Dashboard-Build

Der Build verwendet bewusst nicht die instabilen CSV-/GeoJSON-Export-Displays des
Radnetz-Dashboards. Stattdessen liest er dieselben serverseitig gerenderten Views,
die auch die öffentliche Website verwendet:

- `/bauprogramm/karte` liefert die vollständige Bauprogramm-Übersicht; die
  tatsächlichen historischen Styles kommen aus den eingebetteten Karten der
  offiziellen Jahresseiten `/bauprogramm/{year}`.
- `/bauprogramm/karte?type=3` liefert die vollständige Karte der weiteren
  Bauprojekte. Deren offizielle Jahresansichten werden mit `type=3&jahr={year}`
  abgerufen. Projekte ohne Jahr bleiben aus der Übersicht erhalten.
- `/bauprojekte?type=2` und `?type=3` liefern die paginierten Tabellen mit den
  aktuellen Projektattributen.
- `/statuses.json` ergänzt die Statusdefinitionen; die konkrete Farbe jedes
  kartierbaren Projekts kommt zusätzlich direkt aus der Kartenansicht.
- `/bauprogramm/status-aenderungen` und
  `/projektkarte/status-aenderungen` liefern die beiden paginierten
  Änderungsströme. Sie werden bei jedem Build komplett gelesen. Das sind derzeit
  rund 61 View-Seiten statt mehr als 1.000 einzelner Projektseiten und erfasst
  dadurch auch nachträgliche Änderungen an älteren Einträgen.

Die Änderungsströme lassen den initialen Projektkarten-Eintrag „Beobachtung
gestartet“ aus. Für einen wirklich vollständigen Verlauf liest der Initialimport
deshalb einmal alle Projekt-Detailseiten. Dieser vollständige Stand bleibt im
veröffentlichten GeoJSON als Cache erhalten. Folgebuilds lesen Detailseiten nur
für neue Projekte sowie als rotierende Stichprobe von 50 Projekten; damit wird
der gesamte Bestand regelmäßig erneut geprüft, ohne täglich rund 1.000
Detailseiten anzufragen. `ETag` und `Last-Modified` stehen an diesen Drupal-Seiten
nicht zur Verfügung, und „Letzte Statusänderung“ deckt Änderungen am
Projektkarten-Protokoll nicht ab; beide eignen sich daher nicht als alleiniger
Invalidierungsmechanismus.

Der Projektverlauf wird als strukturierte Liste `Projektverlauf` gespeichert.
Jedes Ereignis enthält Datum, Quelle (`bauprogramm` oder `projektkarte`), Typ,
gegebenenfalls Status sowie die einzeln erkannten Änderungen samt originalem
Text. `Aktueller Projektstatus` bezeichnet ausdrücklich den heutigen Status;
das weiterhin vorhandene Feld `Status` bleibt aus Kompatibilitätsgründen für
Filter und Styles erhalten. Der frühere unvollständige Semikolon-String
`Statusverlauf` wird bei erfolgreichen Live-Builds nicht mehr weitergeführt.

Vor dem Live-Abruf wird der veröffentlichte Stand von
`https://fahrrad.lima-city.de/Maps/RadnetzDashboard.geojson` validiert und zur
Anreicherung optionaler Felder eingelesen. Falls eine Live-View vorübergehend
nicht erreichbar oder unplausibel unvollständig ist, erzeugt der Build keinen
leeren Datensatz, sondern behält diesen letzten gültigen Produktionsstand mit
einer deutlichen `metadata.warning` bei.

Der Live-Build akzeptiert mindestens 1.000 Projekte und 1.000 kartierbare
Geometrien. Ein Rückgang um mehr als zehn Prozent gegenüber dem veröffentlichten
Stand löst ebenfalls den Fallback aus. Für jede Protokollquelle gelten zusätzlich
eine Mindestzahl an View-Ereignissen und nach dem Initialimport derselbe
Zehn-Prozent-Vergleich zum veröffentlichten Stand. Die jeweils geprüften
Detailseiten müssen außerdem mindestens alle Ereignisse enthalten, die in den
globalen Änderungsströmen für das Projekt vorkommen. Eine leere oder vorzeitig
abgeschnittene Protokollseite beziehungsweise eine unvollständige Detailseite
verwirft daher den gesamten Live-Build und aktiviert den bestehenden
Last-known-good-Fallback.
