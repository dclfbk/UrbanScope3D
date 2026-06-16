#!/usr/bin/env python3
"""download_terrain_tiles.py

Scarica i tile DEM *Terrarium* (AWS Open Data) per l'AOI e li salva in locale
come piramide XYZ, cosi' MapLibre li serve dalla STESSA origine del sito
(niente CORS) e il terreno 3D funziona anche su GitHub Pages.

Perche': l'endpoint pubblico s3.amazonaws.com/elevation-tiles-prod NON manda
header CORS. MapLibre `raster-dem` deve leggere i pixel per decodificare la
quota: senza CORS il browser blocca la lettura e il terreno resta piatto (e gli
edifici, che hanno la z di base cotta, "volano"). Servendo i tile da
public/data/processed/terrain/ il problema sparisce.

Le quote vengono dagli STESSI tile usati da bake_terrain_elevation.py, quindi
edifici/alberi poggiano esattamente sulla superficie.

Output: web/public/data/processed/terrain/{z}/{x}/{y}.png
Uso: python scripts/download_terrain_tiles.py [--minzoom 11 --maxzoom 15]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROC = os.path.join(ROOT, "web", "public", "data", "processed")
BUILDINGS = os.path.join(PROC, "buildings_heights.geojson")
TREES = os.path.join(PROC, "trees_osm.geojson")
OUT_DIR = os.path.join(PROC, "terrain")

TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat = max(min(lat, 85.05112878), -85.05112878)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def feature_bbox(features):
    minx = miny = math.inf
    maxx = maxy = -math.inf

    def walk(c):
        nonlocal minx, miny, maxx, maxy
        if c and isinstance(c[0], (int, float)):
            minx = min(minx, c[0]); maxx = max(maxx, c[0])
            miny = min(miny, c[1]); maxy = max(maxy, c[1])
        else:
            for x in c:
                walk(x)

    for ft in features:
        g = ft.get("geometry")
        if g:
            walk(g["coordinates"])
    return (minx, miny, maxx, maxy)


def aoi_bbox():
    with open(BUILDINGS, encoding="utf-8") as f:
        bb = feature_bbox(json.load(f)["features"])
    with open(TREES, encoding="utf-8") as f:
        bt = feature_bbox(json.load(f)["features"])
    pad = 0.01
    return (min(bb[0], bt[0]) - pad, min(bb[1], bt[1]) - pad,
            max(bb[2], bt[2]) + pad, max(bb[3], bt[3]) + pad)


def fetch(z, x, y) -> bytes:
    url = TERRARIUM_URL.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": "UrbanScope3D/terrain-dl"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minzoom", type=int, default=11)
    ap.add_argument("--maxzoom", type=int, default=15)
    args = ap.parse_args()

    w, s, e, n = aoi_bbox()
    print(f"[terrain] AOI bbox {tuple(round(v,4) for v in (w,s,e,n))}")
    total = saved = skipped = 0
    for z in range(args.minzoom, args.maxzoom + 1):
        x0, y0 = lonlat_to_tile(w, n, z)  # NW
        x1, y1 = lonlat_to_tile(e, s, z)  # SE
        count = 0
        for x in range(min(x0, x1), max(x0, x1) + 1):
            for y in range(min(y0, y1), max(y0, y1) + 1):
                total += 1
                dst_dir = os.path.join(OUT_DIR, str(z), str(x))
                dst = os.path.join(dst_dir, f"{y}.png")
                if os.path.exists(dst) and os.path.getsize(dst) > 0:
                    skipped += 1
                    continue
                try:
                    data = fetch(z, x, y)
                except Exception as ex:  # noqa: BLE001
                    print(f"\n  [!] {z}/{x}/{y} fallito: {ex}", file=sys.stderr)
                    continue
                os.makedirs(dst_dir, exist_ok=True)
                with open(dst, "wb") as fp:
                    fp.write(data)
                saved += 1
                count += 1
                print(f"\r  z={z}: {count} tile...", end="", file=sys.stderr)
        print(f"\r  z={z}: zona {min(x0,x1)}..{max(x0,x1)} x {min(y0,y1)}..{max(y0,y1)} fatto      ",
              file=sys.stderr)
    print(f"[terrain] totale {total} | scaricati {saved} | gia' presenti {skipped}")
    print(f"[terrain] output: {OUT_DIR}")
    print("[terrain] ricorda di copiare la cartella in docs/data/processed/terrain/ per Pages.")


if __name__ == "__main__":
    main()
