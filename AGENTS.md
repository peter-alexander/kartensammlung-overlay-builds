# AGENTS.md

## Produktions- und Deployment-Regeln

`/default-website/Maps` auf Lima City ist ein **gemeinsam genutztes Produktionsverzeichnis**. Es gehört keinem einzelnen Repository und enthält Daten mehrerer Generationen und Dienste der Kartensammlung.

Für jede Änderung, jeden Workflow und jedes Deploy-Skript gelten deshalb zwingend folgende Regeln:

- **Kein Mirror-/Sync-Deploy mit Löschsemantik.** Insbesondere niemals `mirror --delete`, `rsync --delete`, `lftp mirror --delete` oder eine vergleichbare Funktion gegen `/default-website/Maps` verwenden.
- **Das Verzeichnis niemals leeren, löschen oder neu aufsetzen.** Kein rekursives Löschen und kein „clean deploy“ des gesamten Verzeichnisses.
- **Nur ausdrücklich verwaltete Ziele verändern.** Ein Workflow darf ausschließlich die konkreten Dateien oder Unterverzeichnisse hochladen/ersetzen, die ihm explizit zugeordnet sind.
- **Unbekannte oder fremde Inhalte immer erhalten.** Vorhandene Dateien und Unterverzeichnisse dürfen nicht als veraltet angesehen werden, nur weil sie nicht in diesem Repository vorkommen.
- **Löschen nur gezielt und bewusst.** Falls eine von uns verwaltete Datei entfernt werden soll, muss das als eigener, ausdrücklich geprüfter Schritt erfolgen; niemals als Nebenwirkung eines Syncs.
- `MAIN_REMOTE_ROOT` zeigt für diese Daten auf `/default-website/Maps`.
- Bevor ein neues Deploy-Verfahren eingeführt oder ein bestehendes verallgemeinert wird, muss geprüft werden, ob es diese Shared-Directory-Regel verletzt.

Aktuell besonders wichtig: `GeoJSON-Proxy/` wird noch von der OpenLayers-Production verwendet und darf von neueren Build-/Maintenance-Workflows nicht verändert oder entfernt werden.

Wenn ein Repository Daten nach `/default-website/Maps` deployt, ist ein **gezielter Einzeldatei-Upload bzw. ein gezielter Upload in ein ausdrücklich verwaltetes Unterverzeichnis** der Standard.
