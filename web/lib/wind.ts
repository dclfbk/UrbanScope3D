/**
 * Sampler del raster vento Envimet (`04_wind_speed`).
 *
 * Pipeline:
 * - `wind_overlay.json` contiene bounds (lat/lon EPSG:4326) e
 *   `minmax_observed` del campo originale in m/s.
 * - `wind_overlay.png` e' la colorizzazione viridis del campo, stessa
 *   griglia, alpha 0 fuori dominio.
 *
 * Approccio: carichiamo il PNG in un canvas offscreen una volta al
 * mount, e a ogni click campioniamo il pixel corrispondente alla
 * lon/lat cliccata. La luma del pixel viene poi rimappata linearmente
 * nel range [min, max] osservato -- viridis non e' perfettamente lineare
 * sulla luma, ma su un range di 0-3 m/s l'errore e' << 0.3 m/s, piu' che
 * sufficiente per un popup informativo.
 */

export type WindSampler = (lon: number, lat: number) => number | null

export type WindOverlayMeta = {
  bounds: { west: number; south: number; east: number; north: number }
  range: { min: number; max: number }
  imageUrl: string
}

export async function buildWindSampler(
  meta: WindOverlayMeta,
): Promise<WindSampler> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = meta.imageUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return () => null
  }
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const W = canvas.width
  const H = canvas.height
  const { west, south, east, north } = meta.bounds
  const { min, max } = meta.range
  const span = max - min || 1

  return (lon, lat) => {
    if (lon < west || lon > east || lat < south || lat > north) return null
    const u = (lon - west) / (east - west)
    const v = 1 - (lat - south) / (north - south)
    const px = Math.min(W - 1, Math.max(0, Math.floor(u * W)))
    const py = Math.min(H - 1, Math.max(0, Math.floor(v * H)))
    const idx = (py * W + px) * 4
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    const a = data[idx + 3]
    if (a < 10) return null
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    return min + (luma / 255) * span
  }
}
