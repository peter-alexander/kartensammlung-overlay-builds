# Radnetz-Dashboard-Build

Der Build verwendet bewusst nicht die instabilen CSV-/GeoJSON-Export-Displays des
Radnetz-Dashboards. Stattdessen liest er dieselben serverseitig gerenderten Views,
die auch die öffentliche Website verwendet:

- `/bauprogramm/karte?type=2` und `?type=3` liefern die Leaflet-Geometrien sowie
  stabile Drupal-Node-IDs in `drupalSettings`.
- `/bauprojekte?type=2` und `?type=3` liefern die paginierten Tabellen mit den
  aktuellen Projektattributen.
- `/statuses.json` ergänzt die Statusdefinitionen; die konkrete Farbe jedes
  kartierbaren Projekts kommt zusätzlich direkt aus der Kartenansicht.

Vor dem Live-Abruf wird der veröffentlichte Stand von
`https://fahrrad.lima-city.de/Maps/RadnetzDashboard.geojson` validiert und zur
Anreicherung optionaler Felder eingelesen. Falls eine Live-View vorübergehend
nicht erreichbar oder unplausibel unvollständig ist, erzeugt der Build keinen
leeren Datensatz, sondern behält diesen letzten gültigen Produktionsstand mit
einer deutlichen `metadata.warning` bei.

Der Live-Build akzeptiert mindestens 1.000 Projekte und 1.000 kartierbare
Geometrien. Ein Rückgang um mehr als zehn Prozent gegenüber dem veröffentlichten
Stand löst ebenfalls den Fallback aus.
