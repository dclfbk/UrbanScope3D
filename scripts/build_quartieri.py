#!/usr/bin/env python3
"""Build quartieri.geojson from the Open Data Bologna "aree statistiche".

Source: Comune di Bologna - "Aree statistiche" (dataset
`aree-statistiche`), 90 polygons covering the comune, each tagged with
`cod_quar` (11..16) and `quartiere` (the 6 administrative districts).

This script groups the 90 polygons by `cod_quar` into 6 MultiPolygon
features (one per quartiere). It does NOT geometrically dissolve the
shared boundaries between adjacent areas of the same quartiere -- they
already coincide, and for the viewer's extrusion the visual result is
identical.

Download the source once:

    curl -L -o data/aree_statistiche_opendata.geojson \\
      "https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/aree-statistiche/exports/geojson?lang=it&timezone=Europe%2FRome"

Then:

    python scripts/build_quartieri.py
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

COORD_DECIMALS = 5  # ~1 m at Bologna's latitude; plenty for a quartiere outline


def round_coords(coords):
    if isinstance(coords, (int, float)):
        return round(coords, COORD_DECIMALS)
    return [round_coords(x) for x in coords]


def polygon_rings(geom: dict):
    """Yield each polygon's ring list from a Polygon or MultiPolygon."""
    t = geom.get("type")
    if t == "Polygon":
        yield geom["coordinates"]
    elif t == "MultiPolygon":
        for poly in geom["coordinates"]:
            yield poly


def bbox_for(coords_list) -> list[float]:
    minlon = minlat = float("inf")
    maxlon = maxlat = float("-inf")
    for poly in coords_list:
        for ring in poly:
            for x, y in ring:
                if x < minlon: minlon = x
                if x > maxlon: maxlon = x
                if y < minlat: minlat = y
                if y > maxlat: maxlat = y
    return [minlon, minlat, maxlon, maxlat]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/aree_statistiche_opendata.geojson")
    ap.add_argument(
        "--out", default="web/public/data/processed/quartieri.geojson"
    )
    args = ap.parse_args()

    src = json.loads(Path(args.src).read_text(encoding="utf-8"))

    # cod_quar -> {name, polygons: [ [ring,...], ... ]}
    groups: dict[int, dict] = {}
    for feat in src.get("features", []):
        props = feat.get("properties", {})
        geom = feat.get("geometry")
        cod_quar = props.get("cod_quar")
        quartiere = props.get("quartiere")
        if geom is None or cod_quar is None or quartiere is None:
            continue
        g = groups.setdefault(
            int(cod_quar),
            {"quartiere": quartiere, "polygons": []},
        )
        for poly in polygon_rings(geom):
            g["polygons"].append(round_coords(poly))

    out_features = []
    for cod_quar, g in sorted(groups.items()):
        coords = g["polygons"]
        out_features.append(
            {
                "type": "Feature",
                "properties": {
                    "cod_quar": cod_quar,
                    "quartiere": g["quartiere"],
                    "bbox": bbox_for(coords),
                },
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": coords,
                },
            }
        )

    out = {"type": "FeatureCollection", "features": out_features}
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(f"features written : {len(out_features)}")
    for f in out_features:
        p = f["properties"]
        npoly = len(f["geometry"]["coordinates"])
        print(f"  {p['cod_quar']} {p['quartiere']:30s}  {npoly} polygons")
    print(f"output: {out_path}  ({out_path.stat().st_size/1e3:.1f} KB)")


if __name__ == "__main__":
    main()
