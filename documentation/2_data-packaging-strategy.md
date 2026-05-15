# Data packaging strategy - Bologna

## Scope

Define how the raw datasets from [Issue 1](./1_dataset-inventory.md) get
turned into formats the web viewer can actually load (MapLibre GL JS + Next.js,
see `web/`). This doc covers:

- what the input files really look like on disk (after the download script),
- the target formats served from `web/public/data/`,
- the preprocessing pipeline used to go from one to the other,
- the difference between **demo data** (small, AOI-clipped) and **full-resolution data** (whole Comune),
- a minimal dataset to test the pipeline end-to-end.

---

## 1. Input data - what we actually have

State on disk after running [`scripts/download_missing_data.py`](../scripts/download_missing_data.py)
on the AOI (NW historic centre, ~1.2 x 1.2 km).

| File | Source | Real content | CRS | Size | Ready for viewer? |
|---|---|---|---|---:|---|
| `1)Buildings/1.1_Edifici_Particellari.geojson` | Open Data Bologna `rifter_edif_pl` | Building footprints (Polygon) | EPSG:4326 | 29 MB | yes - direct |
| `1)Buildings/1.2_DBTR_Edificio.json` | Geoportale ER | FeatureCollection wrapped in `V_EDI_CT_USO_AVM`, **null geometries** - attribute table only | n/a | 147 MB | no - unwrap + join |
| `1)Buildings/1.3_DBTR_Unita_Volumetrica.json` | Geoportale ER | Wrapped FC `V_ALB_GPT` - **mislabelled, file actually contains trees** | EPSG:4326 | 173 MB | no - to re-download |
| `1)Buildings/1.5_DBTR_Cassone_Edilizio.json` | Geoportale ER | Wrapped FC `V_FAB_GPG`, Polygon footprints with attributes | EPSG:4326 | 32 MB | almost - unwrap |
| `1)Buildings/1.4_DBTR_Falda` | - | Not downloaded (no public WFS for DBTR) | - | - | deferred to Issue 7 |
| `2)Vegetation/...` | Open Data Bologna + DBTR | Old `green.geojson` placeholder still loaded by viewer | EPSG:4326 | small | to refresh |
| `3)Terrain-DEM/3.1_DTM_Bologna_2023.tif` | Geoportale ER WCS | DTM raster, 0.5 m | EPSG:7791 (RDN32), vertical ITALGEO2005 | 24 MB | no - convert to terrain-RGB |
| `4)LandUse-GroundSurface/4.1_uso_suolo_2020_ed2023_aoi.geojson` | Geoportale ER WFS | Land use polygons, attribute `CODICE_USO` | EPSG:4326 | 43 MB | almost - simplify + categorize |
| `5)EnvironmentalData/5.1_temperature_bologna.csv` | Open Data Bologna | Daily temperature time series, no geometry | n/a | 0.3 MB | yes - tabular only |
| `5)EnvironmentalData/5.2_centraline_qualita_aria.geojson` | Open Data Bologna | Air-quality readings, **`geometry: null`** - no station coordinates in the file | n/a | 5.9 MB | no - join with stations registry |

Notes worth keeping in mind before writing the pipeline:

- DBTR JSON files are **not** standard GeoJSON. The FeatureCollection sits inside
  a top-level wrapper key (`V_EDI_CT_USO_AVM`, `V_FAB_GPG`, ...). Has to be flattened.
- DBTR Edificio (1.2) has no geometry, it's the attribute side of the entity.
  Geometries live in 1.5 (footprints) and 1.3 (volumetric units, with avg height).
  For per-building 3D extrusion: join 1.2 attributes with 1.5/1.3 geometries on `ID_E`.
- 1.3 is mislabelled - file currently contains tree points (`V_ALB_GPT`), not UVL.
  Re-download with the correct DBTR class before relying on its heights.
- Air quality (5.2): the Opendatasoft endpoint returns the time-series only,
  station coordinates have to come from a separate registry and joined on station name.
- DTM is in RDN32 (EPSG:7791). Web maps expect WGS84 / Web Mercator, so reproject
  to EPSG:3857 before tiling.

---

## 2. Target formats - what MapLibre actually consumes

MapLibre GL JS (see [`web/components/Map/MapViewer.tsx`](../web/components/Map/MapViewer.tsx))
natively supports:

- **GeoJSON sources** - fine up to a few MB, above ~10 MB the page hangs at parse time.
- **Vector tile sources** (MVT / PMTiles) - meant for big datasets, lazy-loaded by zoom/tile.
- **Raster-DEM sources** - for 3D terrain, expects `terrain-rgb` PNG tiles (elevation encoded in RGB).
- **Raster sources** - generic XYZ tiles, used for hillshade or ortho.

Mapping from our input to the target format:

| Layer | Target format | Why | Tool |
|---|---|---|---|
| Building footprints (1.1, 1.5) | **PMTiles** (vector) | Single file, HTTP range requests, no tile server. Drops into Next.js `public/`. | `tippecanoe` -> `.pmtiles` |
| Building heights (1.3 UVL joined on 1.5) | Per-feature property in the same PMTiles | Lets MapLibre do `fill-extrusion-height: ['get', 'h']` directly | join in the preprocessing script |
| Land use 2020 (4.1) | **PMTiles** (vector) with simplification by zoom | 43 MB raw is too heavy for browser parse, tiling drops irrelevant detail at low zoom | `tippecanoe` with `--drop-densest-as-needed` and per-zoom simplification |
| DTM (3.1) | **Terrain-RGB PNG tiles** in EPSG:3857 (z12-z16 over Bologna) | Native MapLibre `raster-dem` source, enables real 3D terrain | `gdalwarp` (reproject) -> `rio rgbify` -> static folder served from `public/` |
| DTM (3.1) hillshade preview | Static PNG / WebP for low-zoom basemap context | Cheaper than terrain-rgb when 3D is off | `gdaldem hillshade` |
| Vegetation polygons | **PMTiles** | Same reason as buildings | `tippecanoe` |
| Air quality stations | Plain GeoJSON (small) | A handful of points, no tiling needed | preprocessing script joining 5.2 with the station registry |
| Temperature time series | JSON per station, loaded on demand | Not a spatial layer, consumed by a chart component | direct API -> static JSON |
| 3D Tiles (optional, future) | **3D Tiles** for textured buildings | Only if Issue 8 (external 3D assets) is in scope. MapLibre doesn't render natively, would need a Cesium fallback page. | `py3dtiles` - out of MVP scope |

Why PMTiles and not `.mbtiles` or per-tile XYZ folders:

- single file, no tile server, no rewrite rules - drop into `web/public/data/`,
- range-request friendly, the browser fetches only the tiles it needs,
- tooling is mature (`tippecanoe`, `pmtiles` CLI).

---

## 3. Preprocessing pipeline

One Python entry point under `scripts/` orchestrates the conversions, calling
external CLIs (`tippecanoe`, `gdal*`, `rio rgbify`, `pmtiles`) via `subprocess`.

```text
raw downloads (web/public/data/*)            scripts/                    output
        |                                                                  |
        |  1) DBTR unwrap                                                  |
        |     {V_FAB_GPG: FeatureCollection} -> FeatureCollection          |
        +------------------> preprocess_dbtr.py ---------> data/buildings.geojson
        |
        |  2) attribute/geometry join                                      |
        |     1.5 (geom) + 1.2 (attrs) on ID_E                             |
        |     1.3 UVL height -> max per ID_E -> joined as h_max            |
        |
        |  3) tile (vector)                                                |
        +------------------> tippecanoe ------------------> data/buildings.pmtiles
        |     -zg --drop-densest-as-needed -o ...
        |
        |  4) DTM reproject + tile (raster)                                |
        +------------------> gdalwarp -t_srs EPSG:3857 ---+
        |                                                 +--> data/terrain/{z}/{x}/{y}.png
        |                                rio rgbify ------+    (terrain-RGB)
        |
        |  5) Land Use simplify + tile                                     |
        +------------------> tippecanoe -zg --simplification=10 --> data/landuse.pmtiles
        |
        |  6) Air quality join                                             |
        +------------------> join_air_stations.py --------> data/air_stations.geojson
```

Script layout (one script per concern):

```text
scripts/
+- download_missing_data.py        # done, Issue 1
+- preprocess_dbtr.py              # 1+2: unwrap + join
+- build_buildings_pmtiles.sh      # 3: tippecanoe wrapper
+- build_terrain_rgb.sh            # 4: gdalwarp + rio rgbify
+- build_landuse_pmtiles.sh        # 5
+- join_air_stations.py            # 6
```

Output paths:

- viewer-consumed artifacts -> `web/public/data/processed/` (PMTiles + terrain-RGB folder).
  Keeps the source of truth (`web/public/data/<n>)*`) separate from the tiled output.
- heavy intermediate files (e.g. reprojected GeoTIFF before tiling) -> `data/` at repo root, gitignored.

---

## 4. Demo data vs full-resolution data

Two profiles, switched via a config flag, sharing the same scripts.

| Profile | Spatial extent | Building source | DTM zoom | Land use detail | Total size |
|---|---|---|---|---|---:|
| **demo** (default, prototype) | AOI bbox `11.335, 44.495 -> 11.350, 44.506` (~1.2 x 1.2 km) | 1.1 footprints + 1.5/1.3 heights, clipped to AOI | z12-z17 (matches 0.5 m source) | tippecanoe `-z14` | < 50 MB |
| **full** (Comune di Bologna) | Comune boundary | full DBTR via "Download DB Topo" (1.2/1.3/1.5 + Falda) | z10-z17 | tippecanoe `-z16`, `--drop-densest-as-needed` | a few hundred MB |

Same scripts, parameterized by:

- `BBOX` (default = AOI from Issue 1, override with `--bbox`),
- output filename suffix (`_demo` vs `_full`),
- tippecanoe zoom flags.

The viewer picks which PMTiles to load via `NEXT_PUBLIC_DATA_PROFILE=demo|full`, so
demo deployments stay light and the full dataset is only built when needed.

---

## 5. Minimal test dataset

The minimal test dataset = the **demo** profile, clipped to the AOI. It's the contract
the pipeline has to satisfy end-to-end before wiring any new feature in.

1. `web/public/data/processed/buildings_demo.pmtiles` - building polygons with `h_max`
   attribute, all features inside the AOI bbox.
2. `web/public/data/processed/landuse_demo.pmtiles` - land use polygons clipped to the AOI,
   with `CODICE_USO` for `match`-based styling.
3. `web/public/data/processed/terrain/{z}/{x}/{y}.png` - terrain-RGB tiles z12-z17 over the AOI.
4. `web/public/data/processed/air_stations.geojson` - 3 Bologna air quality stations with
   coordinates, no time series (kept light).

Acceptance check (manual, until tests are added):

- `npm run dev`, open `/explore` - all four layers render, the layer panel toggles them
  on/off, page hits steady state in < 5 s on a cold cache.
- `fill-extrusion-height` on buildings reflects realistic heights (no random spikes from
  missing joins).
- toggling the terrain source on shows visible relief on the city slope.

---

## Open points / next steps

- **DBTR data quality**: re-download `1.3 UVL_GPG` correctly (current file has trees).
  This unblocks per-building height attribution.
- **Air quality stations registry**: identify the Open Data Bologna dataset that exposes
  the 3 station coordinates so `join_air_stations.py` has a geometry source.
- **PMTiles serving**: confirm Next.js dev/build doesn't break range requests on `.pmtiles`
  (works on the static `public/` path, production CDN may need `Accept-Ranges: bytes`).
- **3D terrain rendering**: validate that MapLibre's `raster-dem` with our terrain-RGB
  tiles produces correct elevations (sanity check against known building bases).
- **Falda**: deferred to Issue 7, only needed for sloped roofs.
