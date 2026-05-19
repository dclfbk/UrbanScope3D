#!/usr/bin/env python3
"""Build buildings_heights.geojson from the Open Data Bologna dataset.

Source: Comune di Bologna - SIT, "CARTA TECNICA COMUNALE - Edifici
volumetrici" (`c_a944ctc_edifici_pl`), CC BY 4.0. The dataset ships a
per-building eaves height (`altezza_gr`, ground -> roof edge, metres),
cross-checked by `quota_gron - quota_pied`.

This replaces the broken nDSM pipeline: the nDSM output collapsed to the
absolute terrain elevation (median ~61 m for Bologna) because the DTM
subtraction failed, and recomputing it needs a >100 GB raster. The Open
Data heights are correct (median ~10 m), cover the whole comune, and need
no heavy raster step.

Download the source once:

    curl -L -o data/edifici_pl_opendata.geojson \
      "https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/c_a944ctc_edifici_pl/exports/geojson?lang=it&timezone=Europe%2FRome"

Then:

    python scripts/build_building_heights_opendata.py

The viewer (`web/components/Map/MapViewer.tsx`) HEAD-checks
`/data/processed/buildings_heights.geojson` and, when present, swaps the
building source to it; the deck.gl extrusion reads `properties.height`
and falls back to `DEFAULT_BUILDING_HEIGHT = 15` for any feature without
a positive height.
"""
from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path

# Properties carried over for popups; everything else is dropped to keep
# the file light for the browser.
KEEP_PROPS = ("codice_ogg", "descrizion", "origine", "area_ogg", "volume")
COORD_DECIMALS = 6  # ~0.1 m at Bologna's latitude; trims the file noticeably


def round_coords(geom: dict) -> dict:
    def r(c):
        if isinstance(c, (int, float)):
            return round(c, COORD_DECIMALS)
        return [r(x) for x in c]

    geom["coordinates"] = r(geom["coordinates"])
    return geom


def building_height(props: dict) -> float | None:
    """Eaves height in metres, or None when the source has no usable value
    (viewer then falls back to DEFAULT_BUILDING_HEIGHT)."""
    h = props.get("altezza_gr")
    if isinstance(h, (int, float)) and h > 0:
        return round(float(h), 2)
    # altezza_gr missing/zero: reconstruct from the elevation pair.
    g, p = props.get("quota_gron"), props.get("quota_pied")
    if isinstance(g, (int, float)) and isinstance(p, (int, float)) and g - p > 0:
        return round(float(g - p), 2)
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/edifici_pl_opendata.geojson")
    ap.add_argument(
        "--out", default="web/public/data/processed/buildings_heights.geojson"
    )
    args = ap.parse_args()

    src = json.loads(Path(args.src).read_text(encoding="utf-8"))
    out_features = []
    heights = []
    no_height = 0

    for feat in src.get("features", []):
        geom = feat.get("geometry")
        if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        props = feat.get("properties", {})
        h = building_height(props)
        if h is None:
            no_height += 1
        else:
            heights.append(h)

        new_props = {k: props.get(k) for k in KEEP_PROPS if props.get(k) is not None}
        if h is not None:
            new_props["height"] = h
            new_props["height_source"] = "opendata-bologna-altezza_gr"

        out_features.append(
            {
                "type": "Feature",
                "properties": new_props,
                "geometry": round_coords(geom),
            }
        )

    out = {"type": "FeatureCollection", "features": out_features}
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    n = len(out_features)
    print(f"features written : {n}")
    print(f"  with height     : {len(heights)}")
    print(f"  no height (->15): {no_height}")
    if heights:
        print(
            "  height m: min %.1f  median %.1f  mean %.1f  max %.1f"
            % (
                min(heights),
                statistics.median(heights),
                statistics.mean(heights),
                max(heights),
            )
        )
    print(f"output: {out_path}  ({out_path.stat().st_size/1e6:.1f} MB)")


if __name__ == "__main__":
    main()
