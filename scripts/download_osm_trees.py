"""
download_osm_trees.py
Scarica tutti i nodi OSM con tag `natural=tree` nel bbox del comune di
Bologna (lo stesso maxBounds usato dal viewer) e li esporta come GeoJSON
Point feature collection. OSM ha solitamente molti piu' alberi mappati
del DBTR per le aree urbane, quindi il risultato e' una nuvola di alberi
piu' densa e "streets.gl-like".

Output:
    web/public/data/processed/trees_osm.geojson

Dipendenze: solo stdlib.

Uso:
    python scripts/download_osm_trees.py
    python scripts/download_osm_trees.py --bbox 44.45 11.25 44.55 11.45
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "processed" / "trees_osm.geojson"

# Bbox di default: stesso maxBounds del viewer (MapViewer.tsx), comune di Bologna.
# Ordine bbox Overpass: (south, west, north, east).
DEFAULT_BBOX = (44.45, 11.25, 44.55, 11.45)

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def build_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    return (
        f"[out:json][timeout:90];\n"
        f"(\n"
        f"  node[\"natural\"=\"tree\"]({s},{w},{n},{e});\n"
        f");\n"
        f"out skel;\n"
    )


def fetch(query: str) -> dict:
    body = query.encode("utf-8")
    last_err: Exception | None = None
    for url in OVERPASS_ENDPOINTS:
        print(f"[OSM-TREES] try {url}")
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "User-Agent": "UrbanScope3D/0.1 (academic, FBK)",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                if r.status != 200:
                    print(f"[OSM-TREES]   HTTP {r.status}")
                    continue
                payload = r.read().decode("utf-8")
                return json.loads(payload)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f"[OSM-TREES]   fallito: {type(e).__name__}: {e}")
            last_err = e
            continue
    raise SystemExit(f"[OSM-TREES] nessun endpoint Overpass ha risposto: {last_err}")


def to_geojson(payload: dict) -> dict:
    features: list[dict] = []
    for el in payload.get("elements", []):
        if el.get("type") != "node":
            continue
        lon = el.get("lon")
        lat = el.get("lat")
        if lon is None or lat is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"id": el["id"]},
        })
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--bbox", nargs=4, type=float, metavar=("S", "W", "N", "E"),
        default=DEFAULT_BBOX,
        help="Bbox WGS84: south west north east (default: Comune di Bologna)",
    )
    args = ap.parse_args()
    bbox = tuple(args.bbox)  # type: ignore[assignment]

    query = build_query(bbox)
    print(f"[OSM-TREES] bbox = {bbox}")
    print(f"[OSM-TREES] query:\n{query}")

    data = fetch(query)
    fc = to_geojson(data)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fc), encoding="utf-8")
    size_kb = OUT.stat().st_size / 1024
    print(f"[OSM-TREES] scritti {len(fc['features'])} alberi -> {OUT} "
          f"({size_kb:.1f} KB)")


if __name__ == "__main__":
    sys.exit(main())
