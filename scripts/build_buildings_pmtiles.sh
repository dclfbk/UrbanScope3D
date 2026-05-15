#!/usr/bin/env bash
# build_buildings_pmtiles.sh
# Costruisce il PMTiles degli edifici a partire dal GeoJSON intermedio
# generato da preprocess_dbtr.py.
#
# Dipendenze:
#   - tippecanoe   (https://github.com/felt/tippecanoe)
#   - pmtiles CLI  (https://github.com/protomaps/go-pmtiles)
#
# Uso:
#   ./scripts/build_buildings_pmtiles.sh [demo|full]
#
# Output:
#   web/public/data/processed/buildings_<profile>.pmtiles

set -euo pipefail

PROFILE="${1:-demo}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="${ROOT}/data/buildings.geojson"
OUT_DIR="${ROOT}/web/public/data/processed"
OUT="${OUT_DIR}/buildings_${PROFILE}.pmtiles"

if [[ ! -f "${IN}" ]]; then
  echo "[!] ${IN} non trovato. Esegui prima: python scripts/preprocess_dbtr.py" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

# Profilo demo: AOI clip, zoom 12-17, soglia di drop bassa.
# Profilo full: copertura comunale, zoom 10-17, drop densest as needed.
if [[ "${PROFILE}" == "full" ]]; then
  ZOOM_RANGE="-Z10 -z17"
  DROP="--drop-densest-as-needed"
else
  ZOOM_RANGE="-Z12 -z17"
  DROP=""
fi

echo "[BUILD] tippecanoe -> ${OUT}"
tippecanoe \
  --force \
  ${ZOOM_RANGE} \
  --layer=buildings \
  --include=h_max --include=uso_prev --include=id_e \
  --no-tile-size-limit \
  ${DROP} \
  -o "${OUT}" \
  "${IN}"

echo "[BUILD] done: ${OUT} ($(du -h "${OUT}" | cut -f1))"
