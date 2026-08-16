# UrbanScope3D

Viewer 3D urbano di Bologna (zona pilota TALEA) per esplorare edifici, verde e
microclima ENVI-met. È il progetto di **tirocinio (FBK Digital Commons Lab) +
tesi**: la tesi verrà scritta SU questo lavoro, quindi anche gli artefatti
superati (PNG precotte, derivati intermedi, tentativi documentati) sono
materiale da conservare, non spazzatura da pulire. Tutto gira nel browser:
Next.js static export + MapLibre GL + deck.gl interleaved, **nessun backend**
— i dati sono file statici serviti da GitHub Pages; da agosto 2026 i GeoTIFF
ENVI-met vengono decodificati direttamente nel browser (`web/lib/envimetTif.ts`
+ Web Worker), niente più overlay PNG precotti.

## Mappa del repo

| Path | Cosa contiene |
|---|---|
| `web/` | L'app Next.js (unico codice applicativo). Vedi `web/CLAUDE.md`. |
| `scripts/` | Pipeline Python/shell offline che prepara i dati (una tantum). |
| `docs/` | **NON è documentazione**: è il build statico che GitHub Pages serve (`main` → `/docs`). Va rigenerato a mano. |
| `documentation/` | La documentazione vera: note numerate 1→14 (design, dati, procedure). |
| `issues/` | Le tappe di lavoro storiche (Issue1-10). |
| `data/` | Output intermedio della pipeline, **gitignorato**. |
| `TODO.md` | Lista operativa dalla call col professore, da tenere aggiornata. |

## Comandi

```bash
cd web && npm run dev          # dev server su http://localhost:3000
npx tsc --noEmit               # typecheck (non esiste script npm dedicato)
npm run lint                   # eslint
NEXT_PUBLIC_BASE_PATH=/UrbanScope3D npm run build   # build di produzione -> web/out/
```

Pubblicare = copiare il contenuto di `web/out/` in `docs/` (compreso
`.nojekyll`, senza il quale Pages scarta `_next/`) e committare su `main`.
Il workflow `.github/workflows/pages.yml` è solo un CI check, NON fa deploy.
URL pubblico: https://dclfbk.github.io/UrbanScope3D/

## Trappole note

- **basePath**: online il sito vive sotto `/UrbanScope3D/`. Ogni URL statico
  deve passare da `withBase()` (`web/lib/basePath.ts`), altrimenti 404 solo in
  produzione.
- **Dati pesanti fuori da git**: DBTR >100 MB, shapefile uso suolo, DSM
  Leonardo e parte dei GeoTIFF ENVI-met sono gitignorati. Si recuperano con
  `python scripts/download_missing_data.py` o dal drive del professore. Un
  clone fresco ha quindi cartelle dati incomplete: è normale.
- **`web/public/` finisce TUTTO in `out/`**: se aggiungi dati grezzi lì, valuta
  l'ignore anche per il corrispondente `docs/data/…` (senza, `docs/` esplode).
- **Terreno same-origin**: i tile DEM devono stare sulla stessa origine
  (l'endpoint pubblico AWS non manda CORS → terreno piatto, edifici sospesi).
  Vedi commento in `MapViewer.tsx` su `TERRAIN_TILES_URL`.
- **Griglia ENVI-met**: 253×273 celle da 3 m, 54 bande = quote z (0.3→148.5 m,
  telescopiche, quota reale nel tag GDAL `z_m`), export **south-up** (serve
  flipud), nodata −9999, **nessun CRS** (georeferenziazione dal file
  `04_Velocita_Vento.tif`, EPSG:32632 con dominio ruotato).
- **I dati microclima sono una fotografia**: simulazione del 27/07/2024 ore
  11:00, un solo timestep. Lo slider cambia la QUOTA, non l'ora.
- **Tif online = solo i 12 `shipped: true`** del registry
  (`web/lib/envimetRegistry.ts`, ~119 MB whitelistati in `.gitignore` sotto
  `docs/data/Envimet_data/`); gli altri 26 funzionano solo in locale (il
  toggle online mostra errore). Per pubblicarne uno nuovo: flag nel registry
  + riga di whitelist.
- **NON eliminare `web/public/data/processed/envimet/` (PNG + overlays.json)**:
  il sito non li usa più, ma sono materiale per la tesi (pipeline documentata
  nelle note 11-12). Idem `wind_uv.values.json` (ora gitignorato).
- **`web/lib/windgl/` è MPL-2.0** (derivato da WeatherLayers GL): mantenere
  header di attribuzione ed elenco modifiche.
- **`web/README.md` è il boilerplate di create-next-app**: ignorarlo.

## Stile del codice

- Commenti in **italiano** (spiegano il perché, spesso con blocco doc in cima
  al file); identificatori e tipi in inglese.
- Niente punto e virgola, quote singole, ~80-90 colonne. **Nessun Prettier**:
  imitare i file vicini, non riformattare.
- Costanti di configurazione a livello modulo in `UPPER_SNAKE_CASE` con
  commento che motiva il valore.
- Tipi definiti nel file che li consuma (niente `types.ts` condiviso).
- Import assoluti `@/lib/...`, `@/components/...`.

## File chiave

- `web/components/Map/MapViewer.tsx` — il viewer intero (mappa, layer, UI,
  microclima): quasi ogni modifica passa da qui.
- `web/lib/envimetTif.ts` + `web/workers/envimetTif.worker.ts` — data layer
  ENVI-met client-side: download+decodifica GeoTIFF in un worker, cache LRU di
  "cubi" Float32 253×273×54.
- `web/lib/envimetRegistry.ts` — catalogo variabili (rampe, range, file,
  flag `shipped`); `envimetColor.ts`/`envimetDecode.ts`/`envimetGeo.ts` i
  moduli di supporto.
- `web/lib/microlive.ts` — motore "microclima vivo" (particelle vento/caldo/
  foschia), ora alimentato dai cubi tif.
- `web/lib/windgl/` — layer deck.gl custom per le scie di vento su GPU.
- `documentation/11_envimet-data-reference.md` + `12_envimet-aggiungere-dati.md`
  — riferimento dati ENVI-met e procedura per aggiungerli/pubblicarli.
