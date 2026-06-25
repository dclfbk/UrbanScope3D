# Prototype v3 - interaction & authoring

## Scope

Prototype v2 (doc 9) grew the viewer's data side (building heights,
microclimate, noise, quartieri). This round is mostly about the *interaction*
side: clearer click feedback, neighborhood perimeters, consistent Talea
colours, terrain elevation, richer trees, and giving the user tools to drop
their own things on the map (vegetation, urban furniture, point/line
geometry). Plus weather, a print button and social sharing.

Same shape as doc 9: a status table per area, and each big item grows its own
note once it's picked up.

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
| DONE | Change the click marker icon — current one is hard to read |
| DONE | On neighborhood select, show its perimeter (always, or flash for a few seconds) |
| DONE | Screenshot / print button |
| TODO | Legend on/off when printing |
| DONE | Share to Instagram / social |

Notes:

- Click marker: the current pin is unclear at click. Want something that
  reads against both the dark and the satellite basemap.
- Perimeter: the quartieri polygons are already loaded
  (`processed/quartieri.geojson`). Outline the selected one with a line
  layer; if it's noisy to keep on, fade it out after ~3 s.
- Print: MapLibre canvas + the deck.gl overlay need to be captured together.
  `preserveDrawingBuffer` on the GL context, then compose with the legend
  panel (or not) into one PNG. **Done** (`composeSceneBlob` in `MapViewer.tsx`):
  draws every `<canvas>` in the container onto one 2D canvas → PNG. Captures
  *only* the canvases, so the DOM panels (incl. the legend) never end up in the
  shot — the image is always clean. The "legend on/off in the export" is still
  TODO: it would mean *drawing* the legend into the PNG, which isn't done yet.
- Share (DONE): same `composeSceneBlob`, then the Web Share API. Prefers sharing
  the image **file** (`navigator.canShare({files})` → on mobile opens the native
  sheet, so Instagram/WhatsApp/… work); falls back to sharing the page URL, then
  on desktop to downloading the PNG + copying the link (with a toast). The share
  icon sits next to the screenshot button, bottom-left.

---

## Microclimate (Talea / ENVI-met)

| Status | Item |
|---|---|
| DONE | Align colour scales across the Talea overlays |

Each overlay used to stretch its own 2–98 percentile range, so the colours
weren't comparable between variables (or between this sim and any future one).
Now `build_envimet_overlays.py` has a `FIXED_RANGES` table: fixed `(vmin, vmax)`
per variable, so the same colour means the same value everywhere and the legend
is stable across sims. Variables not in the table fall back to the old 2–98
percentile (`range_mode` is recorded per overlay in `overlays.json`).

Chosen **per-variable** (not per-family): air temp and MRT are both °C but on
very different scales (MRT in the sun climbs much higher), and the three SW
radiation bands differ ~5× in magnitude — sharing one scale would flatten the
contrast. To compare across the radiation trio, read the legend numbers.

Fixed ranges (envelopes that cover the observed 2024-07-27 11:00 data with a
little headroom for future sims):

| variable | unit | observed | fixed range |
|---|---|---|---|
| temperature | °C | 29.8–36.0 | **24–40** |
| humidity | % | 34.6–47.2 | **30–70** |
| vegetation_lad | m²/m³ | 0–0.3 | **0–0.5** |
| direct_sw | W/m² | 0–988 | **0–1000** |
| diffuse_sw | W/m² | 0–118 | **0–200** |
| reflected_sw | W/m² | 17–383 | **0–400** |
| mean_radiant_temp | °C | 26–80 | **20–80** |

---

## Terrain

| Status | Item |
|---|---|
| DONE | Terrain elevation across the whole view |
| — | Elevation grid via 3D Tiles (not needed — see below) |

The open problem from doc 9 was that MapLibre terrain sank the deck.gl
buildings (they sat at z=0, not on the DEM). Solved with **MapLibre
`setTerrain` + a self-hosted Terrarium DEM** (`scripts/download_terrain_tiles.py`,
z11–15, served same-origin to dodge the S3 CORS issue), and by **baking each
feature's ground elevation into its z** (`scripts/bake_terrain_elevation.py`
writes z into `buildings_heights.geojson` and the trees): deck reads the vertex
z as the extrusion base, so buildings/trees sit on the terrain. 3D-Tiles route
dropped — the `setTerrain` + baked-z path already works.

ENVI-met overlays follow the same terrain: they are **draped as a MapLibre
`image` source** (not a flat deck plane), so at low quotas the ~26 m of terrain
relief inside the domain no longer pokes through the data.

---

## Vegetation

| Status | Item |
|---|---|
| DONE | Split trees into evergreen vs deciduous |
| DONE | Inspect a single tree on click |

Trees are the DBTR points (`2.1_trees_aoi.geojson`) drawn as procedural firs.
Need a species → evergreen/deciduous mapping to colour or shape them
differently (and it matters for shadows in winter). Click-to-inspect = a
popup with the tree's attributes, like the air stations already do.

*da compilare* — species field used and the evergreen/deciduous mapping.

---

## Authoring / editing

| Status | Item |
|---|---|
| DONE | User adds vegetation and street furniture |
| DONE | Point / line geometry editing |

The viewer is no longer read-only. An "＋ Aggiungi" toolbar (bottom-right) lets
the user place objects: **point tools** (tree / bench / bin / fountain / lamp /
bollard — one click) and **line tools** (tree row / hedge / railing — two clicks
fill the segment). Implemented in `MapViewer.tsx` (`INSERT_TOOLS`, `lineBetween`,
`buildPlacedLayers`; the map click handler routes through `insertToolRef` /
`lineStartRef`, z from `map.queryTerrainElevation`). Reuses the same 3D meshes as
the trees/arredo layers. **Persistence: session-only** (not saved/exported yet) —
that's the next open item, together with rotation and selective deletion.

The placeable furniture also has real data behind it: the **Comune di Bologna
open datasets** for trees (`alberi-manutenzioni`) and street furniture (`arredo`)
are downloaded and rendered as 3D objects — see doc 14.

---

## Data

| Status | Item |
|---|---|
| DONE | Add weather (meteo) |

Live weather for Bologna shown in a panel (⛅ button, bottom-left). Source:
**3BMeteo** (user's choice) — it has no free JSON API, only an embeddable
widget from their builder, so we host the official iframe (module
`localita_1_giorno_compatto`, località 8841 = Bologna, colours set to white +
Talea blue). `MeteoWidget.tsx` renders the iframe + the required "Meteo"
backlink. It's display-only: it does **not** drive sun/shadows (those still come
from the date in the time slider). If we ever want it to feed the scene, we'd
need a JSON source (e.g. Open-Meteo) instead of the widget.

---

## Recent changes (June 2026)

- **Brand font** — the real **Calibre Semibold** (Talea licence, web font) is now
  in `web/public/fonts/` and wired via `next/font/local`; Hanken Grotesk is the
  fallback. See the brand guideline (doc / PDF).
- **Default basemap is now light** ("Mappa" = Carto Voyager) instead of the dark
  one, so the map no longer reads as a dark background. Label whitening is kept
  for the Dark basemap only.
- **ENVI-met overlay draped on terrain** — was a flat deck plane that got pierced
  by the terrain at low quotas (the domain has ~26 m of relief). Now a MapLibre
  `image` source that follows the terrain per-pixel. The height slider switches
  the image; the clicked-point marker is the ground DOM marker.
- **No-data shown as soft green** — the ENVI-met `NoData` cells are filled with a
  pale sage green (`build_envimet_overlays.py`, `colorize`) instead of being
  transparent, so the domain has no holes.
- **Street furniture popup** — title is now a localized category (Fontana /
  Panchina / …); the ~3 800 items the Comune left unclassified (added in 2004,
  no type field) just read "Arredo urbano / Street furniture".
- **Map labels raised** above the 3D buildings (`raiseMapLabels`).

### Microclimate 3D + UI (late June 2026)

This batch **supersedes** two earlier bullets above: the default basemap is now
**Dark** again, and the ENVI-met overlay is no longer terrain-draped — it is a
**raised sheet**.

- **Default basemap → Dark.** `useState('dark')`. The campagna-green background
  tint (`tintBasemapBackground`) applies to the Dark basemap only; the light
  ("Mappa"/Voyager) basemap is left untouched.
- **White fog veil removed.** MapLibre's sky `fog-color` defaults to `#ffffff`
  and "requires 3D terrain": once the terrain was added it laid a milky white
  film over the whole scene. In `lib/sky.ts` the fog/atmosphere is now ~off by
  day (`horizon-fog-blend 0`, `atmosphere-blend 0`). Day **ambient light** also
  lowered `1.5 → 1.05` (it was washing the buildings out).
- **ENVI-met overlay = raised sheet ("foglio che sale").** It is now a deck.gl
  `BitmapLayer` placed at `ENV_GROUND_ELEV (56.9 m) + band quota`, so the height
  slider physically lifts it in 3D. `ENV_GROUND_ELEV` = `ground_elev` from
  `overlays.json`; terrain exaggeration is 1, so deck metres match the terrain.
  - The sheet is flat and rendered with `depthCompare: 'always'` so that where
    the terrain is higher than the band quota it is **drawn on top** instead of
    being hidden (the "first few metres were cut off" problem). Trade-off: from
    an oblique angle the flat sheet can overdraw terrain/buildings in front of
    it (X-ray); a terrain-hugging tessellated mesh is the future fix.
  - **Slider fix:** the old MapLibre `image` source reused the same source id,
    so the terrain texture cache never refreshed and the quota "didn't change".
    The BitmapLayer rebuilds per band, so it updates reliably.
- **Auto-frame from above.** Selecting a microclimate overlay (`selectEnv`) **or**
  "Edifici → temperatura" flies the camera over the ENVI-met domain top-down
  (`flyToEnvDomain`, pitch 0) so the user doesn't have to hunt for the data square.
- **Clicked-point marker on the sheet.** A flat deck.gl disc (`env-probe-dot`,
  Talea blue) sits on the raised sheet at its quota; the ground DOM marker is
  hidden while a sheet is active (otherwise it would stay on the terrain below).
- **Green layers deduped.** "Parchi" was the **same 5044 features** as "Aree
  verdi" (just fewer attributes) → removed. Only **Aree verdi** (`green.geojson`)
  is kept.
- **Default layers:** Buildings 3D + Aree verdi + Verde privato **ON**; Alberi
  and Arredo urbano **OFF** (trees are ~100k instances; furniture on demand).
- **Layers panel:** removed the "Click on the map → temperature / wind" hint.
- **Share** now always uses the **production** GitHub Pages URL
  (`https://dclfbk.github.io/UrbanScope3D/`) instead of `window.location.href`,
  and includes it even when sharing the rendered image.
- **UI tweaks:** the Zone (districts) toggle moved a bit right of the search bar;
  the legend raised (`bottom-24`) with a capped height so it covers neither the
  "Aggiungi" toolbar nor the height-slider panel.

## Open questions

| Status | Question |
|---|---|
| DONE | Talea colours: fixed range **per variable** (see Microclimate section) |
| DONE | Terrain: `setTerrain` + baked-z per feature (3D Tiles not needed) |
| TODO | User edits: keep in-browser or export as GeoJSON? (currently session-only) |
| TODO | Print: include the basemap attribution + north arrow in the export? |
