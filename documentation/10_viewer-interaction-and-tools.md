# Prototype v3 - interaction & authoring

## Scope

Issue 9 grew the viewer's data side (building heights, microclimate, noise,
quartieri). Issue 10 is mostly about the *interaction* side: clearer click
feedback, neighborhood perimeters, consistent Talea colours, terrain
elevation, richer trees, and giving the user tools to drop their own things
on the map (vegetation, urban furniture, point/line geometry). Plus weather,
a print button and social sharing.

Same shape as the Issue 9 doc: a status table per area, and each big item
grows its own note once it's picked up. Sections below marked *da compilare*
are placeholders — filled in as the work lands.

---

## Already done

### ENVI-met overlays were upside down

The Talea overlays were flipped vertically. ENVI-met exports its grid
*south-up* (row 0 = south edge of the domain), but the pipeline borrows the
affine from the old wind GeoTIFF, which is *north-up* (row 0 = north). So
every overlay — temperature, humidity, radiation, MRT, LAD — was mirrored
top-to-bottom, and the piazza didn't line up with the data.

Checked it instead of eyeballing: in the ENVI-met rasters the buildings are
NoData, so the NoData mask is basically the building footprints. Compared
that mask against the real Open Data footprints (IoU) in four orientations:

| orientation | IoU vs real buildings |
|---|---|
| as-is | 0.27 |
| **vertical flip** | **0.74** |
| horizontal flip | 0.26 |
| 180° | 0.27 |

Vertical flip wins, no contest. Fix is one `np.flipud(b)` in
`build_envimet_overlays.py`, right after reading the band and before the
mask — so the PNG, the `.values.json` click grid and the per-building
`air_temp` sampling all inherit the correct orientation from one place.
Regenerated all overlays; the values grid now matches the footprints at the
same IoU 0.74.

### Static site moved into `docs/` for GitHub Pages

Pages serves the `/docs` folder on `main`, so the built viewer lives there
now. Build is `output: 'export'` with `NEXT_PUBLIC_BASE_PATH=/UrbanScope3D`.

`web/public/data` is ~11 GB (raw DSM, zips, shapefiles) — can't go in git.
Only the files the viewer actually fetches at runtime are copied into
`docs/data/` (the runtime set is the one already described in
`web/.vercelignore`): `processed/`, the building footprints + heights, the
AOI land-use, trees, green, parks, private green, the temperature CSV. About
186 MB total, largest file 43 MB (under GitHub's 100 MB limit). A `.nojekyll`
file is added so Pages doesn't strip the `_next/` folder.

To enable: repo Settings → Pages → Source = *Deploy from a branch* → `main`
/ `docs`.

---

## Interaction / UI

| Status | Item |
|---|---|
| TODO | Change the click marker icon — current one is hard to read |
| TODO | On neighborhood select, show its perimeter (always, or flash for a few seconds) |
| TODO | Screenshot / print button |
| TODO | Legend on/off when printing |
| TODO | Share to Instagram / social |

Notes:

- Click marker: the current pin is unclear at click. Want something that
  reads against both the dark and the satellite basemap.
- Perimeter: the quartieri polygons are already loaded
  (`processed/quartieri.geojson`). Outline the selected one with a line
  layer; if it's noisy to keep on, fade it out after ~3 s.
- Print: MapLibre canvas + the deck.gl overlay need to be captured together.
  `preserveDrawingBuffer` on the GL context, then compose with the legend
  panel (or not) into one PNG.

---

## Microclimate (Talea / ENVI-met)

| Status | Item |
|---|---|
| TODO | Align colour scales across the Talea overlays |

Right now each overlay stretches its own 2–98 percentile range, so the
colours aren't comparable between variables (and between this and any future
sim). Decide fixed ranges per variable (or per family: temps, radiation,
humidity) so the same colour means the same value everywhere. Ramps live in
`build_envimet_overlays.py` (`RAMPS`) and the legends in `overlays.json`.

*da compilare* — chosen fixed ranges per variable.

---

## Terrain

| Status | Item |
|---|---|
| TODO | DTM–DSM elevation, at least within the Talea square |
| TODO | Elevation grid via 3D Tiles |

The open problem from Issue 9: MapLibre terrain sinks the deck.gl buildings
(they sit at z=0, not on the DEM). Two routes:

- **DTM–DSM**, scoped to the Talea square first — small enough to offset each
  building by its terrain base without a comune-wide DEM step.
- **3D Tiles** elevation grid (quote) — heavier, but the general fix.

*da compilare* — which route, and how buildings get their per-base offset.

---

## Vegetation

| Status | Item |
|---|---|
| TODO | Split trees into evergreen vs deciduous |
| TODO | Inspect a single tree on click |

Trees are the DBTR points (`2.1_trees_aoi.geojson`) drawn as procedural firs.
Need a species → evergreen/deciduous mapping to colour or shape them
differently (and it matters for shadows in winter). Click-to-inspect = a
popup with the tree's attributes, like the air stations already do.

*da compilare* — species field used and the evergreen/deciduous mapping.

---

## Authoring / editing

| Status | Item |
|---|---|
| TODO | User adds vegetation and street furniture |
| TODO | Point / line geometry editing |

This is the biggest shift: the viewer stops being read-only. User drops a
tree / bench / lamp (point), or draws a path / barrier (line), and it renders
in the scene. Open question is persistence — local only (browser), or export
the edits as GeoJSON to hand back.

*da compilare* — editing library (e.g. Mapbox GL Draw / Terra Draw), the
catalogue of placeable furniture, and whether edits persist.

---

## Data

| Status | Item |
|---|---|
| TODO | Add weather (meteo) |

Live or recent weather for Bologna (temp, wind, conditions) next to the
existing time slider. Pick a source (e.g. Open-Meteo, free, no key) and
decide whether it drives anything (sun/shadows already come from the date) or
is just shown.

*da compilare* — weather source and what it feeds.

---

## Open questions

| Status | Question |
|---|---|
| TODO | Talea colours: fixed range per variable, or per family? |
| TODO | Terrain: DTM–DSM offset per building vs full 3D Tiles? |
| TODO | User edits: keep in-browser or export as GeoJSON? |
| TODO | Print: include the basemap attribution + north arrow in the export? |
