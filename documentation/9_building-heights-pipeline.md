# Building heights pipeline (nDSM)

## Scope

Compute real per-building heights from the Leonardo / FBK DSM by subtracting
the regional DTM, then attach those heights as a `height` property on the
Bologna building footprints. The output is consumed by the viewer's
`fill-extrusion-height` paint expression (see
[4_viewer-only-architecture.md](./4_viewer-only-architecture.md)).

Formula: `nDSM = max(DSM - DTM, 0)`, then per-feature
`height = percentile_95(nDSM ∩ footprint)`. The p95 dampens outliers (antennas,
chimneys, noise) while still tracking the actual roof line.

---

## 1. Inputs

| File | Source | Format | CRS | Size |
|---|---|---|---|---|
| `web/public/data/DatiLeonardo_8-05-2026/.../*.ASC` | Leonardo / FBK | ESRI ASCII Grid, ~186 tiles | EPSG:25832 (assumed, no `.prj` shipped) | ~6 GB |
| `web/public/data/3)Terrain-DEM/3.1_DTM_Bologna_2023.tif` | Geoportale ER (Issue 1) | GeoTIFF, 0.5 m | EPSG:7791 (RDN32) | 24 MB |
| `web/public/data/1)Buildings/1.1_Edifici_Particellari.geojson` | Open Data Bologna | GeoJSON polygons | EPSG:4326 | 29 MB |

---

## 2. Inside the `.ASC` tiles

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

## 3. Output

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

## 4. Pipeline

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

## 5. How to run

### Linux / macOS

```bash
./scripts/build_dsm_ndsm.sh
```

### Windows

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

### Environment overrides

| Variable | Default | When to change |
|---|---|---|
| `DSM_SRS` | `EPSG:25832` (ETRS89/UTM 32N) | The `.ASC` tiles ship without a `.prj`. Default is a reasonable guess for the region; if buildings end up offset by a few metres on the rendered map, retry with `EPSG:6707` (RDN2008/UTM32) or `EPSG:32632` (WGS84/UTM32N). |

### Skipping completed steps

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

## 6. Windows gotchas

These were the issues hit while wiring the pipeline on Windows for the first
time. The script handles each one now, but they're documented here for the
next person who adapts it to another machine.

### 6.1 `.sh` does not execute in `cmd` / OSGeo4W Shell

Typing `./scripts/build_dsm_ndsm.sh` in OSGeo4W Shell is interpreted as "open
this file with the default app for `.sh`". Windows pops a "How would you like
to open this file" dialog. **Do not pick any app** — that would associate
`.sh` files permanently with whatever you click.

Solution: invoke `bash.exe` explicitly.

```cmd
"C:\Program Files\Git\bin\bash.exe" scripts/build_dsm_ndsm.sh
```

### 6.2 `cygpath` not in PATH when `bash.exe` is launched from cmd

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

### 6.3 MSYS paths (`/c/...`) not understood by GDAL

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

### 6.4 `.py` files in cmd: same association trap as `.sh`

Invoking `gdal_calc.py` directly from cmd opens the same "How would you like
to open this file" popup, because `.py` is not in `PATHEXT` by default. From
cmd, invoke as a Python module:

```cmd
python -m osgeo_utils.gdal_calc ...
```

This bypasses the file-association lookup entirely. The `.sh` script does not
hit this case because bash invokes `gdal_calc.py` via its shebang.

### 6.5 Classic TIFF 4 GB limit

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

### 6.6 Paths with `)` in cmd

The footprints live under `web\public\data\1)Buildings\...`. The `)`
character is special in `cmd`. Always wrap such paths in double quotes when
issuing commands manually from cmd.

---

## 7. Verification

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

## 8. How it shows up in the 3D viewer

`buildings_heights.geojson` is a flat list of polygons in EPSG:4326 with a
single new attribute: `height` in metres. Everything downstream is the
viewer turning that number into pixels on screen.

### The fetch + extrusion path

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

### What the user actually notices

Before this pipeline, the historic centre looked like a uniform field of
15 m boxes — the Due Torri, San Petronio, residential blocks and church
roofs all matched the same height. After:

- the medieval towers tower; San Petronio's nave stands out from the
  neighbouring blocks;
- modern residential strips along the periphery (5–9 floors) lift above
  the older 3–4 floor centre;
- sun shadows at low elevation actually have something to fall against,
  which is the main reason the heights matter in the first place.

### Where the visualization is honest, and where it isn't

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

## 9. Open issues / next steps

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
