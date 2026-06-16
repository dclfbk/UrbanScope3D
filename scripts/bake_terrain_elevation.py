#!/usr/bin/env python3
"""bake_terrain_elevation.py

Cuoce la quota del terreno nella geometria di edifici e alberi, cosi' che in
deck.gl poggino sul terreno 3D di MapLibre invece di stare a z=0 (livello del
mare) e "volare" / sprofondare.

Perche': il viewer usa MapLibre setTerrain con i tile DEM globali *Terrarium*
(AWS Open Data, https://registry.opendata.aws/terrain-tiles/), che coprono
anche i colli a sud — cosa che il DTM locale 0.5m (solo ~1.3 km sul centro)
non fa. deck.gl pero' disegna gli edifici a z=0; con il terreno acceso
finirebbero sotto la superficie. La fix e' dare a ogni edificio/albero una z
di base pari alla quota del terreno nel suo punto.

Campioniamo gli STESSI tile Terrarium che renderizza MapLibre, cosi' le basi
combaciano con la superficie. Per gli edifici la base e' piatta: una sola
quota per edificio (centroide), applicata a tutti i vertici. Per gli alberi
la quota va nella terza componente del punto.

Output (sovrascrive, con .bak alla prima esecuzione; idempotente: rifa' la z
se gia' presente, non la accumula):
  web/public/data/processed/buildings_heights.geojson
  web/public/data/processed/trees_osm.geojson

Dipendenze: numpy, Pillow (gia' usate altrove). Nessun GDAL.
Uso: python scripts/bake_terrain_elevation.py [--zoom 14]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import shutil
import sys
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROC = os.path.join(ROOT, "web", "public", "data", "processed")
BUILDINGS = os.path.join(PROC, "buildings_heights.geojson")
TREES = os.path.join(PROC, "trees_osm.geojson")
QUARTIERI = os.path.join(PROC, "quartieri.geojson")

TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TILE = 256


# --- web mercator <-> tile helpers ----------------------------------------
def lonlat_to_pixel(lon: float, lat: float, z: float) -> tuple[float, float]:
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n * TILE
    lat = max(min(lat, 85.05112878), -85.05112878)
    lat_rad = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n * TILE
    return x, y


def tile_range(bbox: tuple[float, float, float, float], z: int):
    w, s, e, n = bbox
    x0, y0 = lonlat_to_pixel(w, n, z)  # NW
    x1, y1 = lonlat_to_pixel(e, s, z)  # SE
    return (
        int(math.floor(x0 / TILE)),
        int(math.floor(y0 / TILE)),
        int(math.floor(x1 / TILE)),
        int(math.floor(y1 / TILE)),
    )


def fetch_tile(z: int, x: int, y: int) -> np.ndarray:
    url = TERRARIUM_URL.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": "UrbanScope3D/terrain-bake"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    a = np.asarray(img, dtype=np.float64)
    # decodifica Terrarium: elev = (R*256 + G + B/256) - 32768
    return (a[:, :, 0] * 256.0 + a[:, :, 1] + a[:, :, 2] / 256.0) - 32768.0


class Dem:
    """Mosaico Terrarium in memoria con campionamento bilineare in lon/lat."""

    def __init__(self, bbox, z):
        self.z = z
        tx0, ty0, tx1, ty1 = tile_range(bbox, z)
        self.tx0, self.ty0 = tx0, ty0
        nx, ny = tx1 - tx0 + 1, ty1 - ty0 + 1
        n = 2 ** z
        mosaic = np.zeros((ny * TILE, nx * TILE), dtype=np.float64)
        total = nx * ny
        got = 0
        for j in range(ny):
            for i in range(nx):
                tx = (tx0 + i) % n
                ty = ty0 + j
                try:
                    tile = fetch_tile(z, tx, ty)
                    mosaic[j * TILE:(j + 1) * TILE, i * TILE:(i + 1) * TILE] = tile
                    got += 1
                except Exception as ex:  # noqa: BLE001
                    print(f"  [!] tile {z}/{tx}/{ty} fallito: {ex}", file=sys.stderr)
                print(f"\r  scarico tile {got + 1}/{total}...", end="", file=sys.stderr)
        print(f"\r  scaricati {got}/{total} tile Terrarium z={z}      ", file=sys.stderr)
        self.mosaic = mosaic
        self.origin_px = (tx0 * TILE, ty0 * TILE)  # global pixel of mosaic[0,0]

    def sample(self, lon: float, lat: float) -> float:
        gx, gy = lonlat_to_pixel(lon, lat, self.z)
        px = gx - self.origin_px[0]
        py = gy - self.origin_px[1]
        h, w = self.mosaic.shape
        x0 = int(math.floor(px)); y0 = int(math.floor(py))
        fx = px - x0; fy = py - y0
        x0 = min(max(x0, 0), w - 1); y0 = min(max(y0, 0), h - 1)
        x1 = min(x0 + 1, w - 1); y1 = min(y0 + 1, h - 1)
        m = self.mosaic
        top = m[y0, x0] * (1 - fx) + m[y0, x1] * fx
        bot = m[y1, x0] * (1 - fx) + m[y1, x1] * fx
        return top * (1 - fy) + bot * fy


# --- geometry helpers ------------------------------------------------------
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


def centroid_of(geom):
    """Centroide approssimato (media vertici del primo anello esterno)."""
    t = geom["type"]
    if t == "Polygon":
        ring = geom["coordinates"][0]
    elif t == "MultiPolygon":
        ring = geom["coordinates"][0][0]
    else:
        return None
    sx = sum(p[0] for p in ring); sy = sum(p[1] for p in ring)
    return sx / len(ring), sy / len(ring)


def set_z_polygon(coords, z):
    for ring in coords:
        for p in ring:
            if len(p) >= 3:
                p[2] = z
            else:
                p.append(z)


def bake_buildings(dem: Dem):
    print("[edifici] carico", BUILDINGS)
    with open(BUILDINGS, encoding="utf-8") as f:
        gj = json.load(f)
    feats = gj["features"]
    if not os.path.exists(BUILDINGS + ".bak"):
        shutil.copy2(BUILDINGS, BUILDINGS + ".bak")
    elevs = []
    for ft in feats:
        g = ft.get("geometry")
        if not g:
            continue
        c = centroid_of(g)
        if c is None:
            continue
        z = round(float(dem.sample(*c)), 1)
        elevs.append(z)
        ft["properties"]["base_elev"] = z
        if g["type"] == "Polygon":
            set_z_polygon(g["coordinates"], z)
        elif g["type"] == "MultiPolygon":
            for poly in g["coordinates"]:
                set_z_polygon(poly, z)
    with open(BUILDINGS, "w", encoding="utf-8") as f:
        json.dump(gj, f, separators=(",", ":"))
    a = np.array(elevs)
    print(f"[edifici] {len(elevs)} basi cotte | quota min/med/max "
          f"{a.min():.1f}/{np.median(a):.1f}/{a.max():.1f} m")


def bake_trees(dem: Dem):
    print("[alberi] carico", TREES)
    with open(TREES, encoding="utf-8") as f:
        gj = json.load(f)
    feats = gj["features"]
    if not os.path.exists(TREES + ".bak"):
        shutil.copy2(TREES, TREES + ".bak")
    elevs = []
    for ft in feats:
        g = ft.get("geometry")
        if not g or g["type"] != "Point":
            continue
        lon, lat = g["coordinates"][0], g["coordinates"][1]
        z = round(float(dem.sample(lon, lat)), 1)
        elevs.append(z)
        g["coordinates"] = [lon, lat, z]
    with open(TREES, "w", encoding="utf-8") as f:
        json.dump(gj, f, separators=(",", ":"))
    a = np.array(elevs)
    print(f"[alberi] {len(elevs)} quote cotte | min/med/max "
          f"{a.min():.1f}/{np.median(a):.1f}/{a.max():.1f} m")


def bake_quartieri(dem: Dem):
    """Quota PER-VERTICE: il bordo/blocco del quartiere e' grande e attraversa
    quote diverse (collina compresa), quindi ogni vertice prende la sua z e la
    linea segue il terreno invece di galleggiare a z=0."""
    if not os.path.exists(QUARTIERI):
        print("[quartieri] file assente, salto")
        return
    print("[quartieri] carico", QUARTIERI)
    with open(QUARTIERI, encoding="utf-8") as f:
        gj = json.load(f)
    if not os.path.exists(QUARTIERI + ".bak"):
        shutil.copy2(QUARTIERI, QUARTIERI + ".bak")

    def set_z_ring(ring):
        for p in ring:
            z = round(float(dem.sample(p[0], p[1])), 1)
            if len(p) >= 3:
                p[2] = z
            else:
                p.append(z)

    n = 0
    for ft in gj["features"]:
        g = ft.get("geometry")
        if not g:
            continue
        if g["type"] == "Polygon":
            for ring in g["coordinates"]:
                set_z_ring(ring)
        elif g["type"] == "MultiPolygon":
            for poly in g["coordinates"]:
                for ring in poly:
                    set_z_ring(ring)
        n += 1
    with open(QUARTIERI, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[quartieri] {n} quartieri con z per-vertice")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=14, help="zoom tile Terrarium (default 14, ~9.5 m/px)")
    args = ap.parse_args()

    # bbox combinata edifici+alberi
    with open(BUILDINGS, encoding="utf-8") as f:
        b_feats = json.load(f)["features"]
    with open(TREES, encoding="utf-8") as f:
        t_feats = json.load(f)["features"]
    bb = feature_bbox(b_feats)
    bt = feature_bbox(t_feats)
    bbox = (min(bb[0], bt[0]), min(bb[1], bt[1]), max(bb[2], bt[2]), max(bb[3], bt[3]))
    # margine per il campionamento bilineare ai bordi
    pad = 0.01
    bbox = (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad)
    print(f"[dem] bbox {tuple(round(v,4) for v in bbox)} zoom {args.zoom}")
    dem = Dem(bbox, args.zoom)
    bake_buildings(dem)
    bake_trees(dem)
    bake_quartieri(dem)
    print("[ok] fatto. Ricorda di ricopiare i geojson cotti in docs/data/processed/ per Pages.")


if __name__ == "__main__":
    main()
