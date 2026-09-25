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
  dadurch auch nachträgliche Änderungen an älteren Einträgen. Die Views besitzen
  selbst keine belastbare Ereignis-ID; ihre Inhalte dienen daher nur als
  Änderungsdetektor und Vollständigkeitssicherung. Identische Zeilen können bei
  einer während des paginierten Abrufs wachsenden View auf zwei Seiten
  erscheinen. Sie werden für die View-Statistik dedupliziert, ihre Häufigkeit
  löst aber einen nativen Refresh aus; ob tatsächlich ein oder mehrere
  Ereignisse vorliegen, entscheidet ausschließlich die UUID-Referenzliste.

Die Änderungsströme lassen den initialen Projektkarten-Eintrag „Beobachtung
gestartet“ aus. Die normalen Detailseiten besitzen außerdem weder `ETag` noch
`Last-Modified`. Die rohen Drupal-Projektentitäten (`?_format=json`) geben jedoch
beide vollständigen, geordneten Ereignisreferenzfelder mit nativer Node-ID und
UUID aus. Der Build liest deshalb bei der initialen Migration einmal alle
Projekte über diesen JSON-Pfad – auch solche, deren alter HTML-Cache keinen
sichtbaren Verlauf enthielt. Folgebuilds aktualisieren Projekte mit
neuen oder korrigierten View-Inhalten sofort und prüfen zusätzlich die 50 am
längsten ungeprüften Projektentitäten. Der vollständige native Stand bleibt im
veröffentlichten GeoJSON als Cache erhalten. Dadurch wird der gesamte Bestand
regelmäßig erneut geprüft, ohne täglich rund 1.000 Projektentitäten anzufragen.
„Letzte Statusänderung“ allein wäre ebenfalls ungeeignet, weil Änderungen am
Projektkarten-Protokoll darin nicht vollständig abgebildet sind.

Der Projektverlauf wird als strukturierte Liste `Projektverlauf` gespeichert.
Die stabile `id` ist `drupal:<uuid>` und damit unabhängig vom redaktionell
änderbaren Inhalt. `nativeId`, `nativeUuid`, `revisionId` und
`revisionChangedAt` dokumentieren die aktuelle Drupal-Entität und Revision. Ein
separater SHA-256-`contentHash` bildet Datum, Quelle, Typ, Status, erkannte
Änderungen und Originaltext ab. Eine nachträgliche Korrektur behält somit ihre
Ereignis-ID, ändert aber Revision und `contentHash`. Mehrere Ereignisse desselben
Projekts am selben Tag bleiben über unterschiedliche native UUIDs und ihre
`reihenfolge` eindeutig. Eine Zuordnung anhand von Datum oder Text findet nicht
statt. Jedes Ereignis enthält außerdem Datum, Quelle (`bauprogramm` oder
`projektkarte`), Typ, gegebenenfalls Status sowie die einzeln erkannten
Änderungen samt originalem Text. `Aktueller Projektstatus` bezeichnet
ausdrücklich den heutigen Status; das weiterhin vorhandene Feld `Status` bleibt
aus Kompatibilitätsgründen für Filter und Styles erhalten. Der frühere
unvollständige Semikolon-String `Statusverlauf` wird bei erfolgreichen
Live-Builds nicht mehr weitergeführt. Fehlt bei einer alten Drupal-Entität das
fachliche `field_datum`, wird das native, unveränderliche Erstellungsdatum
verwendet und mit `datumQuelle: "created"` ausdrücklich gekennzeichnet; ein Datum
wird nicht aus Nachbarereignissen oder Textinhalten geraten.

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
Zehn-Prozent-Vergleich zum veröffentlichten Stand. Eine geprüfte native
Projektentität muss alle bereits gecachten nativen UUIDs und sämtliche Inhalte
des aktuellen globalen Änderungsstroms enthalten. Fehlende Ereignisse,
ungültige Referenzen sowie eine leere oder vorzeitig abgeschnittene
Protokollseite verwerfen daher den gesamten Live-Build und aktivieren den
bestehenden Last-known-good-Fallback. Beim Wechsel von Verlaufsschema 2 auf 3
werden alte inhaltsabhängige IDs nicht heuristisch zugeordnet, sondern die
betroffenen Projekte vollständig aus ihren nativen Drupal-Referenzen neu
aufgebaut.
