/**
 * "Microclima vivo" — motore CLIENT-SIDE della visualizzazione animata.
 *
 * Tutto il lavoro avviene nel browser, a partire dai dati grezzi gia' serviti
 * al client (nessun PNG pre-animato / GIF dal server):
 *
 *  - le griglie di VALORI (`<var>.values.json`, con quote `z`) escono dalla
 *    pipeline come numeri grezzi: qui vengono campionate, pesate e colorate;
 *  - la DIREZIONE del vento non ha (ancora) valori grezzi committati: viene
 *    DECODIFICATA dal PNG `wind_direction.png` invertendo la LUT viridis
 *    (stessa rampa di build_envimet_overlays.py) — una prova concreta di
 *    elaborazione raster lato client. Se in futuro la pipeline esporta
 *    `wind_uv.values.json` (vettori u/v esatti per quota), questo modulo lo
 *    usa al posto della decodifica (vedi WindField.fromMeta).
 *
 * Tre sistemi di particelle, aggiornati in JS a ogni frame e resi con layer
 * deck.gl ad attributi binari (upload GPU ~100 KB/frame, trascurabile):
 *
 *  - WindTrails  — scie stile windy.com avvette dal campo (direzione, velocita'
 *                  alla quota scelta con lo slider);
 *  - Embers      — "fiammelle" che salgono dove la temperatura percepita (MRT)
 *                  e' alta: piu' caldo = piu' dense, piu' veloci, piu' rosse;
 *  - Mist        — foschia lenta e chiara dove l'umidita' relativa e' piu' alta.
 *
 * Nessuna dipendenza da deck.gl qui dentro: i sistemi riempiono TypedArray e
 * MapViewer li impacchetta nei layer (LineLayer / ScatterplotLayer).
 */

// ---------------------------------------------------------------------------
// Griglie di valori
// ---------------------------------------------------------------------------

/** Griglia riga-major sul dominio ENVI-met. NaN = NoData. */
export type Grid = { w: number; h: number; v: Float32Array }

type ValuesJson = {
  w: number
  h: number
  v: (number | null)[]
  z?: Record<string, (number | null)[]>
}

function toFloat32(vals: (number | null)[]): Float32Array {
  const out = new Float32Array(vals.length)
  for (let i = 0; i < vals.length; i++) {
    const x = vals[i]
    out[i] = x === null || x === undefined ? NaN : x
  }
  return out
}

/** Converte un `<var>.values.json` in griglia; `band` sceglie la quota. */
export function gridFromValues(json: ValuesJson, band?: number | null): Grid {
  const grid =
    (band != null && json.z && json.z[String(band)]) || json.v
  return { w: json.w, h: json.h, v: toFloat32(grid) }
}

// ---------------------------------------------------------------------------
// Decodifica PNG -> valori (inversione LUT, client-side)
// ---------------------------------------------------------------------------

type RampStop = [number, [number, number, number]]

/** Stesse rampe di build_envimet_overlays.py (servono per invertire i PNG). */
export const RAMPS: Record<string, RampStop[]> = {
  viridis: [
    [0.0, [68, 1, 84]],
    [0.25, [59, 82, 139]],
    [0.5, [33, 145, 140]],
    [0.75, [94, 201, 98]],
    [1.0, [253, 231, 37]],
  ],
  blues: [
    [0.0, [247, 251, 255]],
    [0.5, [107, 174, 214]],
    [1.0, [8, 48, 107]],
  ],
}

function buildLut(ramp: RampStop[]): Uint8Array {
  // LUT 256x3, identica a build_lut() della pipeline Python.
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
  return lut
}

/**
 * Carica un overlay PNG della pipeline e lo riporta a VALORI cercando per ogni
 * pixel l'indice LUT col colore piu' vicino: value = vmin + idx/255*(vmax-vmin).
 * I pixel NoData (alpha bassa, verde salvia) diventano NaN. ~70k pixel: <100 ms.
 */
export async function decodePngGrid(
  url: string,
  rampKey: keyof typeof RAMPS,
  vmin: number,
  vmax: number,
): Promise<Grid> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error(`PNG non caricabile: ${url}`))
    im.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d non disponibile')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const lut = buildLut(RAMPS[rampKey])
  const out = new Float32Array(canvas.width * canvas.height)
  for (let p = 0; p < out.length; p++) {
    const a = data[p * 4 + 3]
    if (a < 200) {
      out[p] = NaN // NoData (alpha 70 nella pipeline)
      continue
    }
    const r = data[p * 4]
    const g = data[p * 4 + 1]
    const b = data[p * 4 + 2]
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < 256; i++) {
      const dr = r - lut[i * 3]
      const dg = g - lut[i * 3 + 1]
      const db = b - lut[i * 3 + 2]
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    out[p] = vmin + (best / 255) * (vmax - vmin)
  }
  return { w: canvas.width, h: canvas.height, v: out }
}

// ---------------------------------------------------------------------------
// Geometria del dominio (parallelogramma ruotato in lon/lat)
// ---------------------------------------------------------------------------

type Corner = [number, number]

/**
 * Sistema di riferimento (u,v) in [0,1]^2 sul dominio ruotato: stessa
 * convenzione di lib/envimet.ts (u = colonne TL->TR, v = righe TL->BL).
 * Converte velocita' fisiche (m/s Est/Nord) in derivate (du/dt, dv/dt).
 */
export class DomainFrame {
  readonly TL: Corner
  private e1: Corner
  private e2: Corner
  private e1m: [number, number] // e1 in metri (x=Est, y=Nord)
  private e2m: [number, number]
  private len1: number // |e1| in metri (larghezza dominio ~800 m)
  private len2: number

  constructor(corners: [Corner, Corner, Corner, Corner]) {
    const [TL, TR, , BL] = corners
    this.TL = TL
    this.e1 = [TR[0] - TL[0], TR[1] - TL[1]]
    this.e2 = [BL[0] - TL[0], BL[1] - TL[1]]
    const mLat = 110540
    const mLon = 111320 * Math.cos((TL[1] * Math.PI) / 180)
    this.e1m = [this.e1[0] * mLon, this.e1[1] * mLat]
    this.e2m = [this.e2[0] * mLon, this.e2[1] * mLat]
    this.len1 = Math.hypot(...this.e1m)
    this.len2 = Math.hypot(...this.e2m)
  }

  lonLat(u: number, v: number): [number, number] {
    return [
      this.TL[0] + u * this.e1[0] + v * this.e2[0],
      this.TL[1] + u * this.e1[1] + v * this.e2[1],
    ]
  }

  /** (m/s Est, m/s Nord) -> (du/dt, dv/dt): proiezione sugli assi del dominio. */
  velToUV(east: number, north: number): [number, number] {
    const du = (east * this.e1m[0] + north * this.e1m[1]) / (this.len1 * this.len1)
    const dv = (east * this.e2m[0] + north * this.e2m[1]) / (this.len2 * this.len2)
    return [du, dv]
  }

  /** Campiona la griglia al punto (u,v); NaN/fuori dominio -> null. */
  sample(grid: Grid, u: number, v: number): number | null {
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null
    const col = Math.min(grid.w - 1, Math.floor(u * grid.w))
    const row = Math.min(grid.h - 1, Math.floor(v * grid.h))
    const x = grid.v[row * grid.w + col]
    return Number.isNaN(x) ? null : x
  }
}

// ---------------------------------------------------------------------------
// Campo vento
// ---------------------------------------------------------------------------

/**
 * Vettore vento (m/s Est/Nord) a (u,v). Due sorgenti possibili:
 *  - u/v grezzi per quota (`wind_uv.values.json`, se la pipeline li ha emessi);
 *  - direzione decodificata dal PNG (a ~1.5 m) + modulo dai valori grezzi di
 *    `wind_speed` alla quota scelta (approssimazione: la direzione cambia poco
 *    con la quota rispetto al modulo, che invece cresce molto).
 * Convenzione VERIFICATA sui dati (correlazione cella-cella con flow_u/flow_v
 * decodificati: corr(sin(dir),u)=+0.81): qui la direzione e' quella VERSO cui
 * scorre il vento, gradi da nord in senso orario -> E = +sin(dir), N = +cos(dir).
 * (Non e' la convenzione meteo "da dove proviene": segni opposti.)
 */
export class WindField {
  private mode: 'uv' | 'dir'
  private uGrid: Grid | null = null
  private vGrid: Grid | null = null
  private dirGrid: Grid | null = null
  private speedGrid: Grid | null = null

  static fromUV(u: Grid, v: Grid): WindField {
    const f = new WindField('uv')
    f.uGrid = u
    f.vGrid = v
    return f
  }

  static fromDirSpeed(dir: Grid, speed: Grid): WindField {
    const f = new WindField('dir')
    f.dirGrid = dir
    f.speedGrid = speed
    return f
  }

  private constructor(mode: 'uv' | 'dir') {
    this.mode = mode
  }

  /** Cambia la griglia del modulo quando lo slider quota si muove. */
  setSpeedGrid(speed: Grid) {
    this.speedGrid = speed
  }

  setUV(u: Grid, v: Grid) {
    this.uGrid = u
    this.vGrid = v
  }

  at(frame: DomainFrame, u: number, v: number): [number, number] | null {
    if (this.mode === 'uv') {
      if (!this.uGrid || !this.vGrid) return null
      const e = frame.sample(this.uGrid, u, v)
      const n = frame.sample(this.vGrid, u, v)
      if (e === null || n === null) return null
      return [e, n]
    }
    if (!this.dirGrid || !this.speedGrid) return null
    const dir = frame.sample(this.dirGrid, u, v)
    const s = frame.sample(this.speedGrid, u, v)
    if (dir === null || s === null) return null
    const rad = (dir * Math.PI) / 180
    return [s * Math.sin(rad), s * Math.cos(rad)]
  }
}

// ---------------------------------------------------------------------------
// Scie di vento (stile windy.com)
// ---------------------------------------------------------------------------

/** Quota del suolo (m slm) a lon/lat: il piano del dominio (meta ground_plane). */
export type GroundFn = (lon: number, lat: number) => number

const WIND_COUNT = 1400
const WIND_TAIL = 5 // posizioni memorizzate -> TAIL-1 segmenti per scia
/** Esagerazione visiva: a scala quartiere 1 m/s reale sarebbe impercettibile. */
const WIND_SPEED_SCALE = 7
const WIND_MAX_AGE = [2.5, 6] // s, casuale per particella

export class WindTrails {
  private frame: DomainFrame
  private field: WindField
  private ground: GroundFn
  /** Quota (m sul suolo) a cui volano le scie = quota dello slider. */
  zM = 1.5
  private pos: Float32Array // u,v per particella
  private age: Float32Array
  private maxAge: Float32Array
  private tail: Float64Array // [particella][WIND_TAIL][lon,lat,alt]
  private speed: Float32Array // ultimo modulo campionato (per il colore)
  // Buffer binari per LineLayer (source/target xyz + rgba).
  readonly src: Float64Array
  readonly dst: Float64Array
  readonly col: Uint8Array
  readonly segments = WIND_COUNT * (WIND_TAIL - 1)

  constructor(frame: DomainFrame, field: WindField, ground: GroundFn) {
    this.frame = frame
    this.field = field
    this.ground = ground
    this.pos = new Float32Array(WIND_COUNT * 2)
    this.age = new Float32Array(WIND_COUNT)
    this.maxAge = new Float32Array(WIND_COUNT)
    this.tail = new Float64Array(WIND_COUNT * WIND_TAIL * 3)
    this.speed = new Float32Array(WIND_COUNT)
    this.src = new Float64Array(this.segments * 3)
    this.dst = new Float64Array(this.segments * 3)
    this.col = new Uint8Array(this.segments * 4)
    for (let i = 0; i < WIND_COUNT; i++) this.respawn(i)
  }

  private respawn(i: number) {
    const u = Math.random()
    const v = Math.random()
    this.pos[i * 2] = u
    this.pos[i * 2 + 1] = v
    this.age[i] = 0
    this.maxAge[i] =
      WIND_MAX_AGE[0] + Math.random() * (WIND_MAX_AGE[1] - WIND_MAX_AGE[0])
    this.speed[i] = 0
    const [lon, lat] = this.frame.lonLat(u, v)
    const alt = this.ground(lon, lat) + this.zM + 1
    for (let k = 0; k < WIND_TAIL; k++) {
      this.tail[(i * WIND_TAIL + k) * 3] = lon
      this.tail[(i * WIND_TAIL + k) * 3 + 1] = lat
      this.tail[(i * WIND_TAIL + k) * 3 + 2] = alt
    }
  }

  step(dt: number) {
    for (let i = 0; i < WIND_COUNT; i++) {
      const u = this.pos[i * 2]
      const v = this.pos[i * 2 + 1]
      const w = this.field.at(this.frame, u, v)
      this.age[i] += dt
      if (!w || this.age[i] > this.maxAge[i]) {
        this.respawn(i)
        continue
      }
      const s = Math.hypot(w[0], w[1])
      this.speed[i] = s
      const [du, dv] = this.frame.velToUV(
        w[0] * WIND_SPEED_SCALE,
        w[1] * WIND_SPEED_SCALE,
      )
      const nu = u + du * dt
      const nv = v + dv * dt
      if (nu < 0 || nu >= 1 || nv < 0 || nv >= 1) {
        this.respawn(i)
        continue
      }
      this.pos[i * 2] = nu
      this.pos[i * 2 + 1] = nv
      // Scorro la coda di una posizione e scrivo la nuova testa.
      for (let k = WIND_TAIL - 1; k > 0; k--) {
        const a = (i * WIND_TAIL + k) * 3
        const b = (i * WIND_TAIL + k - 1) * 3
        this.tail[a] = this.tail[b]
        this.tail[a + 1] = this.tail[b + 1]
        this.tail[a + 2] = this.tail[b + 2]
      }
      const [lon, lat] = this.frame.lonLat(nu, nv)
      const head = i * WIND_TAIL * 3
      this.tail[head] = lon
      this.tail[head + 1] = lat
      this.tail[head + 2] = this.ground(lon, lat) + this.zM + 1
    }
    // Ricostruisco i buffer dei segmenti (testa = luminosa, coda = svanisce).
    let s3 = 0
    let s4 = 0
    for (let i = 0; i < WIND_COUNT; i++) {
      // Fade-in in ~0.5 s alla nascita per evitare "lampi" al respawn.
      const born = Math.min(1, this.age[i] / 0.5)
      // Colore: lento = azzurro tenue, veloce = quasi bianco.
      const t = Math.min(1, this.speed[i] / 3.5)
      const r = 150 + 105 * t
      const g = 200 + 55 * t
      const b = 255
      for (let k = 0; k < WIND_TAIL - 1; k++) {
        const a = (i * WIND_TAIL + k) * 3
        const bb = (i * WIND_TAIL + k + 1) * 3
        this.src[s3] = this.tail[bb]
        this.src[s3 + 1] = this.tail[bb + 1]
        this.src[s3 + 2] = this.tail[bb + 2]
        this.dst[s3] = this.tail[a]
        this.dst[s3 + 1] = this.tail[a + 1]
        this.dst[s3 + 2] = this.tail[a + 2]
        const fade = 1 - k / (WIND_TAIL - 1)
        this.col[s4] = r
        this.col[s4 + 1] = g
        this.col[s4 + 2] = b
        this.col[s4 + 3] = Math.round(190 * fade * born)
        s3 += 3
        s4 += 4
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Particelle "a densita'" (fiamme di calore, foschia di umidita')
// ---------------------------------------------------------------------------

export type EmberOptions = {
  count: number
  /** Sotto questa soglia la cella non emette nulla. */
  threshold: number
  /** Normalizzazione colore/intensita': val in [threshold, vmax]. */
  vmax: number
  /** Altezza di salita (m) a intensita' massima. */
  riseM: number
  /** Vita di una particella [min,max] s. */
  life: [number, number]
  /** Raggio (m) [min,max], scalato con l'intensita'. */
  radius: [number, number]
  /** Rampa colore della particella (t in [0,1] = intensita' della cella). */
  color: (t: number) => [number, number, number]
  /** Alpha massima (0-255). */
  alpha: number
  /** Sfarfallio (0 = niente, 1 = pieno: fiamme si', foschia no). */
  flicker: number
  /** Quanto il vento trascina le particelle (0-1). */
  windDrag: number
  /** Esponente del peso di emissione: alto = concentra sulle celle piu' intense. */
  weightExp: number
}

/** Preset FIAMME sul caldo percepito (MRT): dove "scotta" il quartiere brucia.
 * Sui dati reali (11:00 estive) la MRT al sole si schiaccia a 66-80 °C
 * (mediana 66, max 80): soglia alla mediana + peso CUBICO cosi' le fiamme si
 * addensano sui canyon stradali piu' roventi invece di coprire tutto il sole. */
export const EMBER_HEAT: Omit<EmberOptions, 'count'> = {
  threshold: 66, // °C MRT ~ mediana del dominio a mezzogiorno
  vmax: 80,
  riseM: 12,
  life: [1.6, 3.2],
  radius: [0.7, 2.2],
  color: (t) => [255, Math.round(200 - 130 * t), Math.round(90 - 80 * t)],
  alpha: 210,
  flicker: 1,
  windDrag: 0.35,
  weightExp: 3,
}

/** Preset FOSCHIA sull'umidita' relativa: aloni chiari, lenti, dove e' umido. */
export const EMBER_MIST: Omit<EmberOptions, 'count'> = {
  threshold: 42, // % UR: sopra la mediana del dominio
  vmax: 50,
  riseM: 3,
  life: [4, 8],
  radius: [3.5, 7],
  color: () => [195, 225, 255],
  alpha: 46,
  flicker: 0,
  windDrag: 0.5,
  weightExp: 1.5,
}

export class Embers {
  private frame: DomainFrame
  private ground: GroundFn
  private wind: WindField | null
  private opts: EmberOptions
  // Celle emettitrici: indice cella + CDF cumulata dei pesi per il sampling.
  private cells: Uint32Array
  private cdf: Float64Array
  private inten: Float32Array // intensita' normalizzata [0,1] per cella emettitrice
  private gw = 0
  private gh = 0
  // Stato particelle.
  private pu: Float32Array
  private pv: Float32Array
  private pt: Float32Array // intensita' della cella di nascita
  private age: Float32Array
  private life: Float32Array
  private phase: Float32Array
  // Buffer binari per ScatterplotLayer.
  readonly posBuf: Float64Array
  readonly colBuf: Uint8Array
  readonly radBuf: Float32Array
  readonly count: number
  /** false se nessuna cella supera la soglia (niente da mostrare). */
  readonly active: boolean

  constructor(
    frame: DomainFrame,
    grid: Grid,
    ground: GroundFn,
    wind: WindField | null,
    opts: EmberOptions,
  ) {
    this.frame = frame
    this.ground = ground
    this.wind = wind
    this.opts = opts
    this.gw = grid.w
    this.gh = grid.h
    // Pesi: (val - soglia)^weightExp -> le zone piu' intense dominano.
    const cells: number[] = []
    const weights: number[] = []
    const intens: number[] = []
    const span = Math.max(1e-6, opts.vmax - opts.threshold)
    for (let p = 0; p < grid.v.length; p++) {
      const x = grid.v[p]
      if (Number.isNaN(x) || x <= opts.threshold) continue
      const t = Math.min(1, (x - opts.threshold) / span)
      cells.push(p)
      weights.push(Math.pow(t, opts.weightExp))
      intens.push(t)
    }
    this.cells = Uint32Array.from(cells)
    this.inten = Float32Array.from(intens)
    this.cdf = new Float64Array(weights.length)
    let acc = 0
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i]
      this.cdf[i] = acc
    }
    this.active = acc > 0
    const n = this.active ? opts.count : 0
    this.count = n
    this.pu = new Float32Array(n)
    this.pv = new Float32Array(n)
    this.pt = new Float32Array(n)
    this.age = new Float32Array(n)
    this.life = new Float32Array(n)
    this.phase = new Float32Array(n)
    this.posBuf = new Float64Array(n * 3)
    this.colBuf = new Uint8Array(n * 4)
    this.radBuf = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      this.respawn(i)
      // Eta' iniziale casuale: il sistema parte gia' "a regime".
      this.age[i] = Math.random() * this.life[i]
    }
  }

  private respawn(i: number) {
    // Campionamento della cella dalla CDF (ricerca binaria).
    const target = Math.random() * this.cdf[this.cdf.length - 1]
    let lo = 0
    let hi = this.cdf.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.cdf[mid] < target) lo = mid + 1
      else hi = mid
    }
    const cell = this.cells[lo]
    const row = Math.floor(cell / this.gw)
    const colc = cell % this.gw
    this.pu[i] = (colc + Math.random()) / this.gw
    this.pv[i] = (row + Math.random()) / this.gh
    this.pt[i] = this.inten[lo]
    this.age[i] = 0
    this.life[i] =
      this.opts.life[0] + Math.random() * (this.opts.life[1] - this.opts.life[0])
    this.phase[i] = Math.random() * Math.PI * 2
  }

  step(dt: number, nowS: number) {
    const o = this.opts
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt
      if (this.age[i] > this.life[i]) this.respawn(i)
      // Trascinamento del vento (le fiamme "piegano", la foschia deriva).
      if (this.wind && o.windDrag > 0) {
        const w = this.wind.at(this.frame, this.pu[i], this.pv[i])
        if (w) {
          const [du, dv] = this.frame.velToUV(
            w[0] * o.windDrag * WIND_SPEED_SCALE * 0.4,
            w[1] * o.windDrag * WIND_SPEED_SCALE * 0.4,
          )
          this.pu[i] = Math.min(0.999, Math.max(0, this.pu[i] + du * dt))
          this.pv[i] = Math.min(0.999, Math.max(0, this.pv[i] + dv * dt))
        }
      }
      const l = this.age[i] / this.life[i] // vita normalizzata 0..1
      const t = this.pt[i]
      const [lon, lat] = this.frame.lonLat(this.pu[i], this.pv[i])
      // Salita: piu' intensa la cella, piu' in alto arriva la particella.
      const rise = o.riseM * (0.35 + 0.65 * t) * l
      this.posBuf[i * 3] = lon
      this.posBuf[i * 3 + 1] = lat
      this.posBuf[i * 3 + 2] = this.ground(lon, lat) + 0.6 + rise
      // Alpha a campana sulla vita + sfarfallio.
      let a = o.alpha * 4 * l * (1 - l) * (0.35 + 0.65 * t)
      if (o.flicker > 0) {
        a *= 1 - o.flicker * 0.3 * (0.5 + 0.5 * Math.sin(nowS * 11 + this.phase[i]))
      }
      const [r, g, b] = o.color(t)
      this.colBuf[i * 4] = r
      this.colBuf[i * 4 + 1] = g
      this.colBuf[i * 4 + 2] = b
      this.colBuf[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a)))
      this.radBuf[i] =
        o.radius[0] + (o.radius[1] - o.radius[0]) * (0.3 + 0.7 * t) * (0.6 + 0.4 * l)
    }
  }
}
