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

# Banda (livello z) usata per overlay 2D DI DEFAULT e campionamento edifici.
# 0 = 0.3 m (suolo), 2 ~ 1.5 m (livello pedonale). Vedi report_completo.txt.
Z_BAND = 2

# Quote (indici banda) esposte dallo slider "altezza" nel viewer. Z reali (m)
# lette dai tag delle bande: 1.5 / 4.5 / 7.5 / 10.5 / 13.5 / 16.5 / 25.5 / 40.5 / 58.5.
# SCELTA GUIDATA DAI DATI: la variazione spaziale (sole/ombra) e' concentrata
# da terra a ~16 m (strada + facciate fino ai tetti) e crolla sopra i ~19 m
# (spread MRT 36->15 °C). Quindi quote FITTE in basso (ogni 3 m fino a 16.5) e
# RADE in alto (25.5, 40.5). L'ultima, 58.5 m (banda 23), e' "sopra ogni
# edificio": il piu' alto nel dominio e' 50.1 m. Lo slider nel viewer e'
# proporzionale ai metri reali. Per ogni variabile 'band' si genera un PNG per
# quota; lo slider commuta l'immagine dell'overlay.
HEIGHT_BANDS = [2, 5, 6, 7, 8, 9, 12, 17, 23]

# Bande campionate per la COLONNA di temperatura di ogni edificio (gradiente
# verticale sulla facciata): fitte vicino al suolo (z 0.3..40.5 m). Il viewer
# costruisce un edificio "a fasce", una per banda fino all'altezza del tetto.
COLUMN_BANDS = list(range(0, 18))

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
    "viridis": [  # generica (variabili tecniche senza una rampa naturale)
        (0.0, (68, 1, 84)),
        (0.25, (59, 82, 139)),
        (0.5, (33, 145, 140)),
        (0.75, (94, 201, 98)),
        (1.0, (253, 231, 37)),
    ],
    "rdbu": [  # divergente (delta / variazioni / flussi: +/-)
        (0.0, (33, 102, 172)),
        (0.5, (247, 247, 247)),
        (1.0, (178, 24, 43)),
    ],
}

# Variabili prioritarie indicate dal tutor (report_completo.txt).
# key, file, label, unita', rampa, agg
#   agg='band' -> banda Z_BAND (livello pedonale ~1.5 m)
#   agg='maxz' -> massimo lungo la colonna z (utile per la vegetazione: la LAD
#                 a 1.5 m e' quasi ovunque 0, il max-su-z mostra dov'e' la chioma)
# I 7 dati CURATI per i cittadini: PNG a piu' quote (slider) + valori al click.
CURATED = [
    ("temperature", "08_potential_air_temperature_all_z.tif", "Temperatura dell'aria", "°C", "ylorrd", "band"),
    ("humidity", "12_relative_humidity_all_z.tif", "Umidità dell'aria", "%", "blues", "band"),
    ("vegetation_lad", "17_vegetation_lad_all_z.tif", "Vegetazione (chioma)", "m²/m³", "greens", "maxz"),
    ("direct_sw", "18_direct_sw_radiation_all_z.tif", "Sole diretto", "W/m²", "magma", "band"),
    ("diffuse_sw", "19_diffuse_sw_radiation_all_z.tif", "Luce diffusa dal cielo", "W/m²", "magma", "band"),
    ("reflected_sw", "20_reflected_sw_radiation_all_z.tif", "Sole riflesso da muri e suolo", "W/m²", "magma", "band"),
    ("mean_radiant_temp", "26_mean_radiant_temp_all_z.tif", "Temperatura percepita", "°C", "ylorrd", "band"),
    # Velocita' del vento: curata cosi' ha lo slider quota + valore al click come
    # le altre (prima era solo un overlay tecnico a terra, "senza livelli"). La
    # velocita' cresce con la quota (in alto piu' vento, in strada meno): lo
    # slider lo rende leggibile.
    ("wind_speed", "04_wind_speed_all_z.tif", "Velocità del vento", "m/s", "blues", "band"),
]
CURATED_KEYS = {k for k, *_ in CURATED}
CURATED_FILES = {f for _, f, *_ in CURATED}

# Range colore FISSI per variabile (vmin, vmax) -> "stesso colore = stesso
# valore" sempre, anche fra sim diverse e fra layer; la legenda diventa
# confrontabile. Prima ogni overlay si stirava sul proprio percentile 2-98, e i
# colori non erano comparabili. Envelope fisici tondi che contengono i dati
# osservati (sim 2024-07-27 11:00) con un po' di margine per sim future.
# NB: scelta PER-VARIABILE, non per-famiglia: temperatura aria e MRT sono
# entrambe in °C ma su scale diverse (l'MRT al sole sale molto piu' in alto), e
# le tre radiazioni SW hanno magnitudini diverse (diretta ~1000, diffusa/
# riflessa ~100-400) -> condividere un'unica scala appiattirebbe il contrasto.
# Per confrontare fra loro la terna radiazione bisogna leggere i numeri in
# legenda. Variabili senza voce qui ricadono sul percentile 2-98 (fallback).
FIXED_RANGES = {
    "temperature": (24.0, 40.0),
    "humidity": (30.0, 70.0),
    "vegetation_lad": (0.0, 0.5),
    "direct_sw": (0.0, 1000.0),
    "diffuse_sw": (0.0, 200.0),
    "reflected_sw": (0.0, 400.0),
    "mean_radiant_temp": (20.0, 80.0),
    "wind_speed": (0.0, 6.0),
}

# Etichette italiane "umane" per le variabili EXTRA (oltre i 7 curati). Dove
# manca, si usa il long_name del tif. Le tecniche restano col nome tecnico.
IT_LABELS = {
    "objects": "Oggetti / edifici (maschera)",
    "flow_u": "Vento componente U (E-O)",
    "flow_v": "Vento componente V (N-S)",
    "flow_w": "Vento componente W (verticale)",
    "wind_speed": "Velocità del vento",
    "wind_speed_change": "Variazione velocità vento",
    "wind_direction": "Direzione del vento",
    "pressure_perturbation": "Perturbazione di pressione",
    "air_temperature_delta": "Δ Temperatura aria",
    "air_temperature_change": "Variazione temperatura aria",
    "specific_humidity": "Umidità specifica",
    "tke": "Turbolenza (TKE)",
    "tke_dissipation": "Dissipazione turbolenza",
    "vertical_exchange_coef_impuls": "Coeff. scambio verticale",
    "horizontal_exchange_coef_impuls": "Coeff. scambio orizzontale",
    "temperature_flux": "Flusso di calore",
    "vapour_flux": "Flusso di vapore",
    "water_on_leafes": "Acqua sulle foglie",
    "leaf_temperature": "Temperatura foglie",
    "local_mixing_length": "Lunghezza di mescolamento",
    "tke_normalised_1d": "TKE normalizzata",
    "dissipation_normalised_1d": "Dissipazione normalizzata",
    "km_normalised_1d": "Km normalizzato",
    "tke_mechanical_turbulence_prod": "Produzione turbolenza meccanica",
    "stomata_resistance": "Resistenza stomatica",
    "co2": "CO₂ (qualità aria)",
    "co2_2": "CO₂ (2)",
    "plant_co2_flux": "Flusso CO₂ vegetazione",
    "div_lw_radiation_temp_change": "Variazione T da radiazione IR",
    "natural_convection_velocity": "Velocità convezione naturale",
    "building_number": "Numero edificio (maschera)",
}


def ramp_for(name: str, unit: str) -> str:
    """Sceglie una rampa colore plausibile dal nome/unita' della variabile."""
    n, u = name.lower(), (unit or "").lower()
    if any(s in n for s in ("delta", "change", "perturbation", "flux", "convection")):
        return "rdbu"  # divergente (+/-)
    if "direction" in n:
        return "viridis"
    if any(s in n for s in ("temp", "radiant")) or "c" == u or "°c" in u or "k" == u:
        return "ylorrd"
    if "humidity" in n or u == "%":
        return "blues"
    if any(s in n for s in ("radiation", "_sw", "_lw", "shortwave", "longwave")) or "w/m" in u:
        return "magma"
    if any(s in n for s in ("wind", "flow", "velocity", "speed")) or "m/s" in u:
        return "blues"
    if any(s in n for s in ("lad", "veget", "leaf", "plant", "stomata", "co2")):
        return "greens"
    return "viridis"


def build_extra_variables():
    """Tutte le altre variabili ENVI-met (oltre i 7 curati): un overlay a terra
    ciascuna (niente quote/slider, niente valori al click — solo selezionabili e
    colorate). key = nome senza prefisso numerico; label/unita' dai tag del tif."""
    extras = []
    for path in sorted(ENVIMET_DIR.glob("*_all_z.tif")):
        if path.name in CURATED_FILES:
            continue
        stem = path.stem.replace("_all_z", "")
        key = stem.split("_", 1)[1] if "_" in stem else stem  # toglie "NN_"
        try:
            with rasterio.open(path) as ds:
                tags = ds.tags()
        except Exception:
            tags = {}
        unit = (tags.get("units") or "").strip()
        label = IT_LABELS.get(key) or tags.get("long_name") or key.replace("_", " ")
        extras.append((key, path.name, label, unit, ramp_for(key, unit), "band"))
    return extras


VARIABLES = CURATED + build_extra_variables()


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


# Colore delle zone SENZA DATO (NoData): verde tenue invece che trasparente,
# cosi' il dominio non lascia "buchi" sulla mappa. Semitrasparente, distinto dai
# verdi dei dati (vegetazione). Scelta utente.
NODATA_RGB = (203, 224, 193)  # verde salvia tenue
NODATA_ALPHA = 70             # ~27%: si vede ma non copre la mappa sotto


def colorize(band, vmin, vmax, ramp, mask):
    """band float -> RGBA uint8 (H,W,4). Verde tenue dove mask=True (NoData)."""
    lut = build_lut(RAMPS[ramp])
    norm = np.clip((band - vmin) / (vmax - vmin + 1e-9), 0, 1)
    idx = (norm * 255).astype(np.uint8)
    rgb = lut[idx].copy()  # (H,W,3)
    rgb[mask] = NODATA_RGB
    alpha = np.where(mask, NODATA_ALPHA, 235).astype(np.uint8)
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
    temp_cols = []    # colonna temperatura (z_m, arr, mask) per il gradiente facciate

    # ENVI-met esporta la griglia "south-up" (riga 0 = bordo SUD del dominio),
    # mentre l'affine preso dal tif vento mette riga 0 a NORD: senza correzione
    # gli overlay escono CAPOVOLTI (verificato: IoU maschera edifici 0.74 vs 0.27
    # dopo flipud). Raddrizziamo ogni banda con np.flipud, una volta sola.
    def load_band(ds, idx_0based):
        b = ds.read(min(idx_0based + 1, ds.count)).astype(np.float32)  # 1-based
        b = np.flipud(b)
        return b, ((b <= NODATA_THRESHOLD) | np.isnan(b))

    for key, fname, label, unit, ramp, agg in VARIABLES:
        path = ENVIMET_DIR / fname
        if not path.exists():
            print(f"[skip] manca {fname}")
            continue
        with rasterio.open(path) as ds:
            if ds.width != W or ds.height != H:
                print(f"[!] griglia diversa per {fname}: {ds.width}x{ds.height} (atteso {W}x{H}) -> skip")
                continue
            # quote reali (m) di ogni banda dai tag (z_m); fallback all'indice.
            z_m_of = lambda i: float(ds.tags(i + 1).get("z_m", i))

            if agg == "maxz":
                stack = ds.read().astype(np.float32)  # (z, H, W)
                stack = np.where(stack <= NODATA_THRESHOLD, np.nan, stack)
                b = np.nanmax(stack, axis=0)
                b = np.where(np.isnan(b), NODATA_THRESHOLD - 1, b)
                b = np.flipud(b)
                mask = (b <= NODATA_THRESHOLD) | np.isnan(b)
            else:
                b, mask = load_band(ds, Z_BAND)  # banda DI DEFAULT (pedonale)

            valid = b[~mask]
            if valid.size == 0:
                print(f"[skip] {key}: nessun dato valido")
                continue
            # Range FISSO per variabile (scala confrontabile e stabile fra sim e
            # fra QUOTE: stesso colore = stesso valore a ogni altezza); fallback
            # al percentile 2-98 se la variabile non e' in FIXED_RANGES.
            if key in FIXED_RANGES:
                vmin, vmax = FIXED_RANGES[key]
                range_mode = "fixed"
            else:
                vmin = float(np.percentile(valid, 2))
                vmax = float(np.percentile(valid, 98))
                range_mode = "percentile"
                if vmax - vmin < 1e-6:
                    vmin, vmax = float(valid.min()), float(valid.max() + 1e-3)

            # PNG di DEFAULT (banda pedonale o max-z) — retrocompatibile.
            Image.fromarray(colorize(b, vmin, vmax, ramp, mask), "RGBA").save(
                OUT_DIR / f"{key}.png"
            )

            # Slider altezza: un PNG per quota. SOLO per i 7 dati curati (le 31
            # extra restano un overlay a terra: selezionabili e colorate, ma
            # senza moltiplicare i file). Stesso range fisso -> colori confrontabili.
            heights = []
            # Valori per QUOTA (banda -> griglia piatta), per il campionamento al
            # click: cosi' alzando lo slider il popup mostra il valore di QUELLA
            # quota, non sempre quello pedonale (era il limite noto). Solo per i
            # curati 'band'. Chiave = indice di banda (string), come in `heights`.
            z_values: dict[str, list] = {}
            if agg == "band" and key in CURATED_KEYS:
                for idx in HEIGHT_BANDS:
                    if idx >= ds.count:
                        continue
                    bz, mz = load_band(ds, idx)
                    Image.fromarray(
                        colorize(bz, vmin, vmax, ramp, mz), "RGBA"
                    ).save(OUT_DIR / f"{key}__z{idx}.png")
                    heights.append({
                        "band": idx,
                        "z_m": round(z_m_of(idx), 1),
                        "image": f"/data/processed/envimet/{key}__z{idx}.png",
                    })
                    bzr = bz.ravel()
                    mzr = mz.ravel()
                    z_values[str(idx)] = [
                        None if mzr[i] else round(float(bzr[i]), 1)
                        for i in range(bzr.size)
                    ]

            # Colonna per il gradiente verticale sulle facciate. Uso la
            # TEMPERATURA PERCEPITA (MRT, mean radiant temp): l'aria varia ~1 °C
            # in verticale (invisibile), la MRT ~8 °C -> gradiente leggibile e
            # piu' intuitivo ("quanto scotta la facciata"). Il viewer impila una
            # fascia per banda fino al tetto.
            if key == "mean_radiant_temp":
                for ci in COLUMN_BANDS:
                    if ci >= ds.count:
                        continue
                    bz, mz = load_band(ds, ci)
                    temp_cols.append((round(z_m_of(ci), 1), bz, mz))

        # Griglia di valori per il campionamento al click: SOLO per i curati
        # (le extra non hanno popup valore, evita ~8 MB di JSON).
        values_url = ""
        if key in CURATED_KEYS:
            bm = b.ravel()
            mm = mask.ravel()
            flat = [None if mm[i] else round(float(bm[i]), 1) for i in range(bm.size)]
            payload = {"w": W, "h": H, "v": flat}
            # `z`: valori per quota (vuoto per max-z). Il viewer sceglie la griglia
            # in base allo slider quota; fallback a `v` (banda pedonale).
            if z_values:
                payload["z"] = z_values
            (OUT_DIR / f"{key}.values.json").write_text(
                json.dumps(payload, separators=(",", ":")),
                encoding="utf-8",
            )
            values_url = f"/data/processed/envimet/{key}.values.json"

        overlays.append({
            "key": key,
            "label": label,
            "unit": unit,
            "image": f"/data/processed/envimet/{key}.png",
            "values": values_url,
            "curated": key in CURATED_KEYS,
            "z_band": Z_BAND if agg == "band" else "max-z",
            # Quote disponibili per lo slider altezza (vuoto per max-z).
            "heights": heights,
            "range": {"min": round(vmin, 2), "max": round(vmax, 2)},
            "range_mode": range_mode,
            "observed": {"min": round(float(valid.min()), 2), "max": round(float(valid.max()), 2)},
            "bounds": bounds,
            "coordinates": coordinates,
            "legend": legend_items(vmin, vmax, ramp),
        })
        print(f"[ok] {key}: agg={agg} range[{range_mode}] {vmin:.2f}..{vmax:.2f} {unit} "
              f"-> {key}.png (+{len(heights)} quote)")

        if key == "temperature":
            temp_band = b
            temp_mask = mask
            temp_range = (vmin, vmax)

    # Quota del SUOLO sotto il dominio (m s.l.m.): serve al viewer per alzare il
    # piano dell'overlay alla quota giusta (z deck = metri assoluti, come il
    # base_elev degli edifici). Mediana del base_elev degli edifici nel dominio.
    ground_elev = compute_ground_elev(bounds)

    meta = {
        "source": "ENVI-met PILOT-01-TALEA 2024-07-27 11:00 (z_band=%d)" % Z_BAND,
        "georef_from": GEOREF_TIF.name,
        "ground_elev": ground_elev,
        "overlays": overlays,
    }
    (OUT_DIR / "overlays.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[ok] meta -> {OUT_DIR / 'overlays.json'} ({len(overlays)} overlay)")

    # 2) campionamento temperatura aria su ogni edificio (+ colonna verticale)
    if temp_band is not None and BUILDINGS.exists():
        inject_building_temp(temp_band, temp_mask, T, ref_crs, temp_cols)
        print(f"[ok] air_temp iniettato in {BUILDINGS.name}  (range overlay {temp_range[0]:.1f}..{temp_range[1]:.1f})")
    else:
        print("[warn] niente temperatura o buildings_heights mancante: salto il campionamento edifici")


def compute_ground_elev(bounds, default=57.0):
    """Mediana di base_elev (m s.l.m.) degli edifici dentro il dominio ENVI-met.
    Fallback al default se il file edifici manca o non ha base_elev."""
    if not BUILDINGS.exists():
        return default
    try:
        gj = json.loads(BUILDINGS.read_text(encoding="utf-8"))
    except Exception:
        return default
    w, e = bounds["west"], bounds["east"]
    s, n = bounds["south"], bounds["north"]
    els = []
    for f in gj.get("features", []):
        be = (f.get("properties") or {}).get("base_elev")
        if not isinstance(be, (int, float)):
            continue
        try:
            lon, lat = f["geometry"]["coordinates"][0][0][:2]
        except Exception:
            continue
        if w <= lon <= e and s <= lat <= n:
            els.append(be)
    if not els:
        return default
    els.sort()
    return round(float(els[len(els) // 2]), 1)


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


def inject_building_temp(band, mask, T, crs, cols=None):
    """Inietta in ogni edificio `air_temp` (banda pedonale) e, per gli edifici
    nel dominio, `air_temp_col` = [[z_m, t], ...] (colonna per il gradiente
    verticale sulla facciata). cols = lista (z_m, arr, mask) per banda."""
    cols = cols or []
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
    n_col = 0
    for k, i in enumerate(idx):
        col, row = inv * (ux[k], uy[k])
        r, c = int(round(row)), int(round(col))
        v = nearest_valid(band, mask, r, c)
        if v is not None:
            feats[i].setdefault("properties", {})["air_temp"] = round(v, 1)
            n_set += 1
        # Colonna verticale MRT (solo dove c'e' dato = edifici nel dominio):
        # [[z_m, mrt], ...] per il gradiente "temperatura percepita" sulla facciata.
        column = []
        for z_m, arr, m in cols:
            t = nearest_valid(arr, m, r, c)
            if t is not None:
                column.append([z_m, round(t, 1)])
        if column:
            feats[i].setdefault("properties", {})["mrt_col"] = column
            n_col += 1
    BUILDINGS.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"[ok] air_temp su {n_set}/{len(feats)} edifici; colonna MRT su {n_col}")


if __name__ == "__main__":
    main()
