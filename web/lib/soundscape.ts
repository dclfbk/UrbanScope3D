'use client'

/**
 * Paesaggio sonoro SINTETIZZATO con la Web Audio API — nessun file audio (niente
 * asset esterni / copyright): tutti i suoni sono generati a runtime.
 *
 * Idea (ispirata a noisy-city): mentre esplori la ZONA MICROCLIMA si sentono
 * suoni diversi a seconda di cosa c'è sotto — un parco/verde "cinguetta" e resta
 * calmo, una strada trafficata "ronza" di traffico, c'è un filo di vento di
 * fondo. Il MIX (volumi) lo decide il viewer dai dati (vedi computeSoundMix in
 * MapViewer): qui c'è solo il motore audio.
 *
 * Tre layer:
 *  - traffico: rumore "brown" passa-basso (ronzio di città/auto);
 *  - vento: rumore passa-banda con LFO sulla frequenza (raffiche);
 *  - uccelli: cinguettii sintetici (oscillatori con sweep di frequenza)
 *    schedulati a intervalli casuali, con densità/volume = `birdLevel`.
 */

export type SoundMix = { traffic: number; birds: number; wind: number }

type Nodes = {
  ctx: AudioContext
  master: GainNode
  traffic: GainNode
  wind: GainNode
  bird: GainNode
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

export class Soundscape {
  private n: Nodes | null = null
  private birdTimer: ReturnType<typeof setTimeout> | null = null
  private birdLevel = 0

  get active(): boolean {
    return !!this.n
  }

  /** Crea il grafo audio. Va chiamato da un GESTO utente (click) per via delle
   *  policy di autoplay dei browser. */
  start(): void {
    if (this.n || typeof window === 'undefined') return
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()

    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    const noise = this.noiseBuffer(ctx, 2)

    // --- traffico: brown noise -> passa-basso -> gain ---
    const tSrc = ctx.createBufferSource()
    tSrc.buffer = noise
    tSrc.loop = true
    const tLP = ctx.createBiquadFilter()
    tLP.type = 'lowpass'
    tLP.frequency.value = 360
    tLP.Q.value = 0.6
    const traffic = ctx.createGain()
    traffic.gain.value = 0
    tSrc.connect(tLP).connect(traffic).connect(master)
    tSrc.start()

    // --- vento: noise -> passa-banda (con LFO sulla freq = raffiche) -> gain ---
    const wSrc = ctx.createBufferSource()
    wSrc.buffer = noise
    wSrc.loop = true
    const wBP = ctx.createBiquadFilter()
    wBP.type = 'bandpass'
    wBP.frequency.value = 600
    wBP.Q.value = 0.6
    const wind = ctx.createGain()
    wind.gain.value = 0
    wSrc.connect(wBP).connect(wind).connect(master)
    const wLFO = ctx.createOscillator()
    wLFO.frequency.value = 0.14
    const wLFOg = ctx.createGain()
    wLFOg.gain.value = 280
    wLFO.connect(wLFOg).connect(wBP.frequency)
    wLFO.start()
    wSrc.start()

    // --- uccelli: gain di bus; i cinguettii sono schedulati in chirp() ---
    const bird = ctx.createGain()
    bird.gain.value = 1
    bird.connect(master)

    this.n = { ctx, master, traffic, wind, bird }
    master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 0.8)
    this.scheduleBirds()
  }

  /** Imposta i volumi dei tre layer (0..1), con rampa morbida. */
  setMix(mix: SoundMix): void {
    const n = this.n
    if (!n) return
    const t = n.ctx.currentTime
    const ramp = 0.6
    n.traffic.gain.linearRampToValueAtTime(clamp(mix.traffic, 0, 0.4), t + ramp)
    n.wind.gain.linearRampToValueAtTime(clamp(mix.wind, 0, 0.25), t + ramp)
    this.birdLevel = clamp(mix.birds, 0, 1)
  }

  resume(): void {
    this.n?.ctx.resume().catch(() => {})
  }

  /** Ferma e libera l'audio (fade out poi close). */
  stop(): void {
    const n = this.n
    if (!n) return
    const t = n.ctx.currentTime
    n.master.gain.linearRampToValueAtTime(0, t + 0.4)
    if (this.birdTimer) {
      clearTimeout(this.birdTimer)
      this.birdTimer = null
    }
    const ctx = n.ctx
    this.n = null
    setTimeout(() => ctx.close().catch(() => {}), 600)
  }

  // Buffer di rumore "brown" (più morbido del bianco) riusato da traffico/vento.
  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      d[i] = clamp(last * 3.5, -1, 1)
    }
    return buf
  }

  // Pianifica i cinguettii: a intervalli casuali, con probabilità/volume = birdLevel.
  private scheduleBirds(): void {
    const tick = () => {
      if (!this.n) return
      if (this.birdLevel > 0.03 && Math.random() < this.birdLevel) {
        this.chirp(this.birdLevel)
      }
      this.birdTimer = setTimeout(tick, 280 + Math.random() * 520)
    }
    tick()
  }

  // Un cinguettio: oscillatore con un breve sweep di frequenza + inviluppo.
  private chirp(lvl: number): void {
    const n = this.n
    if (!n) return
    const { ctx, bird } = n
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    const g = ctx.createGain()
    g.gain.value = 0
    const base = 2200 + Math.random() * 1900
    o.frequency.setValueAtTime(base, t)
    o.frequency.linearRampToValueAtTime(base * (1.1 + Math.random() * 0.3), t + 0.05)
    o.frequency.linearRampToValueAtTime(base * 0.88, t + 0.11)
    const peak = 0.1 * lvl
    g.gain.linearRampToValueAtTime(peak, t + 0.02)
    g.gain.linearRampToValueAtTime(0, t + 0.13)
    o.connect(g).connect(bird)
    o.start(t)
    o.stop(t + 0.15)
  }
}
