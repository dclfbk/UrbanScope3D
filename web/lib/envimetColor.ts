/**
 * Colorazione CLIENT-SIDE delle slice ENVI-met: da griglia Float32 (una quota
 * del cubo, vedi lib/envimetTif.ts) a immagine RGBA pronta per la texture del
 * foglio deck.gl. Replica esattamente colorize() della vecchia pipeline Python
 * (build_envimet_overlays.py), cosi' i colori restano identici ai PNG storici:
 * LUT 256 della rampa, NoData verde salvia semi-trasparente, dati alpha 235.
 *
 * Costo: ~69k pixel per slice, ben sotto il millisecondo — lo slider quota
 * resta istantaneo anche ricolorando a ogni tacca. Memoizzata per slice.
 */
import { ENV_RAMPS, type RampKey } from '@/lib/envimetRegistry'

/** Stessi valori della pipeline: NoData riconoscibile ma discreto. */
const NODATA_RGB: [number, number, number] = [203, 224, 193]
const NODATA_ALPHA = 70
const DATA_ALPHA = 235

const lutCache = new Map<RampKey, Uint8Array>()

/** LUT 256x3 della rampa (identica a build_lut() Python). */
function rampLut(key: RampKey): Uint8Array {
  const hit = lutCache.get(key)
  if (hit) return hit
  const ramp = ENV_RAMPS[key]
  const lut = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let rgb = ramp[ramp.length - 1][1]
    for (let j = 0; j < ramp.length - 1; j++) {
      const [t0, c0] = ramp[j]
      const [t1, c1] = ramp[j + 1]
      if (t0 <= t && t <= t1) {
        const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
        rgb = [
          Math.round(c0[0] + (c1[0] - c0[0]) * f),
          Math.round(c0[1] + (c1[1] - c0[1]) * f),
          Math.round(c0[2] + (c1[2] - c0[2]) * f),
        ]
        break
      }
    }
    lut[i * 3] = rgb[0]
    lut[i * 3 + 1] = rgb[1]
    lut[i * 3 + 2] = rgb[2]
  }
  lutCache.set(key, lut)
  return lut
}

// ImageData: e' il tipo immagine che deck.gl/luma accettano nativamente come
// prop `texture` (un oggetto {data,width,height} grezzo non viene riconosciuto).
export type SliceImage = ImageData

// Memo per slice: la STESSA Float32Array (subarray del cubo, riferimento
// stabile) ricolorata con gli stessi parametri torna la stessa immagine ->
// deck.gl non ricarica la texture.
const imageCache = new WeakMap<Float32Array, { sig: string; img: SliceImage }>()

/** Colora una slice (w*h valori, riga 0 = nord) con la rampa sul range dato. */
export function colorizeSlice(
  values: Float32Array,
  w: number,
  h: number,
  ramp: RampKey,
  vmin: number,
  vmax: number,
): SliceImage {
  const sig = `${ramp}|${vmin}|${vmax}`
  const hit = imageCache.get(values)
  if (hit && hit.sig === sig) return hit.img
  const lut = rampLut(ramp)
  const span = Math.max(1e-9, vmax - vmin)
  const data = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < values.length; p++) {
    const x = values[p]
    const o = p * 4
    if (Number.isNaN(x)) {
      data[o] = NODATA_RGB[0]
      data[o + 1] = NODATA_RGB[1]
      data[o + 2] = NODATA_RGB[2]
      data[o + 3] = NODATA_ALPHA
      continue
    }
    const t = Math.max(0, Math.min(1, (x - vmin) / span))
    const i = Math.round(t * 255) * 3
    data[o] = lut[i]
    data[o + 1] = lut[i + 1]
    data[o + 2] = lut[i + 2]
    data[o + 3] = DATA_ALPHA
  }
  const img = new ImageData(data, w, h)
  imageCache.set(values, { sig, img })
  return img
}
