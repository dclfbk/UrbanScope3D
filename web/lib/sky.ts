/**
 * Cielo dinamico stile streets.gl: il colore del cielo varia con
 * l'altitudine del sole sull'orizzonte (notte / golden hour / pieno
 * giorno). Restituisce uno `SkySpecification` da passare a
 * `map.setSky(...)` (MapLibre GL JS v5+).
 *
 * Inoltre fornisce `nightFactor` per modulare un overlay scuro globale
 * sul canvas quando il sole e' sotto orizzonte.
 */

import type { SkySpecification } from 'maplibre-gl'

type RGB = [number, number, number]

// Palette colori (zenith / horizon / fog) per i 3 stadi del ciclo.
const NIGHT = {
  sky: [4, 7, 26] as RGB, // quasi-nero blu profondo (slate-950)
  horizon: [15, 23, 42] as RGB, // slate-900
  fog: [15, 23, 42] as RGB,
}
const GOLDEN = {
  sky: [253, 186, 116] as RGB, // orange-300
  horizon: [251, 113, 60] as RGB, // tramonto caldo
  fog: [254, 215, 170] as RGB, // orange-200
}
const DAY = {
  sky: [59, 130, 246] as RGB, // blue-500
  horizon: [186, 230, 253] as RGB, // sky-200
  fog: [219, 234, 254] as RGB, // blue-100
}

const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x))

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
]

const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`

/**
 * 0 = pieno giorno, 1 = notte profonda. Smooth nei twilight.
 * Sole a +10° o piu' = pieno giorno; sole a -6° o meno = notte
 * civile/nautica.
 */
export function nightFactor(altitudeDeg: number): number {
  return 1 - smoothstep(-6, 10, altitudeDeg)
}

/**
 * 1 al tramonto/alba (golden hour), 0 fuori. Usata per spalmare il tono
 * caldo arancione sull'orizzonte quando il sole transita per +/-2°.
 */
function goldenFactor(altitudeDeg: number): number {
  // Bell-shape: 0 -> 1 -> 0 sul range [-6, +10] con picco a +2.
  if (altitudeDeg < -6 || altitudeDeg > 10) return 0
  const t = (altitudeDeg + 6) / 16 // 0..1
  return Math.sin(Math.PI * t)
}

export function computeSky(altitudeDeg: number): SkySpecification {
  const n = nightFactor(altitudeDeg)
  const g = goldenFactor(altitudeDeg)
  // Notte ↔ giorno base
  const baseSky = mix(DAY.sky, NIGHT.sky, n)
  const baseHor = mix(DAY.horizon, NIGHT.horizon, n)
  const baseFog = mix(DAY.fog, NIGHT.fog, n)
  // Spalmo il tono golden sopra (peak al transito orizzonte)
  const sky = mix(baseSky, GOLDEN.sky, g * 0.6)
  const horizon = mix(baseHor, GOLDEN.horizon, g * 0.85)
  const fog = mix(baseFog, GOLDEN.fog, g * 0.5)
  return {
    'sky-color': rgb(sky),
    'horizon-color': rgb(horizon),
    'fog-color': rgb(fog),
    'fog-ground-blend': 0.5,
    'horizon-fog-blend': 0.5,
    'sky-horizon-blend': 0.7,
    'atmosphere-blend': 1.0 - 0.4 * n, // atmosfera attenuata di notte
  }
}
