**Description**
Next round of viewer work after Issue 9. Focus is on interaction and
authoring: clearer click feedback, neighborhood perimeters, aligning the
Talea (ENVI-met) colours, terrain elevation, richer tree data, and giving
the user tools to add their own features (vegetation, street furniture,
point/line geometry). Plus weather, a print/screenshot button and social
sharing.

Two fixes already landed while opening this issue:
- ENVI-met overlays were flipped vertically (south-up grid georeferenced
  with a north-up affine). Corrected in `build_envimet_overlays.py`.
- Static export now built into `docs/` for GitHub Pages (folder source).

Tasks

Interaction / UI
- [ ] Change the click marker icon — the current one is hard to read.
- [ ] When a neighborhood is selected, also show its perimeter. If we don't
      want it always on, flash it for a few seconds after selection.
- [ ] Screenshot / print button.
  - [ ] Let the user choose whether the legend is included in the print.
- [ ] Share button for Instagram / social.

Microclimate (Talea / ENVI-met)
- [ ] Align the colour scales across the Talea overlays (consistent ramps
      and ranges so layers are comparable).

Terrain
- [ ] Handle terrain elevation. Pick the approach:
  - [ ] DTM–DSM, at least within the Talea square.
  - [ ] Elevation grid via 3D Tiles (quote / heights).

Vegetation
- [ ] Split trees into categories (evergreen vs deciduous).
  - [ ] Allow inspecting a single tree on click (popup with its attributes).

Authoring / editing
- [ ] Let the user add vegetation and street furniture to the scene.
- [ ] Evaluate point / line geometry editing so the user can add features.

Data
- [ ] Add weather (meteo).

Deliverables
[10_viewer-interaction-and-tools.md](https://github.com/dclfbk/UrbanScope3D/blob/main/documentation/10_viewer-interaction-and-tools.md)
