"""
download_missing_data.py
Scarica i dataset mancanti per UrbanScope3D (Bologna) sull'AOI definita.

AOI: zona NW centro Bologna delimitata da via delle Lame, Riva di Reno,
del Pallone, Alessandrini, Augusto Righi, SS 64.

Dipendenze: owslib, pyproj
    pip install owslib pyproj

Uso:
    python scripts/download_missing_data.py                  # tutti gli step
    python scripts/download_missing_data.py --step dtm
    python scripts/download_missing_data.py --step falda
    python scripts/download_missing_data.py --step landuse
    python scripts/download_missing_data.py --step enviro
"""

from __future__ import annotations

import argparse
import urllib.error
import urllib.request
from pathlib import Path

from owslib.wcs import WebCoverageService
from pyproj import Transformer

# ---- AOI -----------------------------------------------------------------
BBOX_WGS84 = (11.335, 44.495, 11.350, 44.506)  # (minx, miny, maxx, maxy)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web" / "public" / "data"

_TO_RDN32 = Transformer.from_crs("EPSG:4326", "EPSG:7791", always_xy=True)


def bbox_in(crs: str) -> tuple[float, float, float, float]:
    crs = crs.upper()
    if crs == "EPSG:4326":
        return BBOX_WGS84
    if crs == "EPSG:7791":
        minx, miny = _TO_RDN32.transform(BBOX_WGS84[0], BBOX_WGS84[1])
        maxx, maxy = _TO_RDN32.transform(BBOX_WGS84[2], BBOX_WGS84[3])
        return (minx, miny, maxx, maxy)
    raise ValueError(f"CRS non gestito: {crs}")


def http_download(url: str, dest: Path) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "UrbanScope3D/0.1"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    return len(data)


# ---- Step 1: DTM Bologna 2023 (WCS) --------------------------------------
def download_dtm() -> None:
    out = DATA / "3)Terrain-DEM" / "3.1_DTM_Bologna_2023.tif"
    out.parent.mkdir(parents=True, exist_ok=True)

    url = "https://servizigis.regione.emilia-romagna.it/wcs/dtm_comune_bo_2023"
    wcs = WebCoverageService(url, version="1.0.0")
    cov_id = "1"  # COMUNE_BO_2023_DTM_RDN32_RM
    print(f"[DTM] coverages: {list(wcs.contents)}")
    print(f"[DTM] formati: {wcs.contents[cov_id].supportedFormats}")
    print(f"[DTM] CRS: {wcs.contents[cov_id].supportedCRS}")

    bbox = bbox_in("EPSG:7791")
    width = max(1, int(round((bbox[2] - bbox[0]) / 0.5)))
    height = max(1, int(round((bbox[3] - bbox[1]) / 0.5)))
    print(f"[DTM] bbox RDN32 = {bbox}, size = {width}x{height} px")

    resp = wcs.getCoverage(
        identifier=cov_id,
        bbox=bbox,
        crs="EPSG:7791",
        format="GeoTIFF",
        width=width,
        height=height,
    )
    out.write_bytes(resp.read())
    print(f"[DTM] salvato: {out} ({out.stat().st_size/1024:.0f} KB)")


# ---- Step 2: DBTR Falda (FDA_GPG) — WFS o fallback manuale ---------------
def download_falda() -> None:
    out = DATA / "1)Buildings" / "1.4_DBTR_Falda.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)

    bbox = bbox_in("EPSG:7791")
    bbox_str = ",".join(f"{v:.2f}" for v in bbox)
    wfs = "https://servizigis.regione.emilia-romagna.it/wfs/dbtr"
    candidates = [
        f"{wfs}?service=WFS&version=2.0.0&request=GetFeature"
        f"&typeNames=dbtr:FDA_GPG&srsName=EPSG:7791"
        f"&outputFormat=application/json&bbox={bbox_str},EPSG:7791",
        f"{wfs}?service=WFS&version=2.0.0&request=GetFeature"
        f"&typeNames=FDA_GPG&srsName=EPSG:7791"
        f"&outputFormat=application/json&bbox={bbox_str},EPSG:7791",
    ]
    for url in candidates:
        try:
            print(f"[FALDA] WFS: {url[:140]}...")
            size = http_download(url, out)
            head = out.read_bytes()[:200].decode("utf-8", errors="replace")
            if '"type"' in head and "Feature" in head:
                print(f"[FALDA] WFS OK -> {out} ({size/1024:.1f} KB)")
                return
            print(f"[FALDA] risposta non GeoJSON: {head[:120]!r}")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f"[FALDA] WFS fallito: {type(e).__name__}: {e}")

    if out.exists():
        out.unlink()
    print(
        "\n[FALDA] Il DBTR NON e' esposto via WFS dal Geoportale ER.\n"
        " L'unica via e' il wizard 'Download DB Topo' (login + selezione AOI + email).\n"
        " Per l'MVP del prototipo NON serve: gli edifici sono gia' estrudibili da\n"
        " 1.2 EDI_GPG + 1.3 UVL_GPG + 1.5 Cassone Edilizio (tetti piatti basta).\n"
        " Riprenderai 1.4 Falda quando arriverai a Issue 7 (ombre con tetti spioventi).\n"
        " Se vuoi farlo ora comunque:\n"
        " 1. https://geoportale.regione.emilia-romagna.it/catalogo/"
        "dati-cartografici/cartografia-di-base/database-topografico-regionale/"
        "immobili-e-antropizzazioni/edificato/layer-5\n"
        " 2. 'Download DB Topo' -> AOI bbox RDN32 (EPSG:7791):\n"
        f"    minX={bbox[0]:.2f}  minY={bbox[1]:.2f}  maxX={bbox[2]:.2f}  maxY={bbox[3]:.2f}\n"
        f" 3. Salva come: {out}\n"
    )


# ---- Step 3: Land Use 2020 (WFS Geoportale ER) ---------------------------
def download_landuse() -> None:
    out = DATA / "4)LandUse-GroundSurface" / "4.1_uso_suolo_2020_ed2023_aoi.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)

    bbox = bbox_in("EPSG:7791")
    bbox_str = ",".join(f"{v:.2f}" for v in bbox)
    url = (
        "http://servizigis.regione.emilia-romagna.it/wfs/uso_del_suolo"
        "?service=WFS&version=2.0.0&request=GetFeature"
        "&typeNames=portale_uso_del_suolo:_020_uso_suolo_ed2023"
        f"&srsName=EPSG:7791&outputFormat=GEOJSON&bbox={bbox_str},EPSG:7791"
    )
    size = http_download(url, out)
    print(f"[LANDUSE] {out.name} -> {size/1024:.0f} KB")


# ---- Step 4: Open Data Bologna (env data) --------------------------------
def download_environmental() -> None:
    out_dir = DATA / "5)EnvironmentalData"
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = [
        ("temperature_bologna", "csv", out_dir / "5.1_temperature_bologna.csv"),
        ("centraline-qualita-aria", "geojson",
         out_dir / "5.2_centraline_qualita_aria.geojson"),
    ]
    for ds, fmt, dest in targets:
        url = (
            "https://bologna.opendatasoft.com/api/records/1.0/download/"
            f"?dataset={ds}&format={fmt}&rows=-1"
        )
        try:
            size = http_download(url, dest)
            print(f"[ENV] {dest.name} -> {size/1024:.1f} KB")
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            print(f"[ENV] {ds} fallito: {type(e).__name__}: {e}")


# ---- main ----------------------------------------------------------------
STEPS = {
    "dtm": download_dtm,
    "falda": download_falda,
    "landuse": download_landuse,
    "enviro": download_environmental,
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--step", choices=["all", *STEPS], default="all")
    args = ap.parse_args()
    targets = list(STEPS) if args.step == "all" else [args.step]
    for name in targets:
        print(f"\n=== {name} ===")
        try:
            STEPS[name]()
        except Exception as e:
            print(f"[!] {name} ERRORE: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
