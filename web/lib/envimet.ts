/**
 * Sampler dei valori ENVI-met al click.
 *
 * Gli overlay sono PNG colorati su un dominio RUOTATO (4 angoli), quindi non
 * si puo' decodificare il valore dalla luminanza come per il vento. La
 * pipeline (`build_envimet_overlays.py`) emette per ogni variabile una griglia
 * di valori `<key>.values.json` = { w, h, v: number|null[] } (riga-major,
 * pixel (0,0) = angolo top-left del dominio).
 *
 * Posizionamento: il dominio e' un parallelogramma in lon/lat (rotazione
 * conforme su ~800 m), definito dai 4 angoli [TL, TR, BR, BL]. Per un punto P
 * risolviamo P = TL + u·(TR−TL) + v·(BL−TL): (u,v) ∈ [0,1]² danno colonna/riga.
 */

export type EnvimetSampler = (lon: number, lat: number) => number | null

type Corner = [number, number]
type ValuesGrid = { w: number; h: number; v: (number | null)[] }

export function buildEnvimetSampler(
  corners: [Corner, Corner, Corner, Corner],
  data: ValuesGrid,
): EnvimetSampler {
  const [TL, TR, , BL] = corners
  const e1: [number, number] = [TR[0] - TL[0], TR[1] - TL[1]] // asse colonne
  const e2: [number, number] = [BL[0] - TL[0], BL[1] - TL[1]] // asse righe
  const det = e1[0] * e2[1] - e2[0] * e1[1]
  const { w, h, v } = data

  return (lon, lat) => {
    if (!det) return null
    const dx = lon - TL[0]
    const dy = lat - TL[1]
    const u = (dx * e2[1] - e2[0] * dy) / det
    const vv = (e1[0] * dy - dx * e1[1]) / det
    if (u < 0 || u > 1 || vv < 0 || vv > 1) return null // fuori dominio
    const col = Math.min(w - 1, Math.max(0, Math.floor(u * w)))
    const row = Math.min(h - 1, Math.max(0, Math.floor(vv * h)))
    const val = v[row * w + col]
    return val === null || val === undefined ? null : val
  }
}
