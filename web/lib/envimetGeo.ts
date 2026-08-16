/**
 * Georeferenziazione del dominio ENVI-met come COSTANTI committate.
 *
 * I GeoTIFF ENVI-met (web/public/data/Envimet_data/) NON hanno CRS: la loro
 * griglia e' in metri locali del modello. L'ancoraggio geografico vive nel
 * vecchio 04_Velocita_Vento.tif (EPSG:32632, affine RUOTATA: il dominio non e'
 * allineato a nord). Leggerlo a runtime richiederebbe proj4 (+~100 KB) e un
 * bootstrap asincrono per numeri che non cambiano mai: quindi li fissiamo qui.
 *
 * Se il professore consegnasse un NUOVO dominio, rigenerare i valori con:
 *
 *   python - <<'EOF'
 *   import rasterio
 *   from rasterio.warp import transform as wt
 *   ds = rasterio.open('web/public/data/04_Velocita_Vento.tif')
 *   T, W, H = ds.transform, ds.width, ds.height
 *   px = [(0,0),(W,0),(W,H),(0,H)]                    # TL TR BR BL
 *   xs, ys = zip(*[T*(c,r) for c,r in px])
 *   lon, lat = wt(ds.crs, 'EPSG:4326', xs, ys)
 *   print(list(zip([round(x,7) for x in lon], [round(y,7) for y in lat])))
 *   EOF
 *
 * (ground plane/elev: vedi compute_ground_plane in scripts/build_envimet_overlays.py)
 */

type Corner = [number, number]

/** Angoli WGS84 del dominio ruotato, ordine TL, TR, BR, BL (convenzione deck). */
export const ENV_CORNERS: [Corner, Corner, Corner, Corner] = [
  [11.3455146, 44.5047619],
  [11.3361821, 44.5061926],
  [11.3340257, 44.4989859],
  [11.3433571, 44.4975554],
]

/** BBox asse-allineata che avvolge il dominio ruotato [ovest, sud, est, nord]. */
export const ENV_BOUNDS: [number, number, number, number] = [
  11.3340257, 44.4975554, 11.3455146, 44.5061926,
]

/** Piano del suolo (m slm): elev = a + b*lon + c*lat. Fit least-squares sui
 * base_elev degli edifici dentro il dominio (il terreno vero e' quasi piano). */
export const ENV_GROUND_PLANE = { a: 92621.465, b: 464.818, c: -2198.538 }

/** Quota media del suolo nel dominio (fallback piatto del ground plane). */
export const ENV_GROUND_ELEV = 56.9

/** Sorgente dei dati: la simulazione e' una FOTOGRAFIA di quell'istante. */
export const ENV_SOURCE = 'ENVI-met PILOT-01-TALEA 2024-07-27 11:00'

/** Quote z (m sopra il suolo) delle 54 bande, dai tag GDAL `z_m` dei tif
 * (griglia telescopica: fitta vicino a terra, 3 m sopra). Fallback usato se i
 * tag per banda non fossero leggibili nel browser. */
export const ENV_Z_LEVELS: number[] = [
  0.3, 0.9, 1.5, 2.1, 2.7, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5, 22.5, 25.5,
  28.5, 31.5, 34.5, 37.5, 40.5, 43.5, 46.5, 49.5, 52.5, 55.5, 58.5, 61.5,
  64.5, 67.5, 70.5, 73.5, 76.5, 79.5, 82.5, 85.5, 88.5, 91.5, 94.5, 97.5,
  100.5, 103.5, 106.5, 109.5, 112.5, 115.5, 118.5, 121.5, 124.5, 127.5,
  130.5, 133.5, 136.5, 139.5, 142.5, 145.5, 148.5,
]

/** Quota del suolo (m slm) a lon/lat dal piano fittato. */
export function groundAt(lon: number, lat: number): number {
  const { a, b, c } = ENV_GROUND_PLANE
  return a + b * lon + c * lat
}
