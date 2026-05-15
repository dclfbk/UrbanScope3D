# Building heights pipeline (DSM - DTM)

## Scope

Until now the 3D viewer extruded every building at a fixed `DEFAULT_BUILDING_HEIGHT = 15 m`
(see [`web/components/Map/MapViewer.tsx`](../web/components/Map/MapViewer.tsx)). That looks
flat and wrong, especially in the historic centre where heights vary widely.

This pipeline produces a per-building height from the **Digital Surface Model**
shared by Leonardo, subtracts the **DTM** already in use for the terrain, and
attaches the result as a `height` property on each footprint feature.

End result: the viewer's existing extrusion layer reads `feature.properties.height`
and falls back to the old constant only where the DSM does not cover a footprint.

---

## 1. Input

| File / folder | Origin | Notes |
|---|---|---|
| `web/public/data/DatiLeonardo_8-05-2026/dsm_bologna-*/dsm_bologna/*.ASC` | Shared via WeTransfer by Leonardo (FBK). Tile origin: CTR Emilia-Romagna 2023 LiDAR (same campaign as the DTM). | ~500 ESRI ASCII Grid tiles, 0.5 m cells, header `XLLCENTER / YLLCENTER` in UTM 32N. No `.prj` shipped. |
| `web/public/data/3)Terrain-DEM/3.1_DTM_Bologna_2023.tif` | Geoportale ER WCS (`dtm_comune_bo_2023`) | 0.5 m DTM, EPSG:7791 (RDN32) / ITALGEO2005. Already used in [7_shadow-workflow-evaluation.md](7_shadow-workflow-evaluation.md). |
| `web/public/data/1)Buildings/1.1_Edifici_Particellari.geojson` | Open Data Bologna `rifter_edif_pl` | Polygon footprints in EPSG:4326, used as zonal-stats sampling shapes. |

DSM raw weight is ~6 GB, kept locally and gitignored (see root `.gitignore`).

---

## 2. Pipeline

Two scripts under `scripts/`. The bash part orchestrates GDAL CLI; the heavy
lifting on footprints happens in Python (rasterio + shapely) for memory reasons.

```
.ASC tiles
   |
   |  gdalbuildvrt  (no copy, lazy mosaic; -a_srs EPSG:25832 by default)
   v
dsm.vrt  ----------------------------------+
                                           |
3.1_DTM_Bologna_2023.tif                   |
   |  gdalwarp -te <DSM bbox> -tr <res>    |
   |  (snaps DTM onto the DSM grid)        |
   v                                       |
dtm_aligned.tif                            |
   |                                       |
   +-----  gdal_calc.py  nDSM = max(DSM - DTM, 0)  <----+
                          (preserves -9999 nodata)
                                |
                                v
                          ndsm.tif
                                |
1.1_Edifici_Particellari.geojson|
   |  ogr2ogr -t_srs EPSG:25832 |
   v                            |
buildings_<srs>.geojson         |
                                |
                                +----+
                                     |
                                     v
                  compute_building_heights.py
                  (windowed read per feature,
                   rasterize footprint, p95 of nDSM)
                                     |
                                     v
                  buildings_heights.geojson    (EPSG:4326)
                  property `height` per feature
                  property `height_source` = "ndsm-p95" | "default"
```

Files involved:

- [`scripts/build_dsm_ndsm.sh`](../scripts/build_dsm_ndsm.sh) - orchestration.
- [`scripts/compute_building_heights.py`](../scripts/compute_building_heights.py) - zonal statistics.

---

## 3. Output

`web/public/data/processed/buildings_heights.geojson` - GeoJSON FeatureCollection
in EPSG:4326, one feature per input footprint, with:

- `height` (number, metres): 95th percentile of nDSM pixels inside the footprint.
- `height_source` (string): `ndsm-p95` if the pixel sample was large enough,
  otherwise `default` (means the building falls outside the DSM coverage or has
  too few valid pixels, and the viewer falls back to 15 m).

The viewer auto-detects this file at startup (HEAD probe on the URL); if it is
missing the extrusion layer keeps loading `1.1_Edifici_Particellari.geojson` and
uses the constant fallback.

---

## 4. How to run

### Prerequisites

GDAL CLI **and** a Python environment with `rasterio`, `numpy`, `shapely`, `pyproj`.

On Windows the simplest path is conda-forge:

```bash
conda create -n urbanscope -c conda-forge python=3.12 gdal rasterio numpy shapely pyproj
conda activate urbanscope
```

Alternatively: OSGeo4W installer for GDAL + `pip install rasterio numpy shapely pyproj`.

### Run

From the repo root, in **Git Bash**, **WSL**, or **OSGeo4W shell** (PowerShell
does not execute these scripts as-is):

```bash
./scripts/build_dsm_ndsm.sh
```

If the DSM tiles look offset by a few metres against the footprints, the source
CRS guess was wrong - re-run forcing one of the other UTM 32 variants:

```bash
DSM_SRS=EPSG:6707  ./scripts/build_dsm_ndsm.sh   # RDN2008 / UTM 32
DSM_SRS=EPSG:32632 ./scripts/build_dsm_ndsm.sh   # WGS84 / UTM 32N
```

Intermediate files (`dsm.vrt`, `dtm_aligned.tif`, `ndsm.tif`, reprojected
footprints) land in `./data/` and are ignored by git.

---

## 5. Design choices

- **95th percentile, not max.** A `max` over the footprint reacts to chimneys,
  antennae, isolated outliers - the building looks artificially tall. p95 keeps
  the eave/ridge area while ignoring the top 5% of pixels.
- **`max(DSM - DTM, 0)`.** Negative differences (sub-DTM noise on bridges,
  borders) get clipped to zero so they cannot collapse a building.
- **`min-height = 2 m` floor.** Anything below 2 m is treated as a sampling
  artefact and the feature falls back to the default. Configurable.
- **EPSG:25832 default for the DSM.** No `.prj` is shipped with the tiles.
  Header coordinates (e.g. `XLLCENTER 677446.25`, `YLLCENTER 4930121.75`) are
  consistent with UTM 32 N. ETRS89/UTM32N is the standard CRS for ER CTR
  products of this generation; if Leonardo's source was RDN2008 the offset is
  in the sub-metre range and the `DSM_SRS` override fixes it.
- **Windowed read per feature.** Reading the full nDSM (~100M+ pixels) into
  memory and rasterising every footprint against it is wasteful and slow.
  Rasterio's window-from-bounds + `rasterize` on a tile-sized array keeps the
  Python step within a few minutes on a laptop.

---

## 6. Limits / open issues

- Coverage is whatever Leonardo shared, not the full Comune. Buildings outside
  the DSM extent get `height_source = "default"`. To extend it we need either
  more tiles from the same campaign or a parallel run on the regional DSM.
- p95 averages out balconies and irregular roof shapes - a `roof_max` per
  building (different stat) would be a small change, but is not exposed yet.
- Vertical datum: the DTM is on ITALGEO2005, the DSM header does not declare a
  datum. The difference is preserved by subtraction, but absolute heights are
  only meaningful if the two share the datum (assumed true for now).
- The output GeoJSON keeps all original properties unmodified. If the source
  changes (e.g. we move to `1.5_DBTR_Cassone_Edilizio` after the rewrap, see
  [2_data-packaging-strategy.md](2_data-packaging-strategy.md)) the script
  works the same as long as the input is a polygon FeatureCollection.
