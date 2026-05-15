"""
preprocess_dbtr.py
Sblocca i FeatureCollection wrappati del DBTR (Geoportale ER) e fa il join
fra footprint (1.5 Cassone Edilizio) e attributi (1.2 Edificio).
1.3 UVL_GPG sarebbe la fonte delle altezze ma il file scaricato e' mislabellato
(contiene alberi, V_ALB_GPT). Finche' non viene riscaricato correttamente,
si assegna h_max di default in base alla classe d'uso.

Dipendenze:
    pip install ijson  (gia' inclusa in requirements tipici)

Uso:
    python scripts/preprocess_dbtr.py
    python scripts/preprocess_dbtr.py --bbox 11.335 44.495 11.350 44.506
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
OUT_DIR = ROOT / "data"  # output intermedio, gitignored

# Le chiavi wrapper note. Il DBTR avvolge la FeatureCollection in una chiave
# col nome della classe (es. "V_FAB_GPG" per il cassone edilizio).
WRAPPER_KEYS = {
    "1.2": "V_EDI_CT_USO_AVM",
    "1.3": "V_ALB_GPT",        # mislabellato: file su disco contiene alberi
    "1.5": "V_FAB_GPG",
}

# Default altezza per classe d'uso prevalente (USO_PREV in 1.2 EDI_GPG).
# Numeri tarati per l'AOI centro storico Bologna, da raffinare quando
# riscaricheremo 1.3 UVL_GPG con i valori reali (H_GRONDA_AVG).
H_FALLBACK_BY_USO = {
    "1": 18.0,   # residenziale
    "2": 12.0,   # commerciale
    "3": 14.0,   # produttivo
    "4": 22.0,   # servizi pubblici
    "5":  6.0,   # accessorio
}
H_FALLBACK_DEFAULT = 12.0


def unwrap(path: Path, expected_key: str) -> dict:
    """Apre un DBTR JSON e estrae la FeatureCollection dal wrapper."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    if expected_key in raw and isinstance(raw[expected_key], dict):
        fc = raw[expected_key]
    elif raw.get("type") == "FeatureCollection":
        fc = raw
    else:
        # Caso degenerato: pesca il primo dict figlio che assomiglia a una FC.
        fc = next(
            (v for v in raw.values()
             if isinstance(v, dict) and v.get("type") == "FeatureCollection"),
            None,
        )
        if fc is None:
            raise ValueError(f"{path.name}: nessuna FeatureCollection trovata")
    if "features" not in fc:
        raise ValueError(f"{path.name}: FeatureCollection senza 'features'")
    return fc


def in_bbox(geom: dict, bbox: tuple[float, float, float, float]) -> bool:
    """Test grossolano: almeno un vertice cade dentro la bbox WGS84."""
    if not geom or "coordinates" not in geom:
        return False
    minx, miny, maxx, maxy = bbox

    def walk(coords):
        if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
            x, y = coords[0], coords[1]
            return minx <= x <= maxx and miny <= y <= maxy
        return any(walk(c) for c in coords)

    return walk(geom["coordinates"])


def index_by_id_e(fc: dict) -> dict[str, dict]:
    """Indicizza una FeatureCollection per ID_E (chiave di join DBTR)."""
    idx: dict[str, dict] = {}
    for f in fc["features"]:
        props = f.get("properties") or {}
        key = props.get("ID_E") or props.get("id_e") or props.get("IDE")
        if key:
            idx[str(key)] = f
    return idx


def fallback_height(uso_prev: object) -> float:
    if uso_prev is None:
        return H_FALLBACK_DEFAULT
    return H_FALLBACK_BY_USO.get(str(uso_prev)[0], H_FALLBACK_DEFAULT)


def build_buildings(bbox: tuple[float, float, float, float] | None) -> Path:
    fp_path = DATA / "1)Buildings" / "1.5_DBTR_Cassone_Edilizio.json"
    at_path = DATA / "1)Buildings" / "1.2_DBTR_Edificio.json"

    print(f"[DBTR] unwrap 1.5 Cassone (footprint) ... {fp_path.name}")
    fp_fc = unwrap(fp_path, WRAPPER_KEYS["1.5"])
    print(f"[DBTR]   features: {len(fp_fc['features'])}")

    print(f"[DBTR] unwrap 1.2 Edificio (attributi) ... {at_path.name}")
    at_fc = unwrap(at_path, WRAPPER_KEYS["1.2"])
    at_index = index_by_id_e(at_fc)
    print(f"[DBTR]   attributi indicizzati per ID_E: {len(at_index)}")

    # NOTA: 1.3 UVL_GPG non viene caricata: file su disco mislabellato
    # (contiene alberi). Quando sara' riscaricata correttamente, qui va
    # aggiunto il join sull'altezza massima per ID_E.
    print("[DBTR] WARNING: 1.3 UVL_GPG mislabellata, h_max = fallback per uso")

    out_features: list[dict] = []
    matched, total = 0, 0
    for feat in fp_fc["features"]:
        total += 1
        geom = feat.get("geometry")
        if bbox and not in_bbox(geom or {}, bbox):
            continue
        props = dict(feat.get("properties") or {})
        id_e = str(props.get("ID_E") or props.get("id_e") or "")
        attr_feat = at_index.get(id_e)
        if attr_feat:
            matched += 1
            attr_props = attr_feat.get("properties") or {}
            uso = attr_props.get("USO_PREV") or attr_props.get("uso_prev")
            props["uso_prev"] = uso
            props["h_max"] = fallback_height(uso)
        else:
            props["uso_prev"] = None
            props["h_max"] = H_FALLBACK_DEFAULT
        props["id_e"] = id_e
        out_features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": props,
        })

    print(f"[DBTR] join 1.5 -> 1.2: {matched}/{total} matched, "
          f"{len(out_features)} features in output")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "buildings.geojson"
    out.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": out_features,
    }), encoding="utf-8")
    print(f"[DBTR] -> {out} ({out.stat().st_size/1024/1024:.1f} MB)")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--bbox", nargs=4, type=float, default=None,
        metavar=("MINX", "MINY", "MAXX", "MAXY"),
        help="Clip al bbox WGS84 (default: nessun clip).",
    )
    args = ap.parse_args()
    bbox = tuple(args.bbox) if args.bbox else None
    build_buildings(bbox)


if __name__ == "__main__":
    main()
