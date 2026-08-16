/**
 * Decodifica di un GeoTIFF ENVI-met in "cubo" Float32 — codice condiviso fra
 * il Web Worker (percorso normale) e il fallback sul main thread. Nessuna
 * dipendenza dal DOM: puo' girare in entrambi i contesti.
 *
 * Convenzioni dei tif (vedi documentation/11_envimet-data-reference.md):
 *  - 54 bande = quote z (griglia telescopica), quota reale nel tag GDAL z_m;
 *  - export "south-up": la riga 0 del raster e' il SUD -> flip verticale per
 *    avere riga 0 = nord (stessa convenzione dei vecchi .values.json);
 *  - nodata -9999 (e -999 in file piu' vecchi) -> NaN.
 */
import { fromArrayBuffer, type GeoTIFFImage } from 'geotiff'

import { ENV_Z_LEVELS } from '@/lib/envimetGeo'

export type DecodedCube = {
  w: number
  h: number
  nz: number
  /** Quota (m sopra il suolo) di ogni banda. */
  zM: Float32Array
  /** Valori banda-major (banda * w*h + riga * w + col), riga 0 = nord, NaN = nodata. */
  data: Float32Array
  /** Min/max osservati (NaN esclusi). */
  min: number
  max: number
  /** Percentili 2-98 osservati: range colore per le variabili senza range fisso. */
  p2: number
  p98: number
}

const NODATA_THRESHOLD = -990

/** Legge il tag GDAL per-banda `z_m`; null se assente/illeggibile. */
async function bandZ(image: GeoTIFFImage, band: number): Promise<number | null> {
  try {
    const meta = (await image.getGDALMetadata(band)) as Record<string, unknown> | null
    const raw = meta?.z_m
    const z = typeof raw === 'string' || typeof raw === 'number' ? parseFloat(String(raw)) : NaN
    return Number.isFinite(z) ? z : null
  } catch {
    return null
  }
}

export async function decodeEnvimetTif(buffer: ArrayBuffer): Promise<DecodedCube> {
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage(0)
  const w = image.getWidth()
  const h = image.getHeight()
  const nz = image.getSamplesPerPixel()
  // Tutte le bande in un colpo: coi tif interleave-pixel leggere una banda
  // sola decomprimerebbe comunque tutti i tile (nessun risparmio di CPU).
  const rasters = (await image.readRasters({ interleave: false })) as unknown as
    ArrayLike<number>[]

  const plane = w * h
  const data = new Float32Array(plane * nz)
  const zM = new Float32Array(nz)
  let min = Infinity
  let max = -Infinity
  for (let b = 0; b < nz; b++) {
    zM[b] = (await bandZ(image, b)) ?? ENV_Z_LEVELS[b] ?? (b > 0 ? 4.5 + (b - 5) * 3 : 0.3)
    const src = rasters[b]
    const dst = b * plane
    for (let row = 0; row < h; row++) {
      // flip verticale: south-up -> riga 0 = nord
      const srcOff = (h - 1 - row) * w
      const dstOff = dst + row * w
      for (let col = 0; col < w; col++) {
        const x = src[srcOff + col]
        if (!Number.isFinite(x) || x <= NODATA_THRESHOLD) {
          data[dstOff + col] = NaN
          continue
        }
        data[dstOff + col] = x
        if (x < min) min = x
        if (x > max) max = x
      }
    }
  }
  if (!Number.isFinite(min)) {
    min = 0
    max = 1
  }

  // Percentili 2-98 con un istogramma a 1024 bin sul range osservato: e' il
  // range colore delle variabili tecniche (il min/max puro e' dominato dagli
  // outlier). Secondo passaggio O(n), nessun sort di 3.7M valori.
  const BINS = 1024
  const span = Math.max(1e-9, max - min)
  const hist = new Uint32Array(BINS)
  let valid = 0
  for (let i = 0; i < data.length; i++) {
    const x = data[i]
    if (Number.isNaN(x)) continue
    valid++
    const bin = Math.min(BINS - 1, Math.floor(((x - min) / span) * BINS))
    hist[bin]++
  }
  const pct = (q: number): number => {
    const target = q * valid
    let acc = 0
    for (let i = 0; i < BINS; i++) {
      acc += hist[i]
      if (acc >= target) return min + ((i + 0.5) / BINS) * span
    }
    return max
  }
  const p2 = valid > 0 ? pct(0.02) : min
  const p98 = valid > 0 ? pct(0.98) : max

  return { w, h, nz, zM, data, min, max, p2, p98 }
}
