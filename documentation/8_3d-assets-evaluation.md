# External 3D assets evaluation

## Scope

Vediamo se asset 3D esterni servono per arricchire la scena Bologna e
supportare studi ombre ([Issue 7](./7_shadow-workflow-evaluation.md)). Il
prototipo e' una demo **pubblica, statica, viewer-only** su MapLibre
([Issue 4](./4_viewer-only-architecture.md) + [Issue 5](./5_framework-evaluation.md)),
quindi un asset esterno deve:

- essere license-compatible per una demo pubblica gratis (no chiavi API a
  pagamento, no NC dove non vogliamo),
- importare in MapLibre direttamente *o* in una pagina Cesium di fallback,
- dare un guadagno di fedelta' rispetto alle estrusioni piatte da PMTiles.

## Candidati

### Cesium ion - OSM Buildings

- edifici OSM mondiali servati come 3D Tiles dal Cesium ion.
- free tier con attribuzione, account ion (no carta).
- Geometria: footprint + altezza, **niente tetti**. Stesso ceiling delle
  nostre estrusioni.
- Renderer: nativo Cesium, possibile in MapLibre via deck.gl `Tile3DLayer`.

### Google Photorealistic 3D Tiles

- mesh fotoreal di citta' inclusa Bologna, servita come 3D Tiles via Map
  Tiles API.
- Geometria: mesh completa con tetti veri.
- Licenza: chiave Maps Platform, **uso a pagamento**, ToS che vietano
  caching / redistribuzione / derivati.
- Non compatibile con una demo pubblica gratis a meno di non prendersi
  billing Google + ToS.

### Cesium ion - sample data / community

- ion ha sample 3D Tiles gratuiti per varie citta'. Bologna non e' nel set
  curato oggi.
- utile per testare la pipeline import, meno utile come fonte Bologna.

### Sketchfab / TurboSquid / open libraries

- libs per-asset, modelli 3D singoli (`.glb`, `.fbx`, ...).
- licenza per asset (CC0, CC-BY, all-rights-reserved, ...). Va controllata
  caso per caso.
- use case: piazzare un landmark (Due Torri, San Petronio) come mesh
  hand-placed sopra la base estrusa.
- qualita' geometrica varia, niente garanzia di georeferenziamento, scala o
  up-axis.

### OSM-derivate (OSMBuildings, F4 Map)

- OSMBuildings: lib JS che consuma i tag OSM `building:*` ed estrude
  client-side. Niente asset precomputato, niente roof detail oltre l'euristica
  `roof:shape`.
- equivalente a quello che facciamo gia' con i nostri PMTiles + estrusione,
  zero gain per le ombre.

### Photogrammetria pubblica (heritage / academia)

- Bologna ha scansioni heritage di landmark specifici (universita', MiC,
  progetti CINECA). Coverage = solo landmark, non citta'.
- licenza: caso per caso, spesso CC-BY-NC, fine per una demo.
- use case: come Sketchfab — un modello hand-placed.

### Dataset 3D nazionali aperti

- 3DBAG (NL), 3D Stadt (DE), CityGML France ... per l'Italia oggi non c'e'
  niente a LOD2 city-wide. Out of scope per Bologna nel 2026.

## Compatibilita' licenza

| Libreria | Licenza | Demo pubblica gratis? | Note |
|---|---|---|---|
| Cesium ion - OSM Buildings | open data + ion ToS, attribuzione | si | account ion + access token |
| Google Photorealistic | Google Maps Platform ToS, paid | **no** | non viable per demo statica gratis |
| Cesium ion samples | per-asset, free tier | si | non Bologna-specific |
| Sketchfab | per-asset (CC0 / CC-BY / proprietary) | dipende | review manuale per modello |
| OSMBuildings | open source JS + ODbL data | si | zero gain rispetto ai nostri PMTiles |
| Photogrammetria heritage | per-progetto | dipende | spesso CC-BY-NC, fine per demo |

Regole hard seguite per il prototipo:

- preferire dataset / asset gratis, aperti, con attribuzione,
- evitare tutto cio' che richiede una API key billable da una demo pubblica
  statica,
- se la licenza non e' chiara, skip.

## Qualita' geometrica / LOD

| Sorgente | LOD | Tetto | Texture | Coverage |
|---|---|---|---|---|
| Nostri PMTiles + h_max | LOD1 (block) | piatto | nessuna | AOI / Comune |
| OSM Buildings (Cesium ion) | LOD1 | piatto | nessuna | mondiale |
| OSMBuildings JS | LOD1 (+ euristica roof) | parziale | nessuna | mondiale (OSM-driven) |
| DBTR Falda + estrusione spiovente (Issue 1.4) | LOD2 | spiovente per faccia | nessuna | regionale (RER) |
| Google Photorealistic 3D Tiles | mesh | photoreal | photoreal | citta' principali (Bologna ok) |
| Sketchfab landmark | mesh | varia | varia | per asset |
| Photogrammetria heritage | mesh | photoreal | photoreal | solo landmark |

L'upgrade LOD2 piu' economico **per Bologna** e' **Falda da DBTR**, non una
libreria esterna. Esterne o pareggiano LOD1 (zero gain) o hanno problemi di
licenza (Google).

## Test import - feasibility

Cosa serve per agganciare ogni candidato vivo:

### Cesium ion OSM Buildings in MapLibre via deck.gl

```text
+ MapboxOverlay deck.gl gia' attivo nel viewer
+ aggiungere Tile3DLayer con asset URL ion + access token
+ stesso direzione sole (Issue 6) attraverso il LightingEffect dell'overlay
- richiede un access token Cesium ion committato (o env var build-time)
  - token pubblico ma rotabile
- bundle cresce di ~150-200 KB gz
```

### Cesium ion OSM Buildings in pagina Cesium dedicata

```text
+ aggiungere CesiumJS come route separata /explore-3d
+ Cesium.Cesium3DTileset.fromIonAssetId
+ riusare lo slider (Issue 6) per pilotare Cesium.JulianDate
- raddoppia la superficie renderer (MapLibre + Cesium)
+ ombre native su mesh texturizzate se in futuro entrano asset texturizzati
```

### Singolo landmark (Sketchfab .glb) in MapLibre

```text
+ deck.gl ScenegraphLayer o threebox con un .glb piazzato
+ georef manuale (lat/lon + heading + scala)
- one-off per asset, non scala alla citta'
+ aggiunge interesse visivo alla demo senza toccare la pipeline dati
```

## Adatto per le ombre?

Cross-check con Issue 7:

- il workflow ombre copre gia' LOD1 (tetti piatti) via deck.gl SunLight.
- LOD2 (spioventi) e' quello che cambia il risultato visivo a sole basso. La
  fonte piu' economica per Bologna e' **Falda da DBTR**, non una lib esterna.
- mesh fotoreal (Google) cambierebbero ulteriormente le ombre ma la licenza
  rende inutilizzabile.
- mesh heritage / Sketchfab di landmark possono fare uno studio ombre demo su
  un singolo edificio (es. Due Torri al tramonto) — buono per il pitch, non
  per la citta'.

## Esperimento Unreal Engine 5

Ho provato a portare la scena dentro **Unreal Engine 5** per vedere se un
renderer real-time professionale potesse dare il salto di fedelta' che gli
asset esterni non davano (mesh fotoreal, Lumen, Nanite sui footprint estrusi).
L'esperimento e' arrivato a una scena navigabile con il DTM, gli edifici e
qualche landmark, ma non si reggeva contro il vincolo di base del prototipo.

Perche' non e' compatibile con l'architettura:

- l'output del tirocinio e' una demo **viewer-only statica**
  ([Issue 4](./4_viewer-only-architecture.md)). UE5 produce un eseguibile o,
  via Pixel Streaming, richiede un server di rendering — entrambi rompono il
  contratto "tutto sulla CDN" e mettono fuori scope ops, costi e licenze.
- la pipeline asset di UE5 (Quixel, Nanite source meshes, lightmaps) non e'
  riproducibile da uno script che parte dai dati pubblici di Bologna. Lo
  scenario UE5 finisce versionato come blob, non come ricetta.
- il bundle WebGL/HTML5 deprecato da Epic non e' un'opzione, e una pagina
  Cesium o un viewer MapLibre + deck.gl coprono il caso "ombre + estrusione"
  con un footprint molto piu' piccolo.

Cosa ho riusato:

- la scena UE5 e' diventata la base per un **video di intro del sito**:
  camera animata con un percorso sulla Bologna 3D, rendering frame-by-frame
  esportato come `.mp4`, montato come hero del landing (vedi
  `web/public/Bologna.mp4` / `web/public/BolognaLowQuality.mp4`).
- il rendering non e' al massimo dettaglio: la macchina di sviluppo ha poca
  RAM, e con tutti gli effetti (Lumen GI, riflessi screen-space alti, AA TSR)
  saturava memoria prima di chiudere la sequenza. Ho abbassato le impostazioni
  finche' la coda non andava a buon fine.
- se in futuro la macchina viene aggiornata (piu' RAM, GPU con piu' VRAM),
  vale la pena rigirare la sequenza alle impostazioni piene e sostituire il
  file mp4 nel `public/` — l'asset e' isolato, niente cambia nel viewer.

In sintesi: UE5 e' fuori scope come motore di rendering live del prototipo,
ma e' utile come **strumento di asset production** per i contorni del sito
(intro video, eventuali clip di presentazione). Stessa categoria di un asset
Sketchfab piazzato a mano: arricchisce la demo, non l'architettura.

## Scelta

**Per l'MVP**: skip librerie 3D esterne. L'architettura e i dati open coprono
gia' LOD1 city-wide e Falda da DBTR e' il prossimo passo giusto per il LOD2.

**Showcase opzionale** (post-MVP, se c'e' tempo):

- prendere uno o due landmark open (Sketchfab CC-BY o photogrammetria
  heritage) e piazzarli come `ScenegraphLayer` deck.gl sopra la base PMTiles.
  Valore di presentazione per la demo, non architettura.

**Se lo scope si espande** a un'esperienza textured 3D Tiles:

- Cesium ion OSM Buildings come baseline gratis,
- viewer texturizzato come pagina **separata `/explore-3d` Cesium**, non un
  ibrido in MapLibre,
- evitare Google Photorealistic 3D Tiles a meno che il progetto non si prenda
  billing Maps Platform + ToS.

## Note

- verificare i limiti free-tier ion per una demo pubblica (request count,
  quota mensile, attribuzione).
- se piazziamo un landmark, documentare licenza + attribuzione in
  `web/public/data/processed/3d/README.md`.
- riesaminare questo doc quando 1.4 Falda DBTR sara' scaricata: con LOD2 da
  dati italiani open la maggior parte dei sorgenti esterni diventa irrilevante
  per Bologna.
