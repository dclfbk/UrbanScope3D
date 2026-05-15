# Shadow workflow evaluation

## Scope

Come si fanno le ombre. Due opzioni macro:

- **runtime**: il renderer le calcola a ogni frame da direzione sole
  ([Issue 6](./6_solar-position-evaluation.md)) e geometria edifici.
- **precomputate**: bake offline per date / ore fisse, shippate come overlay.

Vincoli a monte:

- viewer-only, hosting statico ([Issue 4](./4_viewer-only-architecture.md)),
- MapLibre come renderer principale ([Issue 5](./5_framework-evaluation.md)),
- edifici come footprint estrusi con `h_max` ([Issue 2](./2_data-packaging-strategy.md))
  — **tetti piatti**, niente Falda ancora,
- sole da suncalc.

## Runtime vs precomputato

### Runtime

- pass shadow map per frame: la scena vista dal sole va in una depth texture,
  poi sample nel pass colore.
- MapLibre non ha shadow pass nativo. Due strade pratiche:
  - **deck.gl `MapboxOverlay`** + `LightingEffect({sun: _SunLight({_shadow: true})})`
    sopra MapLibre.
  - **custom WebGL layer** dentro MapLibre (controllo totale, piu' codice).
- pro: qualsiasi ora, qualsiasi data, basta cambiare la direzione sole.
- contro: il costo GPU sale con la geometria. Mobile e' il collo di bottiglia.
  Risoluzione shadow map = trade-off qualita' / fps.

### Precomputato

- bake offline per un set discreto di (data, ora), risultato in raster
  overlay o GeoJSON poligoni d'ombra.
- tool: Blender / Cycles, `pyshadow`, `umep` (plugin QGIS), o un Three.js
  head-less custom.
- pro: zero costo runtime, qualita' altissima, gira ovunque.
- contro: storage cresce col numero di sample, accessibili solo i momenti
  bakati — niente time slider libero.
- utile come complemento: una mappa "ore di sole / giorno" per solstizi
  / equinozi.

### Ibrido

- runtime per lo slider interattivo, precomputato per le mappe analitiche
  ("solar access 21 giugno"). Convivono.

## Quanto pesa la geometria

La fedelta' delle ombre e' limitata da quello che hai in input.

| Geometria | Tetto | Output ombra | Buono per |
|---|---|---|---|
| Footprint + altezza (1.1 + 1.5 + 1.3 UVL) | piatto | scatola estrusa | studio orario a scala citta', demo MVP |
| + Falda (1.4) | spiovente per faccia | ombra del tetto reale | alba/tramonto, studi facciata |
| 3D Tiles texturizzati (Issue 8) | mesh completa | photoreal | landmark |

Cosa significa per l'MVP:

- estrusioni piatte funzionano col sole alto (mezzogiorno): l'ombra a terra
  e' dominata dall'outline.
- a sole basso (alba/tramonto) si vedono male: il tetto piatto fa un'ombra
  rettangolare pulita, il tetto reale spiovente ne fa una triangolare.
- Falda e' l'upgrade piu' economico per fissarlo, *se* DBTR Falda viene
  scaricata (rinviata, vedi Issue 1).
- 3D Tiles importano solo se Issue 8 entra.

## Asset esterni e ombre

Asset esterni entrano nello shadow story solo se il renderer li mangia e la
licenza tiene.

- Cesium OSM Buildings / OSMBuildings: footprint + altezza, niente roof
  detail. Stesso ceiling delle nostre estrusioni, zero gain ombre.
- Google Photorealistic 3D Tiles: mesh fotoreal con tetti, ottimi per ombre
  ma licenza (chiave Maps Tile API, paid + restrizioni) non compatibile con
  un MVP demo gratis.
- OSM-3D / 3DBAG: per l'Italia non esiste a LOD2 oggi.
- Cesium ion sample: usabile solo in Cesium.

Conclusione: la via piu' economica per ombre migliori e' **Falda + estrusioni
spioventi**, non asset esterni. Esterni sono "nice to have" per la
visualizzazione, non la leva per l'accuratezza ombre su Bologna.

## Workflow MVP

Lo stack piu' semplice che produce un'ombra usabile sul time slider:

1. **Renderer**: MapLibre + deck.gl `MapboxOverlay` (`interleaved: false`).
2. **Shadow layer**: deck.gl `GeoJsonLayer` sui footprint locali (1.1 Edifici
   Particellari), estruso a 15 m di default — l'altezza vera arriva quando
   `preprocess_dbtr.py` finisce e si shippa il PMTiles edifici.
3. **Effect**: `LightingEffect({sun: _SunLight({timestamp, _shadow: true}), ambient: ...})`
   passato nei `effects` dell'overlay. `shadowColor` ~ `[0,0,0,0.45]`.
4. **Direzione sole**: `timestamp = currentTime.getTime()`, computato da
   `_SunLight` internamente. Per la luce delle facce delle estrusioni
   MapLibre usiamo invece `map.setLight(toMapLibreLight(getSunPosition(...)))`
   da `web/lib/sun.ts`.
5. **Ground**: l'ombra cade sul ground plane di deck.gl. Per il demo
   flat-ground basta un piano colorato; quando il terrain-RGB e' vivo
   MapLibre lo disegna sotto.
6. **Time slider** (Issue 6): muove `currentTime`, il resto segue.
7. **Contesto fuori AOI**: `fill-extrusion` MapLibre su openfreemap rimane
   acceso per dare profondita' al fuori-Bologna. Non casta ombre, ma evita
   che la scena appaia vuota intorno al cerchio AOI.

Limiti da dichiarare nella UI:

- ombre solo da tetti piatti finche' Falda non c'e',
- ombre = visive, non analitiche (no "ore di sole per edificio" nell'MVP),
- mobile fps puo' calare col profilo full Comune. Demo profile e' il target.

Layer precomputato opzionale (post-MVP):

- una raster "solar access" per equinozio / solstizio, renderizzata offline
  con un Three.js head-less sugli stessi edifici, shippata come
  `web/public/data/processed/solar_access_<date>.png` e mostrata come overlay
  toggleabile.

## Acceptance

Manuale, sul demo profile:

- slider su 21 giugno: ombre ruotano da ovest a est durante il giorno, piu'
  corte a mezzogiorno.
- slider su 21 dicembre: visibilmente piu' lunghe, sole sempre basso.
- spegnere il toggle "Edifici 3D + ombre" -> sparisce sia l'estrusione che
  l'ombra.
- fps > 30 su laptop medio col demo profile.

## Note

- verificare che deck.gl `MapboxOverlay` regga MapLibre v5+ con il protocollo
  PMTiles registrato (test fatto su `interleaved: false`, ok).
- decidere se le ombre vanno sul terrain mesh (`raster-dem`) o su un ground
  plane piatto. Terrain-aware e' piu' figo ma richiede coupling fra shadow
  pass e output terrain MapLibre — non triviale.
- riscaricare 1.4 Falda quando DBTR "Download DB Topo" e' fatto, poi rivedere
  geometria tetti.
- decidere se shippare overlay solar-access precomputato accanto allo slider
  runtime, o tenerlo come follow-up.
