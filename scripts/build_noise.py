#!/usr/bin/env python3
"""build_noise.py

Mappa di rumore acustico STIMATA (finta, non misurata) per Bologna, sul
modello dei road-noise map: il rumore e' dominato dal traffico, quindi lo
deriviamo dalla classe della strada (OSM `highway`). Le zone senza strade
(parchi, verde) restano quiete per costruzione.

NB: e' un proxy didattico, non dati fonometrici reali. Le soglie dB sono
valori indicativi (Lden) per dare un ordine di grandezza credibile.

Output:
    web/public/data/processed/noise_roads.geojson  (LineString + noise_db)

Uso:
    python scripts/build_noise.py

Dipendenze: solo stdlib (urllib). Scarica da Overpass API.
"""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "data" / "processed"

# Bbox area di interesse (S, W, N, E) - intero comune di Bologna (come
# l'estensione di buildings_heights), cosi' il rumore copre TUTTA la citta'.
BBOX = (44.42, 11.23, 44.56, 11.43)

# dB Lden indicativi per classe di strada (proxy del traffico). Incluse anche
# pedonali/ciclabili a dB basso, cosi' tutta la rete viaria e' colorata.
NOISE_DB = {
    "motorway": 78, "motorway_link": 76,
    "trunk": 76, "trunk_link": 74,
    "primary": 72, "primary_link": 70,
    "secondary": 68, "secondary_link": 66,
    "tertiary": 63, "tertiary_link": 62,
    "unclassified": 58,
    "residential": 57,
    "living_street": 52,
    "service": 50,
    "pedestrian": 47,
    "cycleway": 45,
    "footway": 44,
    "path": 43,
    "track": 46,
    "steps": 42,
}

OVERPASS = "https://overpass-api.de/api/interpreter"


def query() -> dict:
    s, w, n, e = BBOX
    classes = "|".join(NOISE_DB.keys())
    q = (
        "[out:json][timeout:90];"
        f'(way["highway"~"^({classes})$"]({s},{w},{n},{e}););'
        "out geom;"
    )
    req = urllib.request.Request(
        OVERPASS, data=q.encode("utf-8"),
        headers={"User-Agent": "UrbanScope3D/1.0 (noise map)"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = query()
    feats = []
    for el in data.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        hw = (el.get("tags") or {}).get("highway")
        db = NOISE_DB.get(hw)
        if db is None:
            continue
        coords = [[g["lon"], g["lat"]] for g in el["geometry"]]
        if len(coords) < 2:
            continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"highway": hw, "noise_db": db},
        })
    fc = {"type": "FeatureCollection", "features": feats}
    out = OUT / "noise_roads.geojson"
    out.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    dbs = [f["properties"]["noise_db"] for f in feats]
    print(f"[noise] {len(feats)} strade -> {out.name}")
    if dbs:
        print(f"[noise] dB range {min(dbs)}..{max(dbs)}")


if __name__ == "__main__":
    main()
