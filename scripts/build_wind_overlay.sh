#!/usr/bin/env bash
# build_wind_overlay.sh
# Trasforma 04_Velocita_Vento.tif in una PNG colorata + JSON con i 4 angoli,
# pronta come `image` source di MapLibre.
#
# Output:
#   web/public/data/processed/wind_overlay.png
#   web/public/data/processed/wind_overlay.json
#
# Dipendenze:
#   - GDAL (gdalwarp, gdaldem, gdal_translate, gdalinfo)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="${ROOT}/web/public/data/04_Velocita_Vento.tif"
TMP_DIR="${ROOT}/data"
OUT_DIR="${ROOT}/web/public/data/processed"
OUT_PNG="${OUT_DIR}/wind_overlay.png"
OUT_META="${OUT_DIR}/wind_overlay.json"

[[ -f "${IN}" ]] || { echo "[!] manca: ${IN}" >&2; exit 1; }
mkdir -p "${TMP_DIR}" "${OUT_DIR}"

# 1) Riproietta in WGS84 (MapLibre image source vuole coordinate lon/lat)
WIND_4326="${TMP_DIR}/wind_4326.tif"
gdalwarp -overwrite -t_srs EPSG:4326 -r bilinear \
  -dstnodata 0 \
  "${IN}" "${WIND_4326}"

# Range valori effettivo (servono per scegliere la scala)
MINMAX=$(gdalinfo -mm "${WIND_4326}" | awk -F'=' '/Computed Min\/Max/ { print $2; exit }')
echo "[WIND] valori min/max effettivi: ${MINMAX} m/s"

# 2) Colormap viridis-like su 0-6 m/s (tipica per velocità vento urbano).
#    Se il tuo dataset ha range diverso, edita questa scala.
CMAP="${TMP_DIR}/wind_cmap.txt"
cat > "${CMAP}" <<'EOF'
0.0    68   1  84    0
0.5    72  35 116  140
1.5    64  67 135  190
2.5    52  94 141  210
3.5    41 121 142  220
4.5    34 168 132  230
5.5   122 209  81  240
6.5   253 231  37  245
nv      0   0   0    0
EOF

# 3) Applica colormap -> RGBA GeoTIFF -> PNG
WIND_RGBA="${TMP_DIR}/wind_rgba.tif"
gdaldem color-relief -alpha -of GTiff "${WIND_4326}" "${CMAP}" "${WIND_RGBA}"
gdal_translate -of PNG "${WIND_RGBA}" "${OUT_PNG}" >/dev/null
# Rimuovo l'aux.xml generato accanto al PNG (rumore in public/)
rm -f "${OUT_PNG}.aux.xml" "${TMP_DIR}/wind_rgba.tif.aux.xml" 2>/dev/null || true

# 4) Bounds in EPSG:4326 per MapLibre
read XMIN YMAX XMAX YMIN < <(gdalinfo "${WIND_4326}" \
  | awk '/Upper Left/  { gsub(/[(),]/,""); xmin=$3; ymax=$4 }
         /Lower Right/ { gsub(/[(),]/,""); xmax=$3; ymin=$4 }
         END { print xmin, ymax, xmax, ymin }')
echo "[WIND] bounds: W=${XMIN}  S=${YMIN}  E=${XMAX}  N=${YMAX}"

cat > "${OUT_META}" <<EOF
{
  "source": "04_Velocita_Vento.tif",
  "unit": "m/s",
  "image": "/data/processed/wind_overlay.png",
  "minmax_observed": "${MINMAX}",
  "bounds": {
    "west": ${XMIN},
    "south": ${YMIN},
    "east": ${XMAX},
    "north": ${YMAX}
  },
  "coordinates": [
    [${XMIN}, ${YMAX}],
    [${XMAX}, ${YMAX}],
    [${XMAX}, ${YMIN}],
    [${XMIN}, ${YMIN}]
  ],
  "legend": [
    {"value": 0.5, "color": "#482371"},
    {"value": 1.5, "color": "#404387"},
    {"value": 2.5, "color": "#345e8d"},
    {"value": 3.5, "color": "#29798e"},
    {"value": 4.5, "color": "#22a884"},
    {"value": 5.5, "color": "#7ad151"},
    {"value": 6.5, "color": "#fde725"}
  ]
}
EOF

echo "[WIND] done: ${OUT_PNG} + ${OUT_META}"
