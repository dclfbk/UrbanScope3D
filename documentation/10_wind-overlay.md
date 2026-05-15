# Wind speed overlay

## Scope

Render the wind speed raster (`04_Velocita_Vento.tif`) as a coloured overlay on
top of the 3D viewer. The raster is small enough (~270 KB) that a tile pyramid
is overkill - a single colorised PNG mounted as a MapLibre
[`image` source](https://maplibre.org/maplibre-style-spec/sources/#image)
covers it.

---

## 1. Input

| File | Notes |
|---|---|
| `web/public/data/04_Velocita_Vento.tif` | Continuous wind-speed surface (m/s). Single-band float32 GeoTIFF, CRS declared in the file's own metadata. Source / time window to be confirmed before public release. |

---

## 2. Pipeline

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

## 3. Viewer integration

[`web/components/Map/MapViewer.tsx`](../web/components/Map/MapViewer.tsx) on
startup fetches `wind_overlay.json`. If the file exists:

- adds a MapLibre `image` source named `wind` with `coordinates` from the JSON,
- adds a `raster` layer `wind` with `raster-opacity: 0.65`, hidden by default,
- enables the "Velocita vento (m/s)" toggle in the layer panel.

If the JSON is missing (the build script has not been run yet) the checkbox is
shown disabled with a tooltip pointing back to the build script. The rest of
the viewer is unaffected.

---

## 4. How to run

Same prerequisites as [9_building-heights-pipeline.md](9_building-heights-pipeline.md)
on the GDAL side; no Python step is needed here.

```bash
./scripts/build_wind_overlay.sh
```

Run from Git Bash / WSL / OSGeo4W shell at the repo root. Takes a couple of
seconds.

---

## 5. Design choices

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

## 6. Limits / open issues

- The source raster's provenance and time window are not documented. Both the
  legend and the inventory note should be updated once those are confirmed.
- The legend in the layer panel is not rendered yet - only the toggle is.
  `wind_overlay.json` already carries the stops, so a small `<Legend>` panel
  would be a one-component addition.
- Single static raster. If we get a time series of wind speed snapshots, the
  same script can be parameterised with a date suffix and the viewer can pick
  between them.
