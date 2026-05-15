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

# Range valori effettivo (servono per calibrare la scala dinamicamente)
MINMAX=$(gdalinfo -mm "${WIND_4326}" | awk -F'=' '/Computed Min\/Max/ { print $2; exit }')
VMIN=$(echo "${MINMAX}" | cut -d, -f1)
VMAX=$(echo "${MINMAX}" | cut -d, -f2)
echo "[WIND] valori min/max effettivi: min=${VMIN}, max=${VMAX} m/s"

# 2) Colormap viridis stirata sul range effettivo del raster.
#    Se il vento va da 0 a 3 m/s a Bologna, scaliamo i 7 stop su quel range
#    invece di sprecarne 4 sulla fascia 3-6 mai usata. Risultato: si vedono
#    bene i contrasti tra zone calme e zone piu' ventilate.
CMAP="${TMP_DIR}/wind_cmap.txt"
python - <<PY > "${CMAP}"
vmin, vmax = ${VMIN}, ${VMAX}
stops = [
    (68,   1,  84),
    (72,  35, 116),
    (64,  67, 135),
    (52,  94, 141),
    (41, 121, 142),
    (34, 168, 132),
    (122, 209, 81),
    (253, 231,  37),
]
n = len(stops) - 1
for i, (r, g, b) in enumerate(stops):
    v = vmin + (vmax - vmin) * (i / n)
    alpha = 0 if i == 0 else min(245, 140 + i * 18)
    print(f"{v:.3f}  {r} {g} {b}  {alpha}")
print("nv  0 0 0  0")
PY
cat "${CMAP}"

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

# Legenda generata dinamicamente sulla stessa scala usata per il PNG.
LEGEND=$(python - <<PY
vmin, vmax = ${VMIN}, ${VMAX}
stops = ["#482371","#404387","#345e8d","#29798e","#22a884","#7ad151","#fde725"]
n = len(stops) - 1
items = []
for i, c in enumerate(stops):
    v = vmin + (vmax - vmin) * ((i + 1) / (n + 1))
    items.append(f'{{"value": {v:.2f}, "color": "{c}"}}')
print(",\n    ".join(items))
PY
)

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
    ${LEGEND}
  ]
}
EOF

echo "[WIND] done: ${OUT_PNG} + ${OUT_META}"
