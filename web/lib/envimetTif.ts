/**
 * Data layer ENVI-met CLIENT-SIDE: i GeoTIFF grezzi (web/public/data/
 * Envimet_data/) sono LA sorgente dati del sito. Questo modulo li scarica e li
 * decodifica NEL BROWSER (Web Worker, vedi workers/envimetTif.worker.ts) in
 * "cubi" Float32 253x273x54 tenuti in cache, da cui foglio/volume/sezione/
 * particelle e ispezione al click leggono slice e profili a costo zero.
 *
 * Strategia: UN download + UNA decodifica per variabile (i tif sono
 * interleave-pixel: leggere una banda sola decomprimerebbe comunque tutti i
 * tile), poi tutto resta in memoria. Cache LRU: ~8 cubi = ~120 MB, adeguata a
 * una sessione di esplorazione senza gonfiare la RAM dei portatili.
 */
import { DomainFrame, type Grid } from '@/lib/microlive'
import { ENV_CORNERS } from '@/lib/envimetGeo'
import { envVarDef, envTifUrl } from '@/lib/envimetRegistry'

export type EnvimetCube = {
  key: string
  w: number
  h: number
  nz: number
  /** Quota (m sopra il suolo) di ogni banda, dai tag GDAL z_m. */
  zM: Float32Array
  /** Valori banda-major (banda*w*h + riga*w + col), riga 0 = nord, NaN = nodata. */
  data: Float32Array
  /** Min/max osservati e percentili 2-98 (range colore delle variabili senza range fisso). */
  min: number
  max: number
  p2: number
  p98: number
}

type ProgressFn = (loaded: number, total: number) => void

// ---------------------------------------------------------------------------
// Cache LRU + richieste in volo
// ---------------------------------------------------------------------------

const MAX_CUBES = 8
const cubeCache = new Map<string, EnvimetCube>() // insertion order = LRU
const inFlight = new Map<string, Promise<EnvimetCube>>()
const progressFns = new Map<string, Set<ProgressFn>>()

function cachePut(cube: EnvimetCube) {
  cubeCache.delete(cube.key)
  cubeCache.set(cube.key, cube)
  while (cubeCache.size > MAX_CUBES) {
    const oldest = cubeCache.keys().next().value
    if (oldest === undefined) break
    cubeCache.delete(oldest)
    maxZCache.delete(oldest)
  }
}

/** Cubo gia' in cache (e lo marca come usato di recente), altrimenti null. */
export function getCubeSync(key: string): EnvimetCube | null {
  const cube = cubeCache.get(key)
  if (cube) {
    cubeCache.delete(key)
    cubeCache.set(key, cube)
  }
  return cube ?? null
}

// ---------------------------------------------------------------------------
// Worker (con fallback main thread se il worker non parte)
// ---------------------------------------------------------------------------

type WorkerMsg =
  | { type: 'progress'; key: string; loaded: number; total: number }
  | ({ type: 'done'; key: string } & Omit<EnvimetCube, 'key'>)
  | { type: 'error'; key: string; message: string }

type Pending = {
  resolve: (cube: EnvimetCube) => void
  reject: (err: Error) => void
}

let worker: Worker | null = null
let workerBroken = false
const pending = new Map<string, Pending>()

function getWorker(): Worker | null {
  if (workerBroken || typeof window === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/envimetTif.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
    const msg = e.data
    if (msg.type === 'progress') {
      progressFns.get(msg.key)?.forEach((fn) => fn(msg.loaded, msg.total))
      return
    }
    const p = pending.get(msg.key)
    if (!p) return
    pending.delete(msg.key)
    if (msg.type === 'error') {
      p.reject(new Error(msg.message))
      return
    }
    p.resolve({
      key: msg.key,
      w: msg.w,
      h: msg.h,
      nz: msg.nz,
      zM: msg.zM,
      data: msg.data,
      min: msg.min,
      max: msg.max,
      p2: msg.p2,
      p98: msg.p98,
    })
  }
  worker.onerror = () => {
    // Worker morto (es. bundling): fallisce le richieste in volo e da qui in
    // poi si decodifica sul main thread (piu' lento ma funziona).
    workerBroken = true
    pending.forEach((p) => p.reject(new Error('worker di decodifica non disponibile')))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

async function loadViaWorker(key: string, url: string): Promise<EnvimetCube> {
  const w = getWorker()
  if (!w) throw new Error('worker di decodifica non disponibile')
  return new Promise<EnvimetCube>((resolve, reject) => {
    pending.set(key, { resolve, reject })
    w.postMessage({ type: 'load', key, url })
  })
}

/** Fallback: fetch + decodifica sul main thread (import dinamico di geotiff,
 * cosi' il parser non entra nel bundle principale finche' non serve). */
async function loadOnMainThread(key: string, url: string): Promise<EnvimetCube> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${url}`)
  const buffer = await res.arrayBuffer()
  const { decodeEnvimetTif } = await import('@/lib/envimetDecode')
  const cube = await decodeEnvimetTif(buffer)
  return { key, ...cube }
}

/**
 * Carica (o riusa dalla cache) il cubo di una variabile del registry.
 * Richieste concorrenti per la stessa chiave condividono lo stesso download.
 */
export function loadCube(key: string, onProgress?: ProgressFn): Promise<EnvimetCube> {
  const cached = getCubeSync(key)
  if (cached) return Promise.resolve(cached)

  if (onProgress) {
    let fns = progressFns.get(key)
    if (!fns) {
      fns = new Set()
      progressFns.set(key, fns)
    }
    fns.add(onProgress)
  }

  const existing = inFlight.get(key)
  if (existing) return existing

  const def = envVarDef(key)
  if (!def) return Promise.reject(new Error(`variabile ENVI-met sconosciuta: ${key}`))
  const url = envTifUrl(def)

  const p = (async () => {
    try {
      let cube: EnvimetCube
      try {
        cube = await loadViaWorker(key, url)
      } catch {
        cube = await loadOnMainThread(key, url)
      }
      cachePut(cube)
      return cube
    } finally {
      inFlight.delete(key)
      progressFns.delete(key)
    }
  })()
  inFlight.set(key, p)
  return p
}

// ---------------------------------------------------------------------------
// Slice e campionamento
// ---------------------------------------------------------------------------

// Le slice sono memoizzate per cubo: subarray() creerebbe un oggetto NUOVO a
// ogni chiamata, e i consumatori (texture deck, memo colorize) usano
// l'identita' del riferimento per evitare ri-upload.
const sliceCache = new WeakMap<EnvimetCube, (Float32Array | undefined)[]>()

/** Slice orizzontale della banda z (vista zero-copy sul cubo, memoizzata). */
export function bandSlice(cube: EnvimetCube, zIdx: number): Float32Array {
  const plane = cube.w * cube.h
  const b = Math.max(0, Math.min(cube.nz - 1, zIdx))
  let slices = sliceCache.get(cube)
  if (!slices) {
    slices = new Array(cube.nz)
    sliceCache.set(cube, slices)
  }
  let s = slices[b]
  if (!s) {
    s = cube.data.subarray(b * plane, (b + 1) * plane)
    slices[b] = s
  }
  return s
}

const maxZCache = new Map<string, Float32Array>()

/** Massimo lungo la colonna z (vegetazione: la chioma sta in alto). Memoizzato. */
export function maxZSlice(cube: EnvimetCube): Float32Array {
  const hit = maxZCache.get(cube.key)
  if (hit) return hit
  const plane = cube.w * cube.h
  const out = new Float32Array(plane).fill(NaN)
  for (let b = 0; b < cube.nz; b++) {
    const off = b * plane
    for (let p = 0; p < plane; p++) {
      const x = cube.data[off + p]
      if (Number.isNaN(x)) continue
      const cur = out[p]
      if (Number.isNaN(cur) || x > cur) out[p] = x
    }
  }
  maxZCache.set(cube.key, out)
  return out
}

/** Indice della banda con quota z_m piu' vicina a zMeters. */
export function zIndexFor(cube: EnvimetCube, zMeters: number): number {
  let best = 0
  let bestD = Infinity
  for (let b = 0; b < cube.nz; b++) {
    const d = Math.abs(cube.zM[b] - zMeters)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best
}

/** Vista Grid (lib/microlive) di una slice: per WindField/Embers/DomainFrame. */
export function sliceGrid(cube: EnvimetCube, zIdx: number): Grid {
  return { w: cube.w, h: cube.h, v: bandSlice(cube, zIdx) }
}

const FRAME = new DomainFrame(ENV_CORNERS)

/** Frame condiviso del dominio ruotato (u,v in [0,1]^2). */
export function envFrame(): DomainFrame {
  return FRAME
}

/** Valore alla quota zIdx nel punto lon/lat; null fuori dominio o nodata. */
export function sampleAt(
  cube: EnvimetCube,
  lon: number,
  lat: number,
  zIdx: number,
): number | null {
  const [u, v] = FRAME.uvFromLonLat(lon, lat)
  return FRAME.sample(sliceGrid(cube, zIdx), u, v)
}

/** Profilo verticale completo (54 quote) nel punto lon/lat. */
export function verticalProfile(
  cube: EnvimetCube,
  lon: number,
  lat: number,
): { zM: number; v: number | null }[] {
  const [u, v] = FRAME.uvFromLonLat(lon, lat)
  const out: { zM: number; v: number | null }[] = []
  for (let b = 0; b < cube.nz; b++) {
    out.push({ zM: cube.zM[b], v: FRAME.sample(sliceGrid(cube, b), u, v) })
  }
  return out
}

/** Range colore effettivo della variabile: fisso dal registry, altrimenti
 * percentili 2-98 osservati sul cubo. */
export function cubeRange(cube: EnvimetCube): [number, number] {
  const def = envVarDef(cube.key)
  if (def?.range) return def.range
  return cube.p2 < cube.p98 ? [cube.p2, cube.p98] : [cube.min, cube.max]
}
