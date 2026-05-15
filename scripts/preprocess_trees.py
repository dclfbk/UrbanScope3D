"""
preprocess_trees.py
Estrae gli alberi DBTR (V_ALB_GPT) dal file 1.3 mislabellato e li clippa
a una bbox WGS84 (default: zona centrale Bologna). Output: GeoJSON snello
caricabile dal browser senza far hangare la tab.

Uso:
    python scripts/preprocess_trees.py
    python scripts/preprocess_trees.py --bbox 11.30 44.48 11.40 44.52
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web" / "public" / "data" / "1)Buildings" / "1.3_DBTR_Unita_Volumetrica.json"
OUT = ROOT / "web" / "public" / "data" / "2)Vegetation" / "2.1_trees_aoi.geojson"

# Bbox di default un po' piu' ampia dell'AOI, copre il centro Bologna.
DEFAULT_BBOX = (11.30, 44.48, 11.40, 44.52)

# Regex sui blocchi Feature: cattura solo coordinate. Sfrutta il fatto che
# il DBTR JSON e' pretty-printed con campi su righe separate, evitando
# di caricare 169 MB in memoria con json.load().
COORD_RE = re.compile(r'"coordinates"\s*:\s*\[\s*([0-9.-]+),\s*([0-9.-]+)\s*\]')


def extract(bbox: tuple[float, float, float, float]) -> list[tuple[float, float]]:
    minx, miny, maxx, maxy = bbox
    out: list[tuple[float, float]] = []
    print(f"[TREES] reading {SRC.name} ({SRC.stat().st_size/1024/1024:.0f} MB)")
    with SRC.open("r", encoding="utf-8") as fh:
        for line in fh:
            m = COORD_RE.search(line)
            if not m:
                continue
            try:
                lon, lat = float(m.group(1)), float(m.group(2))
            except ValueError:
                continue
            if minx <= lon <= maxx and miny <= lat <= maxy:
                out.append((lon, lat))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--bbox", nargs=4, type=float, default=list(DEFAULT_BBOX),
        metavar=("MINX", "MINY", "MAXX", "MAXY"),
    )
    args = ap.parse_args()
    bbox = tuple(args.bbox)
    pts = extract(bbox)
    print(f"[TREES] dentro bbox {bbox}: {len(pts)} alberi")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {},
            }
            for lon, lat in pts
        ],
    }
    OUT.write_text(json.dumps(fc), encoding="utf-8")
    print(f"[TREES] -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
