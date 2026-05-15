"""
compute_building_heights.py
Per ogni edificio del GeoJSON in input (nello stesso CRS del raster nDSM),
estrae il 95-esimo percentile dei pixel coperti dal footprint e lo scrive
come property `height` (metri). Output sempre riproiettato in EPSG:4326,
pronto per MapLibre/deck.gl.

Lettura per-feature in finestra (window read) per restare leggero anche su
DSM ad alta risoluzione (0.5 m).

Dipendenze:
    pip install rasterio numpy shapely pyproj
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.windows import from_bounds
from shapely.geometry import mapping, shape
from shapely.ops import transform as shp_transform
import pyproj


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--ndsm", required=True, help="Raster nDSM (GTiff)")
    p.add_argument("--buildings", required=True, help="GeoJSON edifici nel CRS del raster")
    p.add_argument("--out", required=True, help="GeoJSON output (EPSG:4326)")
    p.add_argument("--percentile", type=float, default=95.0)
    p.add_argument("--default-height", type=float, default=15.0)
    p.add_argument("--min-pixels", type=int, default=5,
                   help="Sotto questa soglia di pixel validi uso default-height")
    p.add_argument("--min-height", type=float, default=2.0,
                   help="Sotto questa altezza ricado su default-height (probabile rumore)")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    fc = json.loads(Path(args.buildings).read_text(encoding="utf-8"))
    features_in = fc.get("features", [])
    if not features_in:
        raise SystemExit(f"[!] nessuna feature in {args.buildings}")

    out_features: list[dict] = []
    n_real, n_fallback = 0, 0

    with rasterio.open(args.ndsm) as src:
        nodata = src.nodata if src.nodata is not None else -9999
        raster_crs = src.crs
        src_w, src_h = src.width, src.height
        to_4326 = pyproj.Transformer.from_crs(
            raster_crs, "EPSG:4326", always_xy=True
        ).transform

        for feat in features_in:
            geom_raw = feat.get("geometry")
            if not geom_raw:
                continue
            geom = shape(geom_raw)
            if geom.is_empty:
                continue

            minx, miny, maxx, maxy = geom.bounds
            try:
                window = from_bounds(minx, miny, maxx, maxy, transform=src.transform)
                window = window.round_lengths().round_offsets()
            except Exception:
                window = None

            height_val = args.default_height
            used_fallback = True

            if window is not None and window.width > 0 and window.height > 0:
                col_off = max(0, int(window.col_off))
                row_off = max(0, int(window.row_off))
                col_end = min(src_w, int(window.col_off) + int(window.width))
                row_end = min(src_h, int(window.row_off) + int(window.height))
                if col_end > col_off and row_end > row_off:
                    win = rasterio.windows.Window(
                        col_off, row_off, col_end - col_off, row_end - row_off
                    )
                    data = src.read(1, window=win)
                    win_transform = src.window_transform(win)
                    mask = rasterize(
                        [(geom, 1)],
                        out_shape=data.shape,
                        transform=win_transform,
                        fill=0,
                        dtype="uint8",
                        all_touched=True,
                    )
                    values = data[mask == 1]
                    values = values[(values != nodata) & np.isfinite(values)]
                    if values.size >= args.min_pixels:
                        h = float(np.percentile(values, args.percentile))
                        if np.isfinite(h) and h >= args.min_height:
                            height_val = h
                            used_fallback = False

            if used_fallback:
                n_fallback += 1
            else:
                n_real += 1

            props = dict(feat.get("properties") or {})
            props["height"] = round(height_val, 2)
            props["height_source"] = "ndsm-p95" if not used_fallback else "default"

            out_features.append({
                "type": "Feature",
                "properties": props,
                "geometry": mapping(shp_transform(to_4326, geom)),
            })

    out_fc = {"type": "FeatureCollection", "features": out_features}
    Path(args.out).write_text(json.dumps(out_fc, ensure_ascii=False), encoding="utf-8")
    total = len(out_features)
    print(f"[ndsm] scritti {total} edifici "
          f"(p{args.percentile:g}: {n_real}, fallback default: {n_fallback}) -> {args.out}")


if __name__ == "__main__":
    main()
