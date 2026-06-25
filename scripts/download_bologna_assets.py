#!/usr/bin/env python3
"""download_bologna_assets.py

Scarica da Open Data Bologna (Opendatasoft) due dataset e li prepara per il
viewer 3D: alberi (ufficiali del Comune) e arredo urbano. Per ciascuno:
  - scarica il GeoJSON completo via API,
  - ritaglia alla bbox di Bologna (stessa copertura degli alberi OSM),
  - mappa i campi in proprieta' leggere usate dal viewer,
  - cuoce la quota del terreno nella z di ogni punto (riusando la classe Dem di
    bake_terrain_elevation.py) cosi' poggiano sul terreno 3D.

Output:
  web/public/data/processed/trees_bologna.geojson   (alberi-manutenzioni)
  web/public/data/processed/arredo_bologna.geojson  (arredo)

Dataset:
  - alberi-manutenzioni : 86k alberi comunali (campo `classe` = specie latina)
  - arredo              : ~14k arredi (campo `classe_arredo` = tipo)

Dipendenze: numpy, Pillow (gia' usate da bake_terrain_elevation). Rete: API
Opendatasoft + tile Terrarium per la quota.

Uso:
    python scripts/download_bologna_assets.py
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
from bake_terrain_elevation import Dem  # riuso il campionatore di quota terreno

ROOT = SCRIPTS.parent
PROC = ROOT / "web" / "public" / "data" / "processed"

# Bbox WGS84 (minlon, minlat, maxlon, maxlat): comune di Bologna, stessa
# copertura degli alberi OSM (vedi download_osm_trees.py).
BBOX = (11.25, 44.45, 11.45, 44.55)
ZOOM = 14  # zoom dei tile Terrarium per la quota (come il baker)

BASE = "https://bologna.opendatasoft.com/api/records/1.0/download/"

# Generi (prima parola del nome latino) da rendere come CONIFERE (chioma a cono)
# nel viewer; tutto il resto -> latifoglia. Lista dei generi coniferi comuni a BO.
CONIFERS = {
    "cedrus", "pinus", "picea", "abies", "cupressus", "cupressocyparis",
    "taxus", "juniperus", "thuja", "chamaecyparis", "sequoia",
    "sequoiadendron", "larix", "pseudotsuga", "cryptomeria", "metasequoia",
    "calocedrus", "tsuga", "cephalotaxus",
}


def fetch_geojson(dataset: str) -> dict:
    url = f"{BASE}?dataset={dataset}&format=geojson&rows=-1"
    print(f"[{dataset}] scarico {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "UrbanScope3D/1.0"})
    with urllib.request.urlopen(req, timeout=600) as r:
        gj = json.load(r)
    print(f"[{dataset}] ricevute {len(gj.get('features', []))} feature")
    return gj


def point_lonlat(feat: dict):
    """Estrae [lon, lat] da una feature Point (o None)."""
    g = feat.get("geometry") or {}
    if g.get("type") != "Point":
        return None
    c = g.get("coordinates")
    if not c or len(c) < 2:
        return None
    return float(c[0]), float(c[1])


def in_bbox(lon: float, lat: float) -> bool:
    minx, miny, maxx, maxy = BBOX
    return minx <= lon <= maxx and miny <= lat <= maxy


def map_tree(props: dict) -> dict:
    """alberi-manutenzioni -> proprieta' che il viewer si aspetta per gli alberi."""
    classe = (props.get("classe") or "").strip()
    genus = classe.split()[0] if classe else ""
    leaf = "needleleaved" if genus.lower() in CONIFERS else "broadleaved"
    out = {"genus": genus, "species": classe, "leaf_type": leaf}
    # extra utili al popup (solo se presenti)
    for src, dst in (
        ("classe_circonferenza_diametro", "circonferenza"),
        ("quartiere", "quartiere"),
        ("pregio", "pregio"),
        ("cod_alb", "cod"),
    ):
        v = props.get(src)
        if v not in (None, ""):
            out[dst] = v
    return out


def map_arredo(props: dict) -> dict:
    out = {}
    for src, dst in (
        ("classe_arredo", "classe"),
        ("classe_conservazione", "conservazione"),
        ("quartiere", "quartiere"),
    ):
        v = props.get(src)
        if v not in (None, ""):
            out[dst] = v
    return out


def build(dataset: str, mapper, out_name: str, dem: Dem) -> None:
    gj = fetch_geojson(dataset)
    feats_in = gj.get("features", [])
    out_feats = []
    for f in feats_in:
        ll = point_lonlat(f)
        if not ll:
            continue
        lon, lat = ll
        if not in_bbox(lon, lat):
            continue
        z = round(float(dem.sample(lon, lat)), 1)
        # coord arrotondate a 6 decimali (~11 cm): dimezza il peso del file
        # senza differenza visibile per un punto-albero.
        out_feats.append({
            "type": "Feature",
            "properties": mapper(f.get("properties") or {}),
            "geometry": {
                "type": "Point",
                "coordinates": [round(lon, 6), round(lat, 6), z],
            },
        })
    out = {"type": "FeatureCollection", "features": out_feats}
    dest = PROC / out_name
    dest.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    mb = dest.stat().st_size / 1024 / 1024
    print(f"[{dataset}] -> {dest.name}: {len(out_feats)} dentro bbox ({mb:.1f} MB)")


def main() -> None:
    PROC.mkdir(parents=True, exist_ok=True)
    print(f"[dem] preparo quota terreno su bbox {BBOX} zoom {ZOOM}")
    dem = Dem(BBOX, ZOOM)
    build("alberi-manutenzioni", map_tree, "trees_bologna.geojson", dem)
    build("arredo", map_arredo, "arredo_bologna.geojson", dem)
    print("[ok] fatto.")


if __name__ == "__main__":
    main()
