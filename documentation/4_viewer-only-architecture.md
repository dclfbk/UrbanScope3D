# Viewer-only architecture

## Scope

Tutta la roba pesante e' offline. Il browser solo rende e reagisce: niente
backend, niente query spaziali server-side, niente trasformazioni client. Solo
file statici (Next.js `public/` + CDN).

## Flow

```text
Source portals (Open Data + Geoportale)
        |
        v
Preprocessing offline (scripts/, vedi Issue 2)
        |
        v
web/public/data/processed/   (PMTiles + terrain-RGB + GeoJSON)
        |
        v
Browser: Next.js /explore + MapLibre + deck.gl overlay
```

Tre box, tre responsabilita':

- **portal**: catalogo + API, contattati solo al download.
- **preprocessing**: Python + CLI tool, produce gli artefatti nei formati di Issue 3.
- **browser**: legge i file statici, rende, reagisce.

Niente servizio in mezzo. La CDN e' "il backend".

## Cosa precalcoliamo

| Step | Input | Output | Dove |
|---|---|---|---|
| Download | Open Data / Geoportale | GeoJSON / GeoTIFF / CSV grezzi | `web/public/data/<n>)*` |
| Unwrap + join DBTR | 1.2 + 1.5 (+ 1.3 quando ok) | `buildings.geojson` con `h_max` | `data/` (intermedio) |
| Vector tiling | building / land use / vegetation | `*.pmtiles` | `web/public/data/processed/` |
| DTM reproject | DTM RDN32 | DTM EPSG:3857 | `data/` |
| Terrain-RGB tile | DTM riproiettato | `terrain/{z}/{x}/{y}.png` | `web/public/data/processed/terrain/` |
| **nDSM + zonal stats edifici** | DSM Leonardo (~500 .ASC) + DTM 2023 + footprint 1.1 | `buildings_heights.geojson` con `height` (p95 nDSM) | `web/public/data/processed/` (vedi [9_viewer-expansion.md](9_viewer-expansion.md#building-heights-pipeline-ndsm)) |
| **Overlay vento** | `04_Velocita_Vento.tif` | `wind_overlay.png` + `wind_overlay.json` (corners EPSG:4326) | `web/public/data/processed/` (vedi [9_viewer-expansion.md](9_viewer-expansion.md#wind-speed-overlay)) |
| Air stations join | 5.2 + registry | `air_stations.geojson` | `web/public/data/processed/` |
| Time series | 5.1 CSV | `temperature_<station>.json` | `web/public/data/processed/` |

Cose che **non** precalcoliamo:

- ombre (runtime nel renderer, vedi Issue 7),
- heatmap dai dati ambientali (rinviato),
- join attributi extra oltre quelli che entrano nelle property dei PMTiles.

## Cosa fa il client

Tre cose, basta.

**Render**: MapLibre disegna basemap, vector layer (PMTiles), terreno
(`raster-dem` da terrain-RGB). Edifici 3D = `fill-extrusion` con `h_max`.
Sole guida la luce (Issue 6), ombre da pass runtime (Issue 7).

L'extrusion 3D legge `feature.properties.height` quando disponibile (output
della pipeline nDSM, vedi [9_viewer-expansion.md](9_viewer-expansion.md#building-heights-pipeline-ndsm))
e ricade su `DEFAULT_BUILDING_HEIGHT = 15 m` per i footprint non coperti dal
DSM. L'overlay vento e' un `image` source MapLibre con i 4 angoli letti da
`processed/wind_overlay.json` (vedi [9_viewer-expansion.md](9_viewer-expansion.md#wind-speed-overlay)).

**Stile**: i layer paint/layout vivono nel codice (`web/components/Map/`).
Categorical styling (es. uso suolo) usa `match` su property gia' bakate nei
PMTiles. Tema (light/dark/satellite) = style file MapLibre swappato dall'alto.

**Interazione**: pan/zoom/pitch/bearing nativi. Pannello layer = toggle
visibility + persistenza in URL hash. Time slider muove la posizione del sole,
ricalcola luce + ombre. Click/hover = popup info dalle property dei tile.

**Probe degli asset processed**: all'avvio il viewer fa `HEAD` su
`buildings_heights.geojson` e `GET` su `wind_overlay.json`. Se gli asset
esistono attiva i relativi layer, altrimenti torna ai default (altezza
costante, nessun overlay vento) e disabilita il toggle. Cosi' il viewer e'
sempre montabile anche prima che la pipeline sia stata eseguita.

Tutto il resto e' o un job di preprocessing o fuori scope.

## Perche' questa forma

- statico ovunque: Next.js export -> qualunque CDN (GitHub Pages oggi, Vercel
  / Netlify equivalenti). `basePath` configurabile via `NEXT_PUBLIC_BASE_PATH`
  per Pages (sotto `/UrbanScope3D/`). Zero ops.
- niente costo server: l'unico codice che gira e' la tab del browser.
- riproducibile: ogni file in `web/public/data/processed/` viene da uno script
  in `scripts/`. Rigirare la pipeline rigenera il deploy.
- versionato: data version = git commit.

## Limitazioni

Lista onesta di cosa non si puo' fare cosi':

- niente dati live. Aria + temperatura sono snapshot al download. Refresh =
  ri-pipeline + redeploy.
- niente API spaziale. "Edifici entro 50m da P" si fa client-side sui tile
  visibili o si salta.
- dataset grosso = problema di RAM client. Mobile e' il collo di bottiglia,
  non la CDN.
- niente stato utente persistente lato server. Bookmark / annotation = URL
  o `localStorage`.
- compute pesante resta offline. Shadow baking annuale o viewshed sull'intero
  DTM va fatto in preprocessing e shippato statico.
- niente auth / dati privati. La CDN e' pubblica.

Per l'MVP del tirocinio sono accettabili — il prototipo e' un demonstrator su
dati pubblici, non uno strumento operativo.

## Note

- decidere se la pipeline gira in CI (su push) o solo a mano. CI tiene gli
  artefatti in sync con gli script ma allunga il build.
- decidere come si shippano gli artefatti: committare `processed/` direttamente
  oppure buildarli in CI e pusharli su un branch dati / release. Repo size
  spinge per la seconda quando entriamo nel profilo full.
- se in futuro serve un endpoint server-side (es. analytics), questo doc va
  rivisto: rompe il contratto viewer-only.
