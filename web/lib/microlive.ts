/**
 * "Microclima vivo" — motore CLIENT-SIDE della visualizzazione animata.
 *
 * Tutto il lavoro avviene nel browser: le griglie di valori sono SLICE dei
 * cubi GeoTIFF ENVI-met decodificati client-side (lib/envimetTif) — vettori
 * vento u/v ESATTI a ogni quota da flow_u/flow_v, MRT e umidita' per fumo e
 * foschia. (La vecchia decodifica del PNG `wind_direction` invertendo la LUT
 * viridis non serve piu': i tif grezzi sono la sorgente dati del sito.)
 *
 * Tre sistemi di particelle:
 *
 *  - scie di vento — motore GPU in lib/windgl (transform feedback, derivato da
 *                  WeatherLayers GL): qui si prepara solo la TEXTURE u/v
 *                  ricampionata dal dominio ruotato (buildWindTexture);
 *  - Embers      — pennacchi di FUMO CPU che salgono dove la temperatura
 *                  percepita (MRT) e' alta: la "citta' che brucia" dei canyon
 *                  stradali roventi (sprite soffici, non punti);
 *  - Mist        — foschia lenta e chiara dove l'umidita' relativa e' piu' alta.
 *
 * Embers/Mist riempiono TypedArray che MapViewer impacchetta in IconLayer
 * (billboard con sprite radiale); le scie GPU vivono nel layer deck di
 * lib/windgl.
 */

// ---------------------------------------------------------------------------
// Griglie di valori
// ---------------------------------------------------------------------------

/** Griglia riga-major sul dominio ENVI-met. NaN = NoData. */
export type Grid = { w: number; h: number; v: Float32Array }

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

  /** Inversa di lonLat: da lon/lat alle coordinate (u,v) del dominio ruotato. */
  uvFromLonLat(lon: number, lat: number): [number, number] {
    const dx = lon - this.TL[0]
    const dy = lat - this.TL[1]
    const det = this.e1[0] * this.e2[1] - this.e1[1] * this.e2[0]
    return [
      (dx * this.e2[1] - dy * this.e2[0]) / det,
      (this.e1[0] * dy - this.e1[1] * dx) / det,
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
 * Vettore vento (m/s Est/Nord) a (u,v), dalle slice u/v dei cubi
 * flow_u/flow_v (lib/envimetTif): vettori ESATTI per ogni quota, si
 * ricampionano al volo quando lo slider quota cambia banda (setUV).
 * Convenzione VERIFICATA sui dati: u = componente verso EST, v = verso NORD
 * ("verso cui" scorre il vento, non la convenzione meteo "da dove proviene").
 */
export class WindField {
  private uGrid: Grid
  private vGrid: Grid

  static fromUV(u: Grid, v: Grid): WindField {
    return new WindField(u, v)
  }

  private constructor(u: Grid, v: Grid) {
    this.uGrid = u
    this.vGrid = v
  }

  /** Cambia le griglie quando lo slider quota si muove. */
  setUV(u: Grid, v: Grid) {
    this.uGrid = u
    this.vGrid = v
  }

  at(frame: DomainFrame, u: number, v: number): [number, number] | null {
    const e = frame.sample(this.uGrid, u, v)
    const n = frame.sample(this.vGrid, u, v)
    if (e === null || n === null) return null
    return [e, n]
  }
}

// ---------------------------------------------------------------------------
// Texture u/v per le scie di vento GPU (lib/windgl)
// ---------------------------------------------------------------------------

/** Quota del suolo (m slm) a lon/lat: il piano del dominio (meta ground_plane). */
export type GroundFn = (lon: number, lat: number) => number

/** Esagerazione visiva: a scala quartiere 1 m/s reale sarebbe impercettibile.
 * Usata dal trascinamento delle Embers; le scie GPU hanno il loro speedFactor. */
const WIND_SPEED_SCALE = 7

/** Range m/s dei canali R/G della texture u/v (imageUnscale del layer GPU). */
export const WIND_UNSCALE: [number, number] = [-8, 8]

export type WindTexture = {
  /** RGBA Uint8: R = componente Est, G = Nord (scalate su WIND_UNSCALE), A = dato/nodata. */
  image: { data: Uint8Array; width: number; height: number }
  /** BBox asse-allineata [ovest, sud, est, nord] che avvolge il dominio ruotato. */
  bounds: [number, number, number, number]
}

/**
 * Ricampiona il campo vento (dominio RUOTATO) su una griglia ASSE-ALLINEATA
 * lon/lat, pronta da caricare come texture per il motore particelle GPU
 * (lib/windgl). Riga 0 = nord (convenzione del layer). Fuori dominio o celle
 * NoData -> alpha 0. ~130k campionamenti CPU una tantum: <50 ms.
 */
export function buildWindTexture(
  frame: DomainFrame,
  field: WindField,
  width = 320,
): WindTexture {
  const corners: [number, number][] = [
    frame.lonLat(0, 0),
    frame.lonLat(1, 0),
    frame.lonLat(0, 1),
    frame.lonLat(1, 1),
  ]
  const west = Math.min(...corners.map((c) => c[0]))
  const east = Math.max(...corners.map((c) => c[0]))
  const south = Math.min(...corners.map((c) => c[1]))
  const north = Math.max(...corners.map((c) => c[1]))
  // Altezza proporzionale al bbox in metri (lat "vale" piu' della lon).
  const aspect =
    ((north - south) * 110540) /
    ((east - west) * 111320 * Math.cos((south * Math.PI) / 180))
  const height = Math.max(8, Math.round(width * aspect))
  const [vmin, vmax] = WIND_UNSCALE
  const span = vmax - vmin
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const lat = north - ((y + 0.5) / height) * (north - south)
    for (let x = 0; x < width; x++) {
      const lon = west + ((x + 0.5) / width) * (east - west)
      const [u, v] = frame.uvFromLonLat(lon, lat)
      const w = field.at(frame, u, v)
      const p = (y * width + x) * 4
      if (!w) continue // alpha 0 = nodata
      data[p] = Math.max(0, Math.min(255, Math.round(((w[0] - vmin) / span) * 255)))
      data[p + 1] = Math.max(0, Math.min(255, Math.round(((w[1] - vmin) / span) * 255)))
      data[p + 3] = 255
    }
  }
  return { image: { data, width, height }, bounds: [west, south, east, north] }
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
  /** Turbolenza orizzontale (m/s "visivi"): il fumo billowa invece di salire dritto. */
  swirl: number
}

/** Preset FUMO DI CALDO sul percepito (MRT): la "citta' che brucia".
 * Sui dati reali (11:00 estive) la MRT al sole si schiaccia a 66-80 °C
 * (mediana 66, max 80): soglia alla mediana, peso quadratico cosi' il fumo
 * riempie i canyon stradali al sole e si addensa dove scotta davvero.
 * Sprite soffici grandi e sovrapposti (non punti): la densita' visiva nasce
 * dalla sovrapposizione di tanti blob semi-trasparenti, come i pennacchi
 * volumetrici del video di riferimento (brucia_amsterdam). */
export const EMBER_HEAT: Omit<EmberOptions, 'count'> = {
  threshold: 61, // °C MRT: sotto la mediana, quasi tutto il "sole" emette
  vmax: 80,
  riseM: 18,
  life: [2.6, 5.2],
  radius: [2.8, 7],
  // arancio saturo -> rosso fuoco vivo: deve staccare ANCHE sul foglio
  // temperatura giallo-arancio, non solo sulla basemap scura.
  color: (t) => [
    Math.round(255 - 45 * t),
    Math.round(170 - 130 * t),
    Math.round(60 - 50 * t),
  ],
  alpha: 185,
  flicker: 0.55,
  windDrag: 0.65,
  weightExp: 1.8,
  swirl: 5,
}

/** Preset FOSCHIA sull'umidita' relativa: aloni chiari, lenti, dove e' umido. */
export const EMBER_MIST: Omit<EmberOptions, 'count'> = {
  threshold: 42, // % UR: sopra la mediana del dominio
  vmax: 50,
  riseM: 4,
  life: [5, 9],
  radius: [7, 14],
  color: () => [195, 225, 255],
  alpha: 28,
  flicker: 0,
  windDrag: 0.5,
  weightExp: 1.5,
  swirl: 1.5,
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
  // Buffer binari per IconLayer (sprite di fumo billboard).
  readonly posBuf: Float64Array
  readonly colBuf: Uint8Array
  /** DIAMETRO dello sprite in metri (getSize dell'IconLayer). */
  readonly sizeBuf: Float32Array
  /** Rotazione dello sprite in gradi (getAngle): il fumo "gira" lento. */
  readonly angBuf: Float32Array
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
    this.sizeBuf = new Float32Array(n)
    this.angBuf = new Float32Array(n)
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
      // Trascinamento del vento (il fumo "piega" e scorre lungo la strada).
      if (this.wind && o.windDrag > 0) {
        const w = this.wind.at(this.frame, this.pu[i], this.pv[i])
        if (w) {
          const [du, dv] = this.frame.velToUV(
            w[0] * o.windDrag * WIND_SPEED_SCALE * 0.4,
            w[1] * o.windDrag * WIND_SPEED_SCALE * 0.4,
          )
          this.pu[i] += du * dt
          this.pv[i] += dv * dt
        }
      }
      // Turbolenza: deriva orizzontale pseudo-casuale per particella, cosi' il
      // fumo billowa invece di salire in colonna (fase = seme individuale).
      if (o.swirl > 0) {
        const ang = this.phase[i] * 3.7 + nowS * (0.5 + 0.4 * Math.sin(this.phase[i]))
        const [du, dv] = this.frame.velToUV(
          Math.cos(ang) * o.swirl,
          Math.sin(ang * 1.31 + this.phase[i]) * o.swirl,
        )
        this.pu[i] += du * dt
        this.pv[i] += dv * dt
      }
      this.pu[i] = Math.min(0.999, Math.max(0, this.pu[i]))
      this.pv[i] = Math.min(0.999, Math.max(0, this.pv[i]))
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
      // Il fumo NASCE piccolo e si GONFIA salendo (diametro = 2 * raggio).
      this.sizeBuf[i] =
        2 *
        (o.radius[0] +
          (o.radius[1] - o.radius[0]) * (0.3 + 0.7 * t) * (0.35 + 0.85 * l))
      // Rotazione lenta, meta' orarie e meta' antiorarie (segno dalla fase).
      this.angBuf[i] =
        (this.phase[i] * 57.3 + nowS * 14 * (this.phase[i] > Math.PI ? 1 : -1)) % 360
    }
  }
}

// ---------------------------------------------------------------------------
// Sprite del fumo (atlas per IconLayer)
// ---------------------------------------------------------------------------

/**
 * Blob radiale soffice usato come sprite billboard dal fumo/foschia: bianco al
 * centro che sfuma a trasparente (mask: il colore vero arriva da getColor).
 * Due lobi leggermente sfalsati rompono la simmetria perfetta del gradiente,
 * cosi' gli sprite ruotati non sembrano tutti la stessa "palla".
 */
export function makeSmokeSprite(size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const blob = (cx: number, cy: number, r: number, aMax: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, `rgba(255,255,255,${aMax})`)
    g.addColorStop(0.45, `rgba(255,255,255,${aMax * 0.55})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  blob(size * 0.5, size * 0.5, size * 0.5, 0.85)
  blob(size * 0.38, size * 0.42, size * 0.3, 0.5)
  blob(size * 0.62, size * 0.58, size * 0.26, 0.45)
  return c
}
