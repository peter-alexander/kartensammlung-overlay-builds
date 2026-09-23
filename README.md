# kartensammlung-overlay-builds

Build- und Deploy-Repository für Kartensammlung-Overlays:

- `RgE-Analyse aktuell`
- `Radparken aktuell`
- `Potenzialkarte Sitzmöglichkeiten`
- `Radlkarte`
- `Zeitzonen`

- `GHSL` (SMOD + AGE als browserfähige COGs)

## Lima-City-Produktionsverzeichnis

Die Build-Ausgaben unter `/default-website/Maps` liegen in einem **gemeinsam genutzten Produktionsverzeichnis**. Dieses Repository besitzt das Verzeichnis nicht exklusiv.

Deployments dürfen deshalb nur ausdrücklich verwaltete Dateien bzw. Unterverzeichnisse aktualisieren. Es gibt **kein** `mirror --delete`, kein rekursives Leeren und kein Neuaufsetzen von `/default-website/Maps`. Unbekannte oder von anderen Teilen der Kartensammlung verwendete Inhalte bleiben unangetastet. Die verbindlichen Regeln stehen in `AGENTS.md`.

Insbesondere `GeoJSON-Proxy/` gehört derzeit zur laufenden OpenLayers-Production und darf von den Build-Workflows dieses Repositories nicht verändert oder gelöscht werden.
