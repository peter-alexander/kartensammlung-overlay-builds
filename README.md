# kartensammlung-overlay-builds

Build- und Deploy-Repository für drei Overlays der Kartensammlung:

- `rge-analyse`
- `radparken`
- `sitzmoeglichkeiten`

Der Workflow baut die Layer nachts automatisch und kann zusätzlich manuell gestartet werden.

## Voraussetzungen lokal

- Node.js 22
- `tippecanoe` im `PATH` oder via `TIPPECANOE_BIN`

Dann:

```bash
npm install
```

## GitHub Actions

Der Workflow liegt unter `.github/workflows/build.yml` und bietet:

- nächtlichen Lauf
- manuellen Start
- Auswahl einzelner Layer
- Legacy-Ausgabe für die alte Production (`geojson` bei RgE, `tiles/` bei Radparken und Sitzmöglichkeiten)

## Benötigte Secrets

Diese Repository-Secrets müssen gesetzt werden:

- `EASYNAME_FTP_HOST`
- `EASYNAME_FTP_USER`
- `EASYNAME_FTP_PASSWORD`

Optional als Repository-Variable:

- `EASYNAME_REMOTE_ROOT`

Wenn `EASYNAME_REMOTE_ROOT` leer bleibt, wird direkt relativ zum FTP-Root deployt.

## Remote-Ziele

Der Workflow deployed standardmäßig nach:

- `RgE-Analyse/`
- `Radparken/`
- `Sitzmoeglichkeiten/`

## Manuelle Läufe

Im manuellen Start kannst du wählen:

- alle Layer oder nur einen einzelnen Layer
- Legacy-Ausgaben ein oder aus

## Hinweise

- `rge-analyse/build.mjs` stammt direkt aus deinem bisherigen Build.
- `radparken/build.mjs` stammt direkt aus deinem bisherigen Build; `radparken/run.sh` übernimmt Download, Build und Tippecanoe.
- `sitzmoeglichkeiten/src/...` stammt aus `src.zip`; `runSingleExtent.mjs` wurde nur minimal so angepasst, dass Output-Ordner und Tippecanoe-Binary per Umgebungsvariablen gesteuert werden können.
