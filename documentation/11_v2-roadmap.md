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
| TODO | Per-building heights from DSM/DTM (nDSM) or from Open Data Bologna | [9_building-heights-pipeline.md](./9_building-heights-pipeline.md) / OD Bologna |
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
