/**
 * Palette ispirata all'identita' cromatica tradizionale di Bologna:
 * il rosso mattone dei portici, l'ocra delle facciate del centro
 * storico, il sangiovese delle ombre. I codici Pantone qui sotto sono
 * riferimenti di colore commerciali piu' vicini al tono fisico --
 * NON sono i Pantone ufficiali del manuale d'immagine del Comune (che
 * non e' pubblicamente estraibile). Sostituire quando disponibile.
 *
 * Uso: i layer di rendering (deck.gl) leggono da qui, in modo che la
 * palette del comune si possa cambiare in un solo file.
 */

export type RGBA = [number, number, number, number]
export type RGB = [number, number, number]

// Rosso mattone dei portici (Pantone ~1815 C).
export const BOLOGNA_RED: RGB = [158, 42, 43]
export const BOLOGNA_RED_DARK: RGB = [98, 23, 8] // Pantone ~7616 C

// Ocra/sabbia delle facciate del centro storico (Pantone ~7508 C / ~7507 C).
export const BOLOGNA_OCRA: RGB = [212, 165, 116]
export const BOLOGNA_SAND: RGB = [232, 220, 196]

// Sangiovese: rosso scuro vinoso, per accenti e bordi.
export const BOLOGNA_SANGIOVESE: RGB = [123, 36, 28]

// Verde scuro "campagna bolognese": sostituisce il nero del basemap
// dark di Carto sotto/intorno ai tile, cosi' il terreno arriva fino
// all'orizzonte invece di sparire nel buio.
export const BOLOGNA_FOREST_DARK: RGB = [31, 56, 38]

export const withAlpha = (c: RGB, a: number): RGBA => [c[0], c[1], c[2], a]
export const toCss = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`
