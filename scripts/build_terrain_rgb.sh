#!/usr/bin/env bash
# build_terrain_rgb.sh
# Trasforma il DTM Bologna 2023 (RDN32 / EPSG:7791) in piramide di tile
# terrain-RGB PNG in EPSG:3857, consumabile da MapLibre raster-dem.
#
# Dipendenze:
#   - GDAL (gdalwarp, gdal_translate, gdaldem)
#   - rio rgbify  (pip install rio-rgbify)
#
# Uso:
#   ./scripts/build_terrain_rgb.sh [demo|full]
#
# Output:
#   data/dtm_3857.tif                       (intermedio gitignored)
#   web/public/data/processed/terrain/{z}/{x}/{y}.png

set -euo pipefail

PROFILE="${1:-demo}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="${ROOT}/web/public/data/3)Terrain-DEM/3.1_DTM_Bologna_2023.tif"
TMP_DIR="${ROOT}/data"
TMP="${TMP_DIR}/dtm_3857.tif"
OUT_DIR="${ROOT}/web/public/data/processed/terrain"

if [[ ! -f "${IN}" ]]; then
  echo "[!] ${IN} non trovato. Esegui prima: python scripts/download_missing_data.py --step dtm" >&2
  exit 1
fi

mkdir -p "${TMP_DIR}" "${OUT_DIR}"

if [[ "${PROFILE}" == "full" ]]; then
  Z_MIN=10
  Z_MAX=16
else
  Z_MIN=12
  Z_MAX=16
fi

echo "[TERRAIN] reproject EPSG:7791 -> EPSG:3857"
gdalwarp -overwrite \
  -s_srs EPSG:7791 \
  -t_srs EPSG:3857 \
  -r bilinear \
  -of GTiff \
  -co COMPRESS=DEFLATE \
  "${IN}" "${TMP}"

echo "[TERRAIN] rio rgbify -> ${OUT_DIR}"
# rio rgbify scrive un mbtiles, lo esplodiamo in {z}/{x}/{y}.png con mb-util.
MBTILES="${TMP_DIR}/dtm_terrain.mbtiles"
rio rgbify \
  --base-val -10000 \
  --interval 0.1 \
  --min-z "${Z_MIN}" \
  --max-z "${Z_MAX}" \
  -j 4 \
  "${TMP}" "${MBTILES}"

# Esplode in folder XYZ. mb-util e' la via piu' portabile su Windows.
if command -v mb-util >/dev/null 2>&1; then
  rm -rf "${OUT_DIR}"
  mb-util --image_format=png "${MBTILES}" "${OUT_DIR}"
else
  echo "[TERRAIN] mb-util non installato, tengo solo .mbtiles."
  echo "          pip install mbutil  per esplodere i tile."
  cp "${MBTILES}" "${ROOT}/web/public/data/processed/dtm_terrain.mbtiles"
fi

echo "[TERRAIN] done: ${OUT_DIR}"
