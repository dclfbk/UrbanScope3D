#!/usr/bin/env python3
"""build_envimet_overlays.py

Trasforma i GeoTIFF multibanda ENVI-met (web/public/data/Envimet_data/) in
overlay PNG + un meta JSON unico per il viewer MapLibre, e campiona la
temperatura dell'aria su ogni edificio (buildings_heights.geojson) per il
layer "edifici colorati per temperatura".

GEOREFERENZIAZIONE
------------------
I .tif esportati da QGIS NON hanno CRS: la griglia orizzontale e' in metri
locali del modello (0..759 x 0..819, celle 3x3 m). Pero' coincide ESATTAMENTE
(253x273) con il vecchio web/public/data/04_Velocita_Vento.tif, che invece e'
georeferenziato (EPSG:32632, con rotazione del dominio). Quindi prendiamo
CRS + affine da quel file e li applichiamo ai multibanda.

Ogni .tif ha 54 bande = livelli z (banda 0 ~ 0.3 m ... banda 53 ~ 148 m,
griglia telescopica). Per gli overlay 2D e per il campionamento edifici usiamo
una banda a livello pedonale (~1.5 m), configurabile con Z_BAND.

USO
---
    python scripts/build_envimet_overlays.py

DIPENDENZE: rasterio, numpy, Pillow (PIL).

OUTPUT
------
    web/public/data/processed/envimet/<key>.png      (un overlay per variabile)
    web/public/data/processed/envimet/overlays.json  (meta unico: bounds,
                                                       4 angoli, range, unita',
                                                       legenda per ognuno)
    web/public/data/processed/buildings_heights.geojson  (proprieta' air_temp
                                                          aggiunta in-place)
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform as warp_transform
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ENVIMET_DIR = ROOT / "web" / "public" / "data" / "Envimet_data"
GEOREF_TIF = ROOT / "web" / "public" / "data" / "04_Velocita_Vento.tif"
OUT_DIR = ROOT / "web" / "public" / "data" / "processed" / "envimet"
BUILDINGS = ROOT / "web" / "public" / "data" / "processed" / "buildings_heights.geojson"

# Banda (livello z) usata per overlay 2D e campionamento edifici.
# 0 = 0.3 m (suolo), 2 ~ 1.5 m (livello pedonale). Vedi report_completo.txt.
Z_BAND = 2

NODATA_THRESHOLD = -990.0  # ENVI-met usa -999 / -9999 per NoData

# Rampe colore: lista di (stop in [0,1], (r,g,b)). 'yellow->red' per il caldo
# come richiesto; rampe dedicate per umidita'/vegetazione/radiazione.
RAMPS = {
    "ylorrd": [  # giallo -> rosso (temperatura, MRT)
        (0.0, (255, 255, 178)),
        (0.25, (254, 217, 118)),
        (0.5, (254, 178, 76)),
        (0.75, (253, 141, 60)),
        (1.0, (189, 0, 38)),
    ],
    "blues": [  # umidita' relativa
        (0.0, (247, 251, 255)),
        (0.5, (107, 174, 214)),
        (1.0, (8, 48, 107)),
    ],
    "greens": [  # vegetazione LAD
        (0.0, (247, 252, 245)),
        (0.5, (116, 196, 118)),
        (1.0, (0, 68, 27)),
    ],
    "magma": [  # radiazione SW
        (0.0, (0, 0, 4)),
        (0.25, (81, 18, 124)),
        (0.5, (183, 55, 121)),
        (0.75, (252, 137, 97)),
        (1.0, (252, 253, 191)),
    ],
}

# Variabili prioritarie indicate dal tutor (report_completo.txt).
# key, file, label, unita', rampa, agg
#   agg='band' -> banda Z_BAND (livello pedonale ~1.5 m)
#   agg='maxz' -> massimo lungo la colonna z (utile per la vegetazione: la LAD
#                 a 1.5 m e' quasi ovunque 0, il max-su-z mostra dov'e' la chioma)
VARIABLES = [
    ("temperature", "08_potential_air_temperature_all_z.tif", "Temperatura aria", "°C", "ylorrd", "band"),
    ("humidity", "12_relative_humidity_all_z.tif", "Umidità relativa", "%", "blues", "band"),
    ("vegetation_lad", "17_vegetation_lad_all_z.tif", "Vegetazione (LAD)", "m²/m³", "greens", "maxz"),
    ("direct_sw", "18_direct_sw_radiation_all_z.tif", "Radiazione diretta", "W/m²", "magma", "band"),
    ("diffuse_sw", "19_diffuse_sw_radiation_all_z.tif", "Radiazione diffusa", "W/m²", "magma", "band"),
    ("reflected_sw", "20_reflected_sw_radiation_all_z.tif", "Radiazione riflessa", "W/m²", "magma", "band"),
    ("mean_radiant_temp", "26_mean_radiant_temp_all_z.tif", "Mean Radiant Temp.", "°C", "ylorrd", "band"),
]


def build_lut(ramp):
    """LUT 256x3 uint8 da una rampa (stop, rgb)."""
    lut = np.zeros((256, 3), dtype=np.uint8)
    pts = ramp
    for i in range(256):
        t = i / 255.0
        # trova segmento
        for j in range(len(pts) - 1):
            t0, c0 = pts[j]
            t1, c1 = pts[j + 1]
            if t0 <= t <= t1:
                f = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
                lut[i] = [round(c0[k] + (c1[k] - c0[k]) * f) for k in range(3)]
                break
        else:
            lut[i] = pts[-1][1]
    return lut


def colorize(band, vmin, vmax, ramp, mask):
    """band float -> RGBA uint8 (H,W,4). Trasparente dove mask=True."""
    lut = build_lut(RAMPS[ramp])
    norm = np.clip((band - vmin) / (vmax - vmin + 1e-9), 0, 1)
    idx = (norm * 255).astype(np.uint8)
    rgb = lut[idx]  # (H,W,3)
    alpha = np.where(mask, 0, 235).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])
    return rgba


def legend_items(vmin, vmax, ramp, n=6):
    lut = build_lut(RAMPS[ramp])
    items = []
    for i in range(n):
        t = i / (n - 1)
        v = vmin + (vmax - vmin) * t
        r, g, b = lut[int(t * 255)]
        items.append({"value": round(float(v), 2), "color": f"#{r:02x}{g:02x}{b:02x}"})
    return items


def main():
    if not GEOREF_TIF.exists():
        raise SystemExit(f"[!] manca il file georeferenziato: {GEOREF_TIF}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1) georeferenziazione di riferimento dal vecchio tif vento
    with rasterio.open(GEOREF_TIF) as ref:
        ref_crs = ref.crs
        T = ref.transform
        W, H = ref.width, ref.height
    print(f"[geo] CRS={ref_crs}  grid={W}x{H}  transform={T}")

    # 4 angoli (col,row) -> UTM -> WGS84, ordine TL,TR,BR,BL (image source)
    corners_px = [(0, 0), (W, 0), (W, H), (0, H)]
    xs, ys = zip(*[T * (c, r) for c, r in corners_px])
    lons, lats = warp_transform(ref_crs, "EPSG:4326", list(xs), list(ys))
    coordinates = [[round(lon, 7), round(lat, 7)] for lon, lat in zip(lons, lats)]
    bounds = {
        "west": round(min(lons), 7),
        "south": round(min(lats), 7),
        "east": round(max(lons), 7),
        "north": round(max(lats), 7),
    }
    print(f"[geo] corners(WGS84)={coordinates}")

    overlays = []
    temp_band = None  # tenuto per il campionamento edifici

    for key, fname, label, unit, ramp, agg in VARIABLES:
        path = ENVIMET_DIR / fname
        if not path.exists():
            print(f"[skip] manca {fname}")
            continue
        with rasterio.open(path) as ds:
            if ds.width != W or ds.height != H:
                print(f"[!] griglia diversa per {fname}: {ds.width}x{ds.height} (atteso {W}x{H}) -> skip")
                continue
            if agg == "maxz":
                stack = ds.read().astype(np.float32)  # (z, H, W)
                stack = np.where(stack <= NODATA_THRESHOLD, np.nan, stack)
                b = np.nanmax(stack, axis=0)
                b = np.where(np.isnan(b), NODATA_THRESHOLD - 1, b)
            else:
                b = ds.read(min(Z_BAND + 1, ds.count)).astype(np.float32)  # 1-based
        # ENVI-met esporta la griglia "south-up" (riga 0 = bordo SUD del
        # dominio), mentre l'affine preso dal tif vento mette riga 0 a NORD:
        # senza correzione gli overlay escono CAPOVOLTI. Verificato a parte
        # (la maschera NoData=edifici combacia con gli edifici reali solo dopo
        # flip verticale: IoU 0.74 vs 0.27). Raddrizziamo qui, una volta sola:
        # PNG, values.json e campionamento edifici ereditano l'orientamento giusto.
        b = np.flipud(b)
        mask = (b <= NODATA_THRESHOLD) | np.isnan(b)
        valid = b[~mask]
        if valid.size == 0:
            print(f"[skip] {key}: nessun dato valido")
            continue
        # range robusto (2-98 percentile) per evitare outlier
        vmin = float(np.percentile(valid, 2))
        vmax = float(np.percentile(valid, 98))
        if vmax - vmin < 1e-6:
            vmin, vmax = float(valid.min()), float(valid.max() + 1e-3)

        rgba = colorize(b, vmin, vmax, ramp, mask)
        png_path = OUT_DIR / f"{key}.png"
        Image.fromarray(rgba, "RGBA").save(png_path)

        # Griglia di valori per il campionamento al click (nodata -> null).
        # Arrotondo a 1 decimale per tenere il JSON leggero (~250 KB/var).
        bm = b.ravel()
        mm = mask.ravel()
        flat = [None if mm[i] else round(float(bm[i]), 1) for i in range(bm.size)]
        (OUT_DIR / f"{key}.values.json").write_text(
            json.dumps({"w": W, "h": H, "v": flat}, separators=(",", ":")),
            encoding="utf-8",
        )

        overlays.append({
            "key": key,
            "label": label,
            "unit": unit,
            "image": f"/data/processed/envimet/{key}.png",
            "values": f"/data/processed/envimet/{key}.values.json",
            "z_band": Z_BAND if agg == "band" else "max-z",
            "range": {"min": round(vmin, 2), "max": round(vmax, 2)},
            "observed": {"min": round(float(valid.min()), 2), "max": round(float(valid.max()), 2)},
            "bounds": bounds,
            "coordinates": coordinates,
            "legend": legend_items(vmin, vmax, ramp),
        })
        print(f"[ok] {key}: agg={agg} range {vmin:.2f}..{vmax:.2f} {unit} -> {png_path.name}")

        if key == "temperature":
            temp_band = b
            temp_mask = mask
            temp_range = (vmin, vmax)

    meta = {
        "source": "ENVI-met PILOT-01-TALEA 2024-07-27 11:00 (z_band=%d)" % Z_BAND,
        "georef_from": GEOREF_TIF.name,
        "overlays": overlays,
    }
    (OUT_DIR / "overlays.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[ok] meta -> {OUT_DIR / 'overlays.json'} ({len(overlays)} overlay)")

    # 2) campionamento temperatura aria su ogni edificio
    if temp_band is not None and BUILDINGS.exists():
        inject_building_temp(temp_band, temp_mask, T, ref_crs)
        print(f"[ok] air_temp iniettato in {BUILDINGS.name}  (range overlay {temp_range[0]:.1f}..{temp_range[1]:.1f})")
    else:
        print("[warn] niente temperatura o buildings_heights mancante: salto il campionamento edifici")


def nearest_valid(band, mask, row, col, max_r=6):
    """Valore valido piu' vicino a (row,col) entro max_r celle (edifici =
    NoData nel raster, il centroide cade spesso in NoData)."""
    H, Wd = band.shape
    if 0 <= row < H and 0 <= col < Wd and not mask[row, col]:
        return float(band[row, col])
    for r in range(1, max_r + 1):
        best = None
        for dr in range(-r, r + 1):
            for dc in range(-r, r + 1):
                rr, cc = row + dr, col + dc
                if 0 <= rr < H and 0 <= cc < Wd and not mask[rr, cc]:
                    d = dr * dr + dc * dc
                    if best is None or d < best[0]:
                        best = (d, float(band[rr, cc]))
        if best is not None:
            return best[1]
    return None


def inject_building_temp(band, mask, T, crs):
    data = json.loads(BUILDINGS.read_text(encoding="utf-8"))
    feats = data.get("features", [])
    inv = ~T  # affine inversa: (x,y)->(col,row)
    # centroidi in WGS84
    lons, lats = [], []
    for f in feats:
        geom = f.get("geometry") or {}
        ring = None
        if geom.get("type") == "Polygon":
            ring = geom["coordinates"][0]
        elif geom.get("type") == "MultiPolygon":
            ring = geom["coordinates"][0][0]
        if not ring:
            lons.append(None); lats.append(None); continue
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        lons.append(sum(xs) / len(xs)); lats.append(sum(ys) / len(ys))
    # WGS84 -> UTM (in blocco), salto i None
    idx = [i for i, lo in enumerate(lons) if lo is not None]
    ux, uy = warp_transform("EPSG:4326", crs, [lons[i] for i in idx], [lats[i] for i in idx])
    n_set = 0
    for k, i in enumerate(idx):
        col, row = inv * (ux[k], uy[k])
        v = nearest_valid(band, mask, int(round(row)), int(round(col)))
        if v is not None:
            feats[i].setdefault("properties", {})["air_temp"] = round(v, 1)
            n_set += 1
    BUILDINGS.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"[ok] air_temp su {n_set}/{len(feats)} edifici")


if __name__ == "__main__":
    main()
