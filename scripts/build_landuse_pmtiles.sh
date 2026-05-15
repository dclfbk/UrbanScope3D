#!/usr/bin/env bash
# build_landuse_pmtiles.sh
# Costruisce il PMTiles dell'uso suolo 2020 ed.2023 dal GeoJSON gia' clippato
# all'AOI da download_missing_data.py.
#
# Dipendenze: tippecanoe.
#
# Uso:
#   ./scripts/build_landuse_pmtiles.sh [demo|full]

set -euo pipefail

PROFILE="${1:-demo}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="${ROOT}/web/public/data/4)LandUse-GroundSurface/4.1_uso_suolo_2020_ed2023_aoi.geojson"
OUT_DIR="${ROOT}/web/public/data/processed"
OUT="${OUT_DIR}/landuse_${PROFILE}.pmtiles"

if [[ ! -f "${IN}" ]]; then
  echo "[!] ${IN} non trovato. Esegui prima: python scripts/download_missing_data.py --step landuse" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

if [[ "${PROFILE}" == "full" ]]; then
  ZOOM_RANGE="-Z10 -z16"
else
  ZOOM_RANGE="-Z12 -z14"
fi

echo "[BUILD] tippecanoe -> ${OUT}"
tippecanoe \
  --force \
  ${ZOOM_RANGE} \
  --layer=landuse \
  --include=CODICE_USO --include=DESCRIZIONE \
  --simplification=10 \
  --drop-densest-as-needed \
  -o "${OUT}" \
  "${IN}"

echo "[BUILD] done: ${OUT} ($(du -h "${OUT}" | cut -f1))"
