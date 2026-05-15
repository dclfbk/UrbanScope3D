# Framework evaluation

## Scope

Quale framework usiamo nel browser. Candidati:

- **MapLibre GL JS** — fork open di Mapbox GL, vector tile + estrusioni 3D + terrain.
- **CesiumJS** — globo 3D, 3D Tiles e Quantized Mesh nativi.
- **Three.js** — engine WebGL generico, niente primitive geospaziali.
- **Unity (WebGL build)** — game engine, non browser-native.

Vincolo da [Issue 4](./4_viewer-only-architecture.md): hosting statico,
viewer-only. Quindi il framework deve mangiare i formati di
[Issue 3](./3_precomputed-formats-evaluation.md) (PMTiles, terrain-RGB, GeoJSON)
senza server.

## Criteri

| Criterio | Cosa significa qui |
|---|---|
| Geospaziale | CRS, proiezioni, basemap, modello zoom/pitch, camera lat/lon |
| 3D | Estrusioni edifici, terrain, ombre, mesh custom |
| Performance | Cold start, fps su laptop medio / mobile |
| DX | Ecosistema, doc, learning curve, integrazione React/Next |
| Formati | PMTiles, MVT, GeoJSON, terrain-RGB, 3D Tiles, glTF |

## Frameworks

### MapLibre GL JS

- nativo: GeoJSON, MVT, PMTiles (via protocol), raster-dem (terrain-RGB).
- estrusioni con `fill-extrusion`, terrain con `setTerrain`.
- niente 3D Tiles nativo, niente glTF mesh.
- React/Next: `react-map-gl` o useEffect classico.
- bundle leggero, cold start veloce, ok mobile.
- contro: niente shadow nativo. Si fa con deck.gl o WebGL custom.

### CesiumJS

- nativo: 3D Tiles, glTF, Quantized Mesh, GeoJSON.
- globo vero (ellissoide), accurato a scala globale.
- sole + ombre integrate sui 3D Tiles texturizzati.
- bundle grosso (~1-2 MB gz), GPU/CPU baseline alti, niente PMTiles nativo
  (plugin community).
- DX: API ampia, learning curve piu' ripida. `resium` per React.

### Three.js

- 3D generico, zero geospaziale. Lat/lon, proiezioni, schemi tile, basemap =
  tutto a mano o via libs (`threebox`, deck.gl, `geo-three`).
- flessibilita' totale su shader e geometria.
- per "mostra citta' + edifici + terreno" sei al livello di astrazione
  sbagliato — reimplementi quello che MapLibre/Cesium ti danno gratis.
- utile come renderer figlio (custom layer MapLibre o via deck.gl) per mesh
  one-off.

### Unity (WebGL build)

- game engine, scene runtime ricche.
- export WebGL = `.wasm` + loader Unity (decine di MB), cold start lento,
  mobile pessimo.
- libs geospaziali esistono (Cesium for Unity) ma il deployment non c'entra
  niente con un prototipo statico web.
- giustificato solo se la deliverable e' desktop o VR, non un viewer web.

## Confronto

| Criterio | MapLibre | Cesium | Three.js | Unity (WebGL) |
|---|---|---|---|---|
| Geospaziale | forte, tile-based | forte, globo | nessuno | via Cesium for Unity |
| Edifici 3D | extrusion su vector tile | 3D Tiles texturizzati | mesh custom | mesh custom |
| Terrain | raster-dem | Quantized Mesh + Cesium World | nessuno | Cesium for Unity |
| Ombre | via deck.gl extension | nativo | tutto custom | nativo |
| Bundle (gz) | ~250 KB | ~1-2 MB | ~150 KB | ~10-30 MB |
| Mobile | buono | medio | dipende | pessimo |
| PMTiles | nativo | plugin | irrilevante | irrilevante |
| 3D Tiles | non nativo (deck.gl Tile3DLayer) | nativo | via loaders.gl | Cesium for Unity |
| glTF | non nativo | nativo | nativo | nativo |
| React/Next | first-class | resium | r3f | povera |
| Curva | bassa | media-alta | alta (in questo dominio) | alta |

## Scelta

**MapLibre GL JS** per l'MVP.

Perche':

- combacia con l'architettura viewer-only: PMTiles + terrain-RGB consumati
  nativi, niente plugin gymnastics.
- baseline piu' leggero -> mobile ok, importante per chi apre la demo dal
  proprio device.
- DX rapido: il viewer in `web/components/Map/MapViewer.tsx` gira gia' su
  questo.
- estrusioni 3D + terrain = una riga di config ciascuno, ombre via deck.gl
  `MapboxOverlay` + `_SunLight({_shadow:true})` raggiungibili (vedi Issue 7).

**Cesium come fallback** se Issue 8 (3D Tiles texturizzati) entra in scope.
Non un ibrido nello stesso viewer ma una pagina separata `/explore-3d` su
Cesium.

**Three.js**: non scelto come framework principale. Resta usabile come custom
layer dietro MapLibre o deck.gl per mesh one-off.

**Unity**: scartato. Deployment domina, niente vantaggio geospaziale che
MapLibre + Cesium non coprano gia'.

## Note

- verificare che `react-map-gl` v8+ esponga gli hook necessari per il time
  slider / sun-driven layer senza scappare al MapLibre puro.
- se Cesium entra come fallback, decidere come si condivide il dato
  preprocessato (PMTiles per MapLibre, 3D Tiles per Cesium = due pipeline
  parallele).
- riesaminare se il prototipo si espande a simulazioni fisiche (radiazione,
  CFD): quello spinge verso uno stack Three.js / WebGPU custom.
