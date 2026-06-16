#!/usr/bin/env python3
"""Build quartieri.geojson from the Open Data Bologna "aree statistiche".

Source: Comune di Bologna - "Aree statistiche" (dataset
`aree-statistiche`), 90 polygons covering the comune, each tagged with
`cod_quar` (11..16) and `quartiere` (the 6 administrative districts).

This script groups the 90 polygons by `cod_quar` into 6 features (one per
quartiere) and **geometrically dissolves** (shapely `unary_union`) the shared
boundaries between adjacent areas of the same quartiere. Without the dissolve
the output keeps every sub-area outline, so the viewer's perimeter highlight
draws extra lines INSIDE the quartiere. With the dissolve only the true outer
perimeter (plus any real holes) remains.

Download the source once:

    curl -L -o data/aree_statistiche_opendata.geojson \\
      "https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/aree-statistiche/exports/geojson?lang=it&timezone=Europe%2FRome"

Then:

    python scripts/build_quartieri.py

Dipendenze: shapely.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

COORD_DECIMALS = 5  # ~1 m at Bologna's latitude; plenty for a quartiere outline


def round_coords(coords):
    if isinstance(coords, (int, float)):
        return round(coords, COORD_DECIMALS)
    return [round_coords(x) for x in coords]


def bbox_for_geojson(coords) -> list[float]:
    minlon = minlat = float("inf")
    maxlon = maxlat = float("-inf")

    def walk(c):
        nonlocal minlon, minlat, maxlon, maxlat
        if c and isinstance(c[0], (int, float)):
            x, y = c[0], c[1]
            minlon = min(minlon, x); maxlon = max(maxlon, x)
            minlat = min(minlat, y); maxlat = max(maxlat, y)
        else:
            for x in c:
                walk(x)

    walk(coords)
    return [minlon, minlat, maxlon, maxlat]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="data/aree_statistiche_opendata.geojson")
    ap.add_argument("--out", default="web/public/data/processed/quartieri.geojson")
    args = ap.parse_args()

    src = json.loads(Path(args.src).read_text(encoding="utf-8"))

    # cod_quar -> {name, geoms: [shapely geometry, ...]}
    groups: dict[int, dict] = {}
    for feat in src.get("features", []):
        props = feat.get("properties", {})
        geom = feat.get("geometry")
        cod_quar = props.get("cod_quar")
        quartiere = props.get("quartiere")
        if geom is None or cod_quar is None or quartiere is None:
            continue
        g = groups.setdefault(int(cod_quar), {"quartiere": quartiere, "geoms": []})
        g["geoms"].append(shape(geom))

    out_features = []
    for cod_quar, g in sorted(groups.items()):
        # Dissolve: unione geometrica -> spariscono i confini interni condivisi.
        # buffer(0) ripulisce eventuali piccole imprecisioni topologiche.
        merged = unary_union(g["geoms"]).buffer(0)
        m = mapping(merged)
        # Output SEMPRE MultiPolygon (anche se il dissolve da' un Polygon unico):
        # tiene il tipo lato viewer stabile e accurato.
        if m["type"] == "Polygon":
            mp_coords = [m["coordinates"]]
        else:
            mp_coords = m["coordinates"]
        coords = round_coords(mp_coords)
        out_features.append(
            {
                "type": "Feature",
                "properties": {
                    "cod_quar": cod_quar,
                    "quartiere": g["quartiere"],
                    "bbox": bbox_for_geojson(coords),
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
        geom = f["geometry"]
        npoly = 1 if geom["type"] == "Polygon" else len(geom["coordinates"])
        print(f"  {p['cod_quar']} {p['quartiere']:30s}  {geom['type']} ({npoly} part)")
    print(f"output: {out_path}  ({out_path.stat().st_size/1e3:.1f} KB)")


if __name__ == "__main__":
    main()
