"""
join_air_stations.py
Le centraline qualita' aria di Open Data Bologna (5.2) hanno 'geometry: null':
il dataset esposto e' la serie temporale, non il registro stazioni.
Le 3 stazioni sono note (Giardini Margherita, Via Chiarini, Porta San Felice)
quindi qui le materializziamo manualmente con coordinate ufficiali ARPAE,
tagliamo la serie agli ultimi N giorni e produciamo:

  - air_stations.geojson  (3 punti, ultime medie giornaliere)
  - temperature_<id>.json (serie temperatura per stazione, opzionale)

Uso:
    python scripts/join_air_stations.py
    python scripts/join_air_stations.py --days 30
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "processed"

# Coordinate ARPAE per le 3 stazioni Bologna. WGS84 lon, lat.
STATIONS = {
    "giardini_margherita": {
        "name": "Giardini Margherita",
        "lon": 11.354329,
        "lat": 44.482472,
        "type": "urban background",
    },
    "via_chiarini": {
        "name": "Via Chiarini",
        "lon": 11.291640,
        "lat": 44.500900,
        "type": "urban traffic",
    },
    "porta_san_felice": {
        "name": "Porta San Felice",
        "lon": 11.330950,
        "lat": 44.498830,
        "type": "urban traffic",
    },
}

# Mapping fra il nome stazione nel CSV/GeoJSON ODB e la nostra chiave.
NAME_MAP = {
    "giardini margherita": "giardini_margherita",
    "via chiarini": "via_chiarini",
    "porta san felice": "porta_san_felice",
    "san felice": "porta_san_felice",
    "chiarini": "via_chiarini",
    "margherita": "giardini_margherita",
}


def normalize(name: str) -> str | None:
    n = (name or "").strip().lower()
    if not n:
        return None
    if n in NAME_MAP:
        return NAME_MAP[n]
    for k, v in NAME_MAP.items():
        if k in n:
            return v
    return None


def load_air_records(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    feats = raw.get("features") if isinstance(raw, dict) else None
    if not feats:
        return []
    out = []
    for f in feats:
        p = f.get("properties") or {}
        # I campi tipici Opendatasoft per questo dataset:
        # nome_stazione, data, no2_max, pm10_med, pm25_med, ozono_max, ...
        station_name = (
            p.get("nome_stazione") or p.get("station") or p.get("nome") or ""
        )
        sid = normalize(station_name)
        if not sid:
            continue
        out.append({
            "station_id": sid,
            "date": p.get("data") or p.get("date"),
            "no2": p.get("no2_max") or p.get("no2"),
            "pm10": p.get("pm10_med") or p.get("pm10"),
            "pm25": p.get("pm25_med") or p.get("pm25"),
            "ozone": p.get("ozono_max") or p.get("o3"),
        })
    return out


def latest_per_station(records: list[dict], days: int) -> dict[str, dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    bucket: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        try:
            d = datetime.fromisoformat(r["date"].replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if d < cutoff:
            continue
        bucket[r["station_id"]].append(r)

    summary: dict[str, dict] = {}
    for sid, rows in bucket.items():
        def avg(key: str) -> float | None:
            vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
            return round(sum(vals) / len(vals), 2) if vals else None
        summary[sid] = {
            "samples": len(rows),
            "no2_avg": avg("no2"),
            "pm10_avg": avg("pm10"),
            "pm25_avg": avg("pm25"),
            "ozone_avg": avg("ozone"),
        }
    return summary


def build_stations_geojson(summary: dict[str, dict]) -> dict:
    feats = []
    for sid, meta in STATIONS.items():
        props = {"id": sid, **meta, **(summary.get(sid) or {})}
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [meta["lon"], meta["lat"]]},
            "properties": props,
        })
    return {"type": "FeatureCollection", "features": feats}


def build_temperature_json(csv_path: Path) -> None:
    if not csv_path.exists():
        print(f"[AIR] {csv_path.name} non trovato, skip temperature")
        return
    by_date: list[dict] = []
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=";")
        for row in reader:
            d = row.get("data") or row.get("date")
            t_avg = row.get("t_med") or row.get("temperatura_media") or row.get("tmed")
            t_min = row.get("t_min") or row.get("tmin")
            t_max = row.get("t_max") or row.get("tmax")
            if not d:
                continue
            by_date.append({
                "date": d,
                "t_avg": float(t_avg) if t_avg else None,
                "t_min": float(t_min) if t_min else None,
                "t_max": float(t_max) if t_max else None,
            })
    out = OUT / "temperature_bologna.json"
    out.write_text(json.dumps(by_date), encoding="utf-8")
    print(f"[AIR] temperature -> {out.name} ({len(by_date)} righe)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=30,
                    help="Finestra giorni per la media (default 30)")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)

    air_path = DATA / "5)EnvironmentalData" / "5.2_centraline_qualita_aria.geojson"
    if air_path.exists():
        records = load_air_records(air_path)
        print(f"[AIR] record letti: {len(records)}")
        summary = latest_per_station(records, args.days)
        for sid, s in summary.items():
            print(f"[AIR]   {sid}: {s}")
    else:
        print(f"[AIR] {air_path.name} non trovato, esporto solo le coordinate")
        summary = {}

    fc = build_stations_geojson(summary)
    out = OUT / "air_stations.geojson"
    out.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(f"[AIR] stations -> {out.name} ({len(fc['features'])} punti)")

    temp_csv = DATA / "5)EnvironmentalData" / "5.1_temperature_bologna.csv"
    build_temperature_json(temp_csv)


if __name__ == "__main__":
    main()
