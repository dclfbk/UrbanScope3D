# Precomputed formats evaluation

## Scope

Pick the on-disk / on-CDN formats used to deliver the precomputed data from
[Issue 2](./2_data-packaging-strategy.md) to the browser. The viewer is
MapLibre GL JS in a Next.js app (see `web/`), so the choice has to fit a
**static, viewer-only** deployment - no tile server, files live in
`web/public/data/processed/`.

Things to decide per layer type:

- vector data (buildings, vegetation, land use),
- raster terrain (DTM),
- 3D meshes / textured buildings (Issue 8, optional),
- small point/tabular data (air-quality stations, time series).

---

## 1. Candidates

### GeoJSON / TopoJSON

- Plain text, native to every web map library, zero tooling.
- TopoJSON shares topology between adjacent polygons - 30-80% smaller than
  GeoJSON for land-use-like data, but needs `topojson-client` to decode and
  not all libs support it.
- Hard ceiling: above ~10 MB the main thread hangs at JSON parse, the page
  jank is visible.
- Good for: small point datasets, configuration layers, anything < 2-3 MB.

### MVT (`.mbtiles`)

- Binary vector tiles, the de-facto standard format for vector maps.
- Distributed as `.mbtiles` (SQLite container) or as exploded `{z}/{x}/{y}.pbf` folders.
- Needs a tile server (tileserver-gl, martin, ...) **or** an unpacked folder served
  by the static host - which means thousands of small files in `public/`.
- Tooling: `tippecanoe` to build, mature.
- Fits a viewer-only setup only if the tiles are unpacked, and that's painful for git/CDN.

### PMTiles

- Same MVT payload, packed into a single archive with a directory index.
- Browser fetches what it needs via HTTP **range requests** - no server needed.
- Drops directly into `web/public/data/processed/*.pmtiles`.
- MapLibre supports it via `pmtiles` JS protocol (one-line registration).
- Tooling: `tippecanoe` + `pmtiles` CLI, both stable.
- Same compression as MVT, same client-side rendering cost.

### Raster XYZ tiles (PNG / WebP)

- Per-tile PNG/WebP folder served statically. Used for hillshade, ortho, basemaps.
- For elevation: **terrain-RGB** PNG (Mapbox encoding) is what MapLibre's
  `raster-dem` source consumes natively.
- Tooling: `gdalwarp` + `rio rgbify` (terrain-RGB) or `gdal2tiles` (visual rasters).
- Many small files, but they sit fine on a static CDN with HTTP caching.

### COG (Cloud Optimized GeoTIFF)

- Single GeoTIFF with internal tiling and overviews, queried via byte-range.
- Conceptually nice (one file, no pre-tiling) but **not native to MapLibre** -
  needs `geotiff.js` + a custom source plugin, extra JS on the client, no 3D
  terrain out of the box.
- Useful in QGIS / Python pipelines, less so as a MapLibre delivery format today.

### 3D Tiles (`.json` + `.b3dm` / `.glb`)

- OGC standard for streaming large 3D scenes (textured buildings, photogrammetry,
  point clouds). Hierarchical LOD, frustum culling.
- Native to **CesiumJS** and **deck.gl** (Tile3DLayer via loaders.gl).
- **Not native to MapLibre** - rendering 3D Tiles inside MapLibre means either
  switching to a Cesium fallback page or adding a deck.gl overlay layer.
- Heavy tooling: `py3dtiles`, `tile3d-builder`, CesiumLab, ...
- Pays off only for textured / photogrammetric assets, overkill for extruded
  footprints (PMTiles + `fill-extrusion-height` is enough).

### glTF / GLB

- Single binary 3D asset format (the payload inside `.b3dm`).
- Good for one-off models (a landmark, a custom mesh) loaded directly by
  Three.js or deck.gl.
- No tiling, no LOD - not a data-delivery format for a whole city.

### Quantized Mesh

- Cesium-only terrain format. Excluded - we'd lock the viewer to Cesium.

---

## 2. Comparison

| Format | Payload | Max practical size | Tile server? | MapLibre support | Typical use |
|---|---|---:|---|---|---|
| GeoJSON | text | ~5 MB | no | native | small vector layers, points |
| TopoJSON | text | ~10 MB | no | via plugin | adjacent polygons (rare) |
| MVT (`.mbtiles`) | binary tiles | TB-scale | **yes** (or unpack) | native (when unpacked) | classic stack |
| **PMTiles** | binary tiles | TB-scale | no (range requests) | native (`pmtiles://`) | vector layers, also raster |
| Raster XYZ (PNG/WebP) | per-tile images | TB-scale | no | native | basemap, hillshade |
| **Terrain-RGB tiles** | per-tile PNG | city-scale ok | no | native (`raster-dem`) | DEM / 3D terrain |
| COG | single GeoTIFF | TB-scale | no | **plugin only** (geotiff.js) | server-side GIS, QGIS |
| 3D Tiles | `.json` + `.b3dm`/`.glb` | TB-scale | no (static) | **not native** | textured 3D, photogrammetry |
| glTF / GLB | single binary | per-model | no | not native | single landmark mesh |

Performance (rough, AOI-scale on cold cache):

| Layer | Format | Init time | Steady frame | Notes |
|---|---|---|---|---|
| Buildings (~30 MB raw) | GeoJSON | 3-6 s parse | ok once parsed | main thread hangs on load |
| Buildings (~30 MB raw) | PMTiles | <500 ms first tiles | smooth | only visible tiles fetched |
| Land use (43 MB raw) | GeoJSON | 8-12 s | jank on pan | hard ceiling hit |
| Land use (43 MB raw) | PMTiles | <1 s | smooth | tippecanoe drops detail by zoom |
| DTM (24 MB GeoTIFF) | terrain-RGB tiles | <500 ms first tiles | smooth | native `raster-dem`, real 3D |
| DTM (24 MB GeoTIFF) | COG via plugin | seconds, depends on plugin | varies | extra JS, no native 3D |

Ease of use / DX:

- **PMTiles**: one `tippecanoe` command, one file in `public/`, one
  `maplibregl.addProtocol('pmtiles', ...)` line in the viewer. Easiest end-to-end.
- **Terrain-RGB**: two-step (`gdalwarp` -> `rio rgbify`), output is a folder, but
  config in MapLibre is one source + `setTerrain`.
- **GeoJSON**: zero tooling, fastest to iterate while data is small.
- **3D Tiles**: heavy tooling, viewer integration requires either Cesium or a
  deck.gl overlay - non-trivial.
- **COG**: nice in theory, but each MapLibre integration is bespoke today.

---

## 3. Recommended formats

Per layer type:

| Layer | Format | Why |
|---|---|---|
| Building footprints + heights | **PMTiles** (vector) | Single file in `public/`, range requests, native MapLibre, works for AOI demo and full Comune |
| Vegetation polygons | **PMTiles** (vector) | Same reasoning |
| Land use 2020 (4.1) | **PMTiles** (vector), zoom-dependent simplification | 43 MB raw is past GeoJSON ceiling, tippecanoe handles per-zoom detail |
| DTM (3.1) | **Terrain-RGB PNG tiles**, EPSG:3857, z12-z17 | Only format that gives real 3D terrain in MapLibre with no plugin |
| Air-quality stations | **GeoJSON** | 3 points, no need to tile |
| Temperature time series | **JSON** per station | Not a spatial layer, fed to a chart component |
| Optional textured 3D buildings (Issue 8) | **3D Tiles** | Only if/when textured meshes enter scope - would require a Cesium fallback page or deck.gl overlay |

Profile-level defaults already aligned with Issue 2:

- **demo profile**: PMTiles for vector layers (buildings, land use, vegetation),
  terrain-RGB tiles for DTM, GeoJSON for stations. Total < 50 MB.
- **full profile**: same formats, larger zoom range, larger PMTiles. No format change.

---

## 4. Things kept out of scope (for now)

- **3D Tiles for extruded footprints**: pure overkill. `fill-extrusion-height` on
  a PMTiles vector source already gives 3D buildings without a second renderer.
- **COG for the DTM**: works in QGIS, but in the browser today it costs a custom
  plugin and we lose the native `raster-dem` -> `setTerrain` path.
- **TopoJSON**: smaller wins than PMTiles, less tooling. Skipped.
- **Quantized Mesh**: Cesium-only, would lock the viewer choice.

---

## 5. Open points

- Confirm the production CDN serves `.pmtiles` with `Accept-Ranges: bytes`
  (Vercel / Netlify do by default, custom hosts may not).
- Decide whether to package terrain-RGB tiles as a folder under `public/` or
  ship them as a single `.pmtiles` raster archive (PMTiles supports raster too,
  one file vs many).
- If Issue 8 lands, prototype 3D Tiles in a separate `/explore-3d` route built
  on Cesium or deck.gl, instead of forcing it into MapLibre.
