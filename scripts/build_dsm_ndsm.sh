#!/usr/bin/env bash
# build_dsm_ndsm.sh
# Calcola le altezze reali degli edifici dal DSM condiviso da Leonardo:
#   1. Mosaica le ~500 tile .ASC -> VRT (DSM)
#   2. Riproietta/allinea il DTM Bologna 2023 sulla stessa griglia
#   3. nDSM = max(DSM - DTM, 0)
#   4. Zonal stats (p95) su 1.1_Edifici_Particellari.geojson
#   -> web/public/data/processed/buildings_heights.geojson  (campo `height`)
#
# Dipendenze:
#   - GDAL (gdalbuildvrt, gdalwarp, gdal_calc.py, gdalinfo, ogr2ogr)
#   - Python: rasterio, numpy, shapely, pyproj  (vedi compute_building_heights.py)
#
# Uso:
#   ./scripts/build_dsm_ndsm.sh
#
# Var d'ambiente:
#   DSM_SRS   CRS sorgente dei .ASC (default EPSG:25832 = ETRS89/UTM32N).
#             Se i tile risultano sfalsati di pochi metri prova EPSG:6707
#             (RDN2008/UTM32) o EPSG:32632 (WGS84/UTM32N).

set -euo pipefail

DSM_SRS="${DSM_SRS:-EPSG:25832}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DSM_RAW_ROOT="${ROOT}/web/public/data/DatiLeonardo_8-05-2026"
DTM_IN="${ROOT}/web/public/data/3)Terrain-DEM/3.1_DTM_Bologna_2023.tif"
BLDG_IN="${ROOT}/web/public/data/1)Buildings/1.1_Edifici_Particellari.geojson"
TMP_DIR="${ROOT}/data"
OUT_DIR="${ROOT}/web/public/data/processed"
OUT="${OUT_DIR}/buildings_heights.geojson"

for f in "${DSM_RAW_ROOT}" "${DTM_IN}" "${BLDG_IN}"; do
  [[ -e "${f}" ]] || { echo "[!] manca: ${f}" >&2; exit 1; }
done

mkdir -p "${TMP_DIR}" "${OUT_DIR}"

# 1) Lista .ASC + VRT
LIST="${TMP_DIR}/dsm_asc_list.txt"
# Su Windows bash.exe può essere lanciato senza /usr/bin nel PATH:
# garantisce l'accesso a cygpath quando lo script gira da cmd/OSGeo4W shell.
if [[ -d "/usr/bin" ]] && [[ ":$PATH:" != *":/usr/bin:"* ]]; then
  export PATH="/usr/bin:$PATH"
fi
# Su Windows i path bash sono in stile /c/... ma GDAL vuole C:\...
# Convertiamo i path nella lista che verrà letta da gdalbuildvrt.
if command -v cygpath >/dev/null 2>&1; then
  find "${DSM_RAW_ROOT}" -type f \( -iname '*.asc' \) -print0 \
    | xargs -0 -n1 cygpath -w > "${LIST}"
else
  find "${DSM_RAW_ROOT}" -type f \( -iname '*.asc' \) > "${LIST}"
fi
COUNT=$(wc -l < "${LIST}")
echo "[DSM] ${COUNT} tile .ASC trovate, SRS sorgente: ${DSM_SRS}"
[[ "${COUNT}" -gt 0 ]] || { echo "[!] nessun .ASC trovato sotto ${DSM_RAW_ROOT}" >&2; exit 1; }

DSM_VRT="${TMP_DIR}/dsm.vrt"
gdalbuildvrt -overwrite -a_srs "${DSM_SRS}" -input_file_list "${LIST}" "${DSM_VRT}"

# 2) Estensione + risoluzione native del DSM, riproietto/allineo il DTM
read XMIN YMIN XMAX YMAX < <(gdalinfo "${DSM_VRT}" \
  | awk '/Lower Left/  { gsub(/[(),]/,""); xmin=$3; ymin=$4 }
         /Upper Right/ { gsub(/[(),]/,""); xmax=$3; ymax=$4 }
         END { print xmin, ymin, xmax, ymax }')
RES=$(gdalinfo "${DSM_VRT}" | awk '/Pixel Size/ { gsub(/[(),]/,""); print $4; exit }')
RES=${RES#-}
echo "[DSM] bbox=${XMIN},${YMIN},${XMAX},${YMAX}  res=${RES}"

DTM_ALIGNED="${TMP_DIR}/dtm_aligned.tif"
gdalwarp -overwrite \
  -t_srs "${DSM_SRS}" \
  -te "${XMIN}" "${YMIN}" "${XMAX}" "${YMAX}" \
  -tr "${RES}" "${RES}" \
  -r bilinear -of GTiff -co COMPRESS=DEFLATE -co BIGTIFF=YES \
  "${DTM_IN}" "${DTM_ALIGNED}"

# 3) nDSM
NDSM="${TMP_DIR}/ndsm.tif"
gdal_calc.py --overwrite \
  -A "${DSM_VRT}" --A_band=1 \
  -B "${DTM_ALIGNED}" --B_band=1 \
  --outfile="${NDSM}" \
  --calc="numpy.where((A>-9000)&(B>-9000), numpy.maximum(A-B,0), -9999)" \
  --NoDataValue=-9999 \
  --co=COMPRESS=DEFLATE --co=BIGTIFF=YES --type=Float32

# 4) Riproietta gli edifici nel CRS del raster (zonal stats senza distorsione)
SUFFIX="${DSM_SRS#EPSG:}"
BLDG_PROJ="${TMP_DIR}/buildings_${SUFFIX}.geojson"
ogr2ogr -overwrite -f GeoJSON -t_srs "${DSM_SRS}" "${BLDG_PROJ}" "${BLDG_IN}"

# 5) Zonal stats per feature (p95 della nDSM)
python "${ROOT}/scripts/compute_building_heights.py" \
  --ndsm "${NDSM}" \
  --buildings "${BLDG_PROJ}" \
  --out "${OUT}"

echo "[DSM] done: ${OUT}"
