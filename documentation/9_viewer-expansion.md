# Prototype v2 - roadmap

## Scope

The first eight issues took the project from "no data" to a working 3D
viewer on Bologna (buildings, terrain, shadows, vegetation, wind, basic
environmental data). This document captures the next round of work,
agreed in the tutor call on **2026-05-15**: ergonomics, richer datasets,
bilingual UI, and onboarding documentation.

The deliverable is intentionally an umbrella: each big item below will
likely grow into its own design note (`12_*.md`, `13_*.md`, ...) once it
is picked up. The status column at the start of each section tracks
where we are.

---

## 1. UI / navigation

| Status | Item |
|---|---|
| TODO | Compass / N-S-W-E indicator on the map |
| TODO | Click popup reports wind speed at the clicked pixel |
| TODO | Click popup reports temperature at the clicked pixel |
| TODO | Group layer toggles into collapsible categories (no more flat list) |
| TODO | Sticky search bar pinned at the top of `/explore` |
| TODO | Neighborhood (`quartieri`) search; selecting one highlights it in pseudo-3D, extruded above the rest of the city |
| TODO | Bilingual UI (IT / EN) via `react-i18next` or `next-intl` |

Notes:

- The compass should follow `map.getBearing()` so when the user rotates
  the view it stays consistent.
- The popup already exists for temperature ([4_viewer-only-architecture.md](./4_viewer-only-architecture.md));
  extending it to read the wind raster value requires sampling the
  `04_Velocita_Vento` raster at the clicked lon/lat, ideally from a
  pre-computed value grid alongside the PNG so the browser does not
  need to load the original GeoTIFF.
- Layer grouping is a UI refactor of the panel in
  `web/components/Map/MapViewer.tsx`, not a data change.

---

## 2. New datasets / overlays

| Status | Item | Source |
|---|---|---|
| TODO | Per-building heights from DSM/DTM (nDSM) or from Open Data Bologna | [Building heights pipeline](#building-heights-pipeline-ndsm) / OD Bologna |
| TODO | Open Data Bologna building dataset `c_a944ctc_edifici_pl` | https://opendata.comune.bologna.it/explore/dataset/c_a944ctc_edifici_pl/ |
| TODO | Colour the buildings by air temperature (heatmap-style `fill-extrusion-color`) | OD Bologna temperature + 1.1 footprints |
| TODO | Make wind direction visible in 3D (vector field / particle layer over the buildings) | `04_Velocita_Vento.tif` + a future wind direction raster |
| TODO | Noise overlay | https://noisy-city.jetpack.ai/ , https://goodcitylife.org/ |
| TODO | Apply the **official Bologna Pantone palette** to the city render | Comune di Bologna brand guidelines |
| TODO | **Bologna 3D** ArcGIS service: pull `ALT_UV` (eaves height) per building | https://sitmappe.comune.bologna.it/Bologna3D/ |
| TODO | OSM **roof shape** support (LOD2-ish extrusion via `roof:shape` tag) | https://wiki.openstreetmap.org/wiki/Key:roof:shape |
| TODO | **Ortofoto** basemap alongside dark / light / satellite | TBD provider |
| TODO | Cross-check with the regional ER portal for anything missing | https://mappe.regione.emilia-romagna.it/ |

### Bologna 3D ArcGIS query

The Bologna 3D map service exposes the eaves height as `ALT_UV`. A
working REST query that returns features in WGS84:

```text
https://sitmappe.comune.bologna.it/agsfed/rest/services/Basi/CartografiaTecnica/MapServer/14/query
  ?f=json
  &where=1=1
  &outFields=ALT_UV,COD_DESCR,ENTE,OBJECTID
  &outSR=4326
```

The plan is to wrap this in a `scripts/download_bologna3d_alt_uv.py` and
join the result on `OBJECTID` with the building footprints already in
the viewer. `ALT_UV` should replace the `DEFAULT_BUILDING_HEIGHT = 15`
fallback in `MapViewer.tsx` whenever the DSM-derived height is missing,
and serve as a cross-check where the DSM does cover the footprint.

---

## 3. LiDAR

| Status | Item |
|---|---|
| TODO | **Textured LiDAR / photorealistic 3D Tiles** - evaluate a new viewer layer (scope TBD with tutor) |

Open: do we render an actual coloured point cloud, or step up to a
textured mesh exported from the LiDAR campaign? The first is a deck.gl
`PointCloudLayer` on a thinned `.las` / `.laz`; the second is a 3D Tiles
dataset rendered alongside MapLibre. See
[8_3d-assets-evaluation.md](./8_3d-assets-evaluation.md) for the
licence-compatible options previously surveyed.

---

## 4. Documentation

| Status | Item |
|---|---|
| TODO | A "how to add a new dataset" walkthrough in `documentation/` |
| TODO | Reflect Leonardo's NBS toolkit PDF: visual style + 3-30-300 green rule |
| TODO | Document each new feature as it lands, not at the end |

The "how to add a new dataset" doc should be a step-by-step that
takes a contributor from "I have a GeoJSON / GeoTIFF" to "the layer is
visible in the viewer with a toggle": pre-processing (where to put it,
which script to run), MapLibre vs deck.gl wiring, gitignore vs vercel
ignore, where to declare the toggle in the layer panel.

The **3-30-300 green rule** (three trees visible from every home, 30%
canopy cover per neighborhood, 300 m to the nearest park) is something
the viewer can actually display: trees + canopy from
[1_dataset-inventory.md](./1_dataset-inventory.md) plus the
neighborhood polygons would let us compute "% canopy" per quartiere and
"distance to park" per address.

---

## 5. Open questions

| Status | Question |
|---|---|
| TODO | Confirm scope of "LiDAR with texture" (point cloud vs textured mesh) |
| TODO | Get the official Bologna brand palette PDF if it exists |
| TODO | Pseudo-3D neighborhood selection: simple polygon extrusion or stylised "podium" effect? |

Resolutions live here so we keep the conversation discoverable. When
each one is answered, the answer goes back into the relevant section
above and the question gets struck out.

---

## 6. Status / priority

The natural ordering, based on what unblocks what:

1. **Bologna 3D `ALT_UV`** - gives accurate building heights everywhere,
   removes the `DEFAULT_BUILDING_HEIGHT = 15` fallback. Unblocks the
   "colour by temperature" task because we need correct heights first.
2. **Layer hierarchy + sticky search + compass** - small UI items that
   are easy to do in parallel with the data work.
3. **Bilingual UI** - touches every visible string; cleaner to add now,
   before more strings are written.
4. **Per-building temperature colouring** - depends on (1).
5. **Neighborhood search + pseudo-3D** - depends on the layer hierarchy.
6. **Noise overlay** - exploratory, depends on what the two referenced
   sites actually expose.
7. **Ortofoto basemap, regional portal cross-check, Pantone palette** -
   polish items, can slot in anywhere.
8. **LiDAR with texture** - largest scope, do after the rest.
9. **"How to add a new dataset" doc** - write it after the next two or
   three datasets land, so the doc reflects the real path.

---

## Building heights pipeline (nDSM)

> **Current approach (2026-05-19): Open Data Bologna, not nDSM.**
> The nDSM pipeline below was implemented but its output was wrong: the
> DTM subtraction collapsed and `height` ended up tracking the absolute
> terrain elevation (median ~61 m for Bologna, vs. the real ~10 m). Fixing
> it requires regenerating a >100 GB raster. It is superseded by the Open
> Data Bologna dataset **`c_a944ctc_edifici_pl`** (Comune di Bologna - SIT,
> CC BY 4.0), which ships a validated per-building eaves height
> `altezza_gr` (ground → roof edge, metres; cross-checked by
> `quota_gron - quota_pied`). 65 781 buildings, full comune coverage,
> median 9.6 m — no heavy raster step.
>
> Build it with [`scripts/build_building_heights_opendata.py`](../scripts/build_building_heights_opendata.py)
> (download instructions in the script header). It writes the same
> `web/public/data/processed/buildings_heights.geojson` with a numeric
> `height` property, so the viewer wiring is unchanged: `MapViewer.tsx`
> HEAD-checks that path and the deck.gl extrusion reads `properties.height`,
> falling back to `DEFAULT_BUILDING_HEIGHT = 15` for the ~11 k footprints
> the source leaves at 0.
>
> The nDSM write-up is kept below as reference: it is still the right
> approach if a corrected, datum-aligned DSM/DTM pair becomes available
> (it would also give true per-pixel roof lines, which Open Data's single
> eaves height per footprint does not).

### Scope

Compute real per-building heights from the Leonardo / FBK DSM by subtracting
the regional DTM, then attach those heights as a `height` property on the
Bologna building footprints. The output is consumed by the viewer's
`fill-extrusion-height` paint expression (see
[4_viewer-only-architecture.md](./4_viewer-only-architecture.md)).

Formula: `nDSM = max(DSM - DTM, 0)`, then per-feature
`height = percentile_95(nDSM ∩ footprint)`. The p95 dampens outliers (antennas,
chimneys, noise) while still tracking the actual roof line.

---

### 1. Inputs

| File | Source | Format | CRS | Size |
|---|---|---|---|---|
| `web/public/data/DatiLeonardo_8-05-2026/.../*.ASC` | Leonardo / FBK | ESRI ASCII Grid, ~186 tiles | EPSG:25832 (assumed, no `.prj` shipped) | ~6 GB |
| `web/public/data/3)Terrain-DEM/3.1_DTM_Bologna_2023.tif` | Geoportale ER (Issue 1) | GeoTIFF, 0.5 m | EPSG:7791 (RDN32) | 24 MB |
| `web/public/data/1)Buildings/1.1_Edifici_Particellari.geojson` | Open Data Bologna | GeoJSON polygons | EPSG:4326 | 29 MB |

---

### 2. Inside the `.ASC` tiles

The files Leonardo shared are **ESRI ASCII Grid** raster tiles, one per
square. Every tile is a plain text file: six header lines describing the
grid, then the elevation values row by row, top-down, space-separated.

Header from one real tile (`32_67704930.ASC`):

```
NCOLS 1108
NROWS 1757
CELLSIZE 0.5000
XLLCENTER 677446.2500
YLLCENTER 4930121.7500
NODATA_VALUE -9999.0000
```

What that means:

- **1108 × 1757 cells** at **0.5 m** spacing → each tile covers
  **554 m × 878 m** on the ground.
- **`XLLCENTER` / `YLLCENTER`** are the projected coordinates of the
  centre of the lower-left cell. The values land squarely in **UTM zone
  32 N** (no `.prj` is shipped — see the
  [`DSM_SRS` override](#environment-overrides) when buildings render
  offset).
- **`NODATA_VALUE = -9999`** marks pixels with no measurement (tile edges,
  reflective surfaces the LiDAR missed, water).

Each value in the matrix is a **surface elevation in metres above the
vertical datum** — the top of whatever the laser hit. Unlike the DTM,
which is bare ground, the DSM keeps:

- building roofs (the part we actually want for the heights);
- tree canopies, urban furniture, scaffolding;
- temporary obstacles present during the flight.

The naming convention encodes the tile origin: `32_67704930.ASC` →
**UTM zone 32**, easting block **6770** km, northing block **4930** km
(`XLLCENTER = 677446` lands inside the 6770xx × 4930xx square).

The dataset Leonardo shared splits the area in **three zips**
(`dsm_bologna-...-3-001/002/003.zip`) for a combined ~186 tiles. Together
they cover the Comune di Bologna with a few gaps where the LiDAR
campaign skipped strips. The full mosaic is what `gdalbuildvrt` stitches
in [§4 Pipeline](#4-pipeline), without copying a single byte.

---

### 3. Output

| File | Description |
|---|---|
| `web/public/data/processed/buildings_heights.geojson` | Building polygons with a numeric `height` field (m, from nDSM p95). Loaded by the viewer; falls back to `DEFAULT_BUILDING_HEIGHT = 15 m` for any footprint not covered by the DSM. |

Intermediate artefacts go under `data/` at the repo root (gitignored):

- `dsm_asc_list.txt` — list of `.ASC` tile paths, in **Windows form** when run on Windows (see [Windows gotchas](#6-windows-gotchas)).
- `dsm.vrt` — virtual raster mosaic of the DSM tiles.
- `dtm_aligned.tif` — DTM reprojected and resampled onto the DSM grid.
- `ndsm.tif` — `DSM − DTM` clamped to 0, BigTIFF Float32.
- `buildings_<srs>.geojson` — footprints reprojected to the DSM CRS for zonal stats without distortion.

---

### 4. Pipeline

Implemented in [`scripts/build_dsm_ndsm.sh`](../scripts/build_dsm_ndsm.sh):

1. **List the `.ASC` tiles** with `find`, write paths to `dsm_asc_list.txt`.
   On Windows the paths are converted to native form (`C:\...`) via `cygpath -w`
   so GDAL can read them.
2. **Build the VRT** with `gdalbuildvrt -a_srs ${DSM_SRS} -input_file_list ...` —
   a single virtual raster pointing at every tile, no copy.
3. **Read bbox + resolution** from `gdalinfo` on the VRT.
4. **Reproject + align the DTM** with
   `gdalwarp -t_srs ${DSM_SRS} -te ... -tr ... -r bilinear -co COMPRESS=DEFLATE -co BIGTIFF=YES`.
   Same grid as the DSM, ready for raster math.
5. **Compute nDSM** with `gdal_calc.py`:
   ```
   numpy.where((A > -9000) & (B > -9000), numpy.maximum(A - B, 0), -9999)
   ```
   with `--co=COMPRESS=DEFLATE --co=BIGTIFF=YES --type=Float32`. BigTIFF is
   mandatory — the output sits right at the 4 GB classic-TIFF ceiling.
6. **Reproject the footprints** to the raster CRS with `ogr2ogr -t_srs ${DSM_SRS}`.
   Zonal stats are computed in the raster CRS to avoid distortion.
7. **Zonal stats** via [`scripts/compute_building_heights.py`](../scripts/compute_building_heights.py)
   (rasterio + shapely + numpy): for each polygon, mask `ndsm.tif`, take the
   95th percentile of valid pixels, write back as `height`.

---

### 5. How to run

#### Linux / macOS

```bash
./scripts/build_dsm_ndsm.sh
```

#### Windows

The pipeline needs **GDAL** (from OSGeo4W) **and** **bash + cygpath** (from
Git for Windows). The two need to be reachable from the same shell.

Setup, once:

- Install OSGeo4W, or QGIS (which bundles GDAL).
- Install Git for Windows. Provides `bash.exe`, `cygpath`, the MSYS path
  conversion machinery.

Per run, from the **OSGeo4W Shell**:

```cmd
cd C:\path\to\UrbanScope3D
"C:\Program Files\Git\bin\bash.exe" scripts/build_dsm_ndsm.sh
```

The OSGeo4W Shell gives GDAL on PATH; `bash.exe` is invoked explicitly because
OSGeo4W Shell is `cmd`-based, not bash. The script handles MSYS path
conversion internally (see [Windows gotchas](#6-windows-gotchas)).

#### Environment overrides

| Variable | Default | When to change |
|---|---|---|
| `DSM_SRS` | `EPSG:25832` (ETRS89/UTM 32N) | The `.ASC` tiles ship without a `.prj`. Default is a reasonable guess for the region; if buildings end up offset by a few metres on the rendered map, retry with `EPSG:6707` (RDN2008/UTM32) or `EPSG:32632` (WGS84/UTM32N). |

#### Skipping completed steps

The script re-runs everything on each invocation. If a step has already
completed (intermediate files in `data/` exist and are valid), the remaining
commands can be invoked directly from the OSGeo4W Shell. Useful when the
slow step (`gdal_calc.py`, ~30-60 min) succeeded but the last step failed:

```cmd
:: nDSM only — note `python -m`, not `gdal_calc.py` directly (see gotcha #6.4)
python -m osgeo_utils.gdal_calc --overwrite ^
  -A data\dsm.vrt --A_band=1 ^
  -B data\dtm_aligned.tif --B_band=1 ^
  --outfile=data\ndsm.tif ^
  --calc="numpy.where((A>-9000)&(B>-9000), numpy.maximum(A-B,0), -9999)" ^
  --NoDataValue=-9999 --co=COMPRESS=DEFLATE --co=BIGTIFF=YES --type=Float32

:: reproject footprints
ogr2ogr -overwrite -f GeoJSON -t_srs EPSG:25832 ^
  "data\buildings_25832.geojson" ^
  "web\public\data\1)Buildings\1.1_Edifici_Particellari.geojson"

:: zonal stats
python scripts\compute_building_heights.py ^
  --ndsm data\ndsm.tif ^
  --buildings "data\buildings_25832.geojson" ^
  --out "web\public\data\processed\buildings_heights.geojson"
```

---

### 6. Windows gotchas

These were the issues hit while wiring the pipeline on Windows for the first
time. The script handles each one now, but they're documented here for the
next person who adapts it to another machine.

#### 6.1 `.sh` does not execute in `cmd` / OSGeo4W Shell

Typing `./scripts/build_dsm_ndsm.sh` in OSGeo4W Shell is interpreted as "open
this file with the default app for `.sh`". Windows pops a "How would you like
to open this file" dialog. **Do not pick any app** — that would associate
`.sh` files permanently with whatever you click.

Solution: invoke `bash.exe` explicitly.

```cmd
"C:\Program Files\Git\bin\bash.exe" scripts/build_dsm_ndsm.sh
```

#### 6.2 `cygpath` not in PATH when `bash.exe` is launched from cmd

When `bash.exe` is invoked from cmd / OSGeo4W Shell, it inherits the parent
shell's PATH and does **not** load `/usr/bin` automatically (where
`cygpath` lives in MSYS). `command -v cygpath` returns false and any
cygpath-dependent step silently falls back to the buggy branch.

The script prepends `/usr/bin` to PATH at the top of the LIST block as a
safety net:

```bash
if [[ -d "/usr/bin" ]] && [[ ":$PATH:" != *":/usr/bin:"* ]]; then
  export PATH="/usr/bin:$PATH"
fi
```

#### 6.3 MSYS paths (`/c/...`) not understood by GDAL

`find` under MSYS bash returns paths like `/c/Antonio/Projects/...`. When
those paths end up in a file read by GDAL (the `-input_file_list` of
`gdalbuildvrt`), GDAL receives them literally and fails with:

```
Warning 1: Can't open /c/Antonio/Projects/.../tile.ASC. Skipping it
```

MSYS only auto-converts paths in argv, not paths read from file content.

Solution in the script:

```bash
find "${DSM_RAW_ROOT}" -type f \( -iname '*.asc' \) -print0 \
  | xargs -0 -n1 cygpath -w > "${LIST}"
```

`cygpath -w /c/Antonio/...` → `C:\Antonio\...`, which is what GDAL expects.

#### 6.4 `.py` files in cmd: same association trap as `.sh`

Invoking `gdal_calc.py` directly from cmd opens the same "How would you like
to open this file" popup, because `.py` is not in `PATHEXT` by default. From
cmd, invoke as a Python module:

```cmd
python -m osgeo_utils.gdal_calc ...
```

This bypasses the file-association lookup entirely. The `.sh` script does not
hit this case because bash invokes `gdal_calc.py` via its shebang.

#### 6.5 Classic TIFF 4 GB limit

For Bologna, both `dtm_aligned.tif` and `ndsm.tif` are ~32k × 30k pixels at
Float32, which lands right around the 4 GB classic-TIFF ceiling. Symptom:

```
RuntimeError: TIFFAppendToStrip:Maximum TIFF file size exceeded.
Use BIGTIFF=YES creation option.
ERROR 1: ndsm.tif, band 1: An error occurred while writing a dirty block
```

`gdalwarp` and `gdal_calc.py` both carry `-co BIGTIFF=YES` /
`--co=BIGTIFF=YES` in the script. Note that the `gdalwarp` step may succeed
without BigTIFF if compression keeps the DTM under 4 GB — but it is included
defensively, since rerunning on a slightly larger AOI would push it over.

#### 6.6 Paths with `)` in cmd

The footprints live under `web\public\data\1)Buildings\...`. The `)`
character is special in `cmd`. Always wrap such paths in double quotes when
issuing commands manually from cmd.

---

### 7. Verification

After a successful run:

```cmd
dir web\public\data\processed\buildings_heights.geojson
```

Open the viewer (`npm run dev`) and sanity-check the extrusions:

- median building height in the historic centre should sit around 10-25 m;
- modern residential / industrial areas can spike to 30-50 m;
- buildings should align with their footprints (no systematic offset).

If the buildings appear offset by a few metres in a consistent direction, the
assumed `EPSG:25832` is wrong for the source tiles. Re-run with
`DSM_SRS=EPSG:6707` (set as an environment variable in your shell before
launching the script).

---

### 8. How it shows up in the 3D viewer

`buildings_heights.geojson` is a flat list of polygons in EPSG:4326 with a
single new attribute: `height` in metres. Everything downstream is the
viewer turning that number into pixels on screen.

#### The fetch + extrusion path

1. On mount, `MapViewer.tsx` issues a `HEAD` request for
   `/data/processed/buildings_heights.geojson`. If it answers `200`, the
   viewer swaps the building source from the bare footprint
   (`1.1_Edifici_Particellari.geojson`) to the height-augmented one. If
   it answers `404` (the pipeline hasn't been run yet, or the file is
   excluded from the deploy), the viewer keeps the footprint and the
   extrusion falls back to `DEFAULT_BUILDING_HEIGHT = 15 m`. Same code
   path, no special case.
2. The shadow-casting buildings layer is a deck.gl `GeoJsonLayer` with
   `extruded: true` and
   `getElevation: (f) => f.properties?.height ?? DEFAULT_BUILDING_HEIGHT`.
   deck.gl turns each polygon into a flat-roofed prism rising from
   `z = 0` (the basemap plane) to `z = height`.
3. The `MapboxOverlay` integration sits inside the same MapLibre canvas,
   so the extrusion participates in the shared sun light + cast shadows
   driven by the time slider (see
   [6_solar-position-evaluation.md](./6_solar-position-evaluation.md) and
   [7_shadow-workflow-evaluation.md](./7_shadow-workflow-evaluation.md)).

#### What the user actually notices

Before this pipeline, the historic centre looked like a uniform field of
15 m boxes — the Due Torri, San Petronio, residential blocks and church
roofs all matched the same height. After:

- the medieval towers tower; San Petronio's nave stands out from the
  neighbouring blocks;
- modern residential strips along the periphery (5–9 floors) lift above
  the older 3–4 floor centre;
- sun shadows at low elevation actually have something to fall against,
  which is the main reason the heights matter in the first place.

#### Where the visualization is honest, and where it isn't

- **Honest:** flat roofs, isolated buildings, courtyard blocks. The p95
  picks up the eave line and the extrusion matches the actual silhouette.
- **Less honest:** pitched roofs collapse to a flat slab at p95 height.
  The Falda layer from DBTR (Issue 1, deferred) is the right fix; until
  then a four-floor house with a steep tile roof looks like a flat-roof
  four-floor house with a slightly inflated parapet.
- **Watch out for:** courtyards. The footprint is one polygon, but the
  nDSM inside the courtyard reads zero (ground level), which drags p95
  down for buildings around a large central court. In practice this is
  rare in the AOI but worth flagging when comparing the rendered model
  to a photo.

The two viewer toggles that interact with this layer are **Edifici 3D +
ombre** (turns the extrusion on) and the time slider at the bottom of
the page (drives the shadows).

---

### 9. Open issues / next steps

- **CRS double-check.** The `.ASC` tiles ship without a `.prj`. The current
  `EPSG:25832` assumption matches the project area but isn't guaranteed; the
  fallback `EPSG:6707` (RDN2008/UTM32) is the next thing to try if anything
  looks off.
- **Coverage gaps.** The DSM covers the Comune di Bologna; footprints
  occasionally extend slightly beyond. Polygons with no nDSM coverage end up
  with `height = null` and the viewer falls back to
  `DEFAULT_BUILDING_HEIGHT`. Quantify how many footprints are affected once
  the first end-to-end run is complete.
- **Bake heights into the PMTiles.** Today the heights live in a separate
  GeoJSON loaded by the viewer alongside `buildings.pmtiles`. As a
  follow-up, fold `height` into the building features at the
  `preprocess_dbtr.py` step so the viewer only needs one source — see
  [2_data-packaging-strategy.md](./2_data-packaging-strategy.md).
- **Per-face roof shape.** The p95-per-footprint approach gives a single
  height per building (flat-roof approximation). The DBTR Falda layer
  (Issue 1, currently deferred) carries the actual roof slope geometry; an
  upgrade path would replace the scalar `height` with sloped roof faces,
  which mainly improves low-sun shadows
  (see [7_shadow-workflow-evaluation.md](./7_shadow-workflow-evaluation.md)).
- **Tighten the percentile choice.** p95 was picked as a default; p99
  preserves more chimneys, p90 ignores more noise. Worth comparing visually
  once the first dataset is in the viewer.

---

## Wind speed overlay

### Scope

Render the wind speed raster (`04_Velocita_Vento.tif`) as a coloured overlay on
top of the 3D viewer. The raster is small enough (~270 KB) that a tile pyramid
is overkill - a single colorised PNG mounted as a MapLibre
[`image` source](https://maplibre.org/maplibre-style-spec/sources/#image)
covers it.

---

### 1. Input

| File | Notes |
|---|---|
| `web/public/data/04_Velocita_Vento.tif` | Continuous wind-speed surface (m/s). Single-band float32 GeoTIFF, CRS declared in the file's own metadata. Source / time window to be confirmed before public release. |

---

### 2. Pipeline

[`scripts/build_wind_overlay.sh`](../scripts/build_wind_overlay.sh):

```
04_Velocita_Vento.tif
   |
   |  gdalwarp -t_srs EPSG:4326 -r bilinear -dstnodata 0
   v
wind_4326.tif                       <-- gdalinfo -mm: log of min/max for sanity
   |
   |  gdaldem color-relief -alpha   (viridis-like ramp, 0-6 m/s, see scripts file)
   v
wind_rgba.tif (RGBA)
   |
   |  gdal_translate -of PNG
   v
wind_overlay.png  +  wind_overlay.json
```

Both end up in `web/public/data/processed/`:

- `wind_overlay.png` - colorised raster, alpha-aware so `nodata` ends up transparent.
- `wind_overlay.json` - the four corners of the raster in WGS84 (lon, lat) plus
  the legend stops and the observed min/max, ready to be mounted as a MapLibre
  `image` source.

Example `wind_overlay.json`:

```json
{
  "source": "04_Velocita_Vento.tif",
  "unit": "m/s",
  "image": "/data/processed/wind_overlay.png",
  "minmax_observed": "0.31,5.84",
  "bounds": { "west": 11.30, "south": 44.46, "east": 11.39, "north": 44.52 },
  "coordinates": [
    [11.30, 44.52],
    [11.39, 44.52],
    [11.39, 44.46],
    [11.30, 44.46]
  ],
  "legend": [
    { "value": 0.5, "color": "#482371" },
    { "value": 1.5, "color": "#404387" },
    ...
  ]
}
```

---

### 3. Viewer integration

[`web/components/Map/MapViewer.tsx`](../web/components/Map/MapViewer.tsx) on
startup fetches `wind_overlay.json`. If the file exists:

- adds a MapLibre `image` source named `wind` with `coordinates` from the JSON,
- adds a `raster` layer `wind` with `raster-opacity: 0.65`, hidden by default,
- enables the "Velocita vento (m/s)" toggle in the layer panel.

If the JSON is missing (the build script has not been run yet) the checkbox is
shown disabled with a tooltip pointing back to the build script. The rest of
the viewer is unaffected.

---

### 4. How to run

Same prerequisites as the [building heights pipeline](#building-heights-pipeline-ndsm)
on the GDAL side; no Python step is needed here.

```bash
./scripts/build_wind_overlay.sh
```

Run from Git Bash / WSL / OSGeo4W shell at the repo root. Takes a couple of
seconds.

---

### 5. Design choices

- **`image` source, not tile pyramid.** The raster is tiny and Bologna fits in
  a single screen at the viewer's max zoom, so tiling would be ceremony for
  nothing. The four-corner mounting is exact.
- **Colour ramp fixed at 0-6 m/s.** Typical range for urban-scale mean wind in
  the plain. The script logs the actual min/max so the ramp can be retuned by
  editing the inline `wind_cmap.txt` heredoc if needed.
- **Reproject to EPSG:4326, not to 3857.** MapLibre's `image` source takes
  geographic coordinates for the corners; reprojecting to Web Mercator first
  would just add an extra step without changing the on-screen result.
- **Opacity 0.65.** Picks up the colour scale clearly without burying the
  street network and building extrusion underneath.

---

### 6. Limits / open issues

- The source raster's provenance and time window are not documented. Both the
  legend and the inventory note should be updated once those are confirmed.
- The legend in the layer panel is not rendered yet - only the toggle is.
  `wind_overlay.json` already carries the stops, so a small `<Legend>` panel
  would be a one-component addition.
- Single static raster. If we get a time series of wind speed snapshots, the
  same script can be parameterised with a date suffix and the viewer can pick
  between them.
