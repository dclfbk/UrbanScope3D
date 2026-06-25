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

// Suolo chiaro "stile streets.gl": il basemap chiaro (Voyager) ha sia il layer
// `background` (#fbf8f3, quasi bianco) sia il `landuse_residential` (beige
// chiaro) che coprono gran parte della scena -> la mappa sembrava un foglio
// bianco. Li uniformiamo a questo verde-salvia naturale, chiaramente NON bianco
// (e nemmeno nero), come il ground uniforme di streets.gl.
export const GROUND_LIGHT: RGB = [150, 161, 137]

// ---------------------------------------------------------------------------
// Brand Talea (manuale d'immagine, documentation/TALEA_BRAND GUIDELINE.pdf).
// La UI chrome usa il BLU come colore primario (vedi scala `talea-*` in
// globals.css). Questi sono gli stessi colori in RGB, disponibili se in futuro
// si vuole portarli anche nel rendering 3D (deck.gl).
// ---------------------------------------------------------------------------
export const TALEA_BLUE: RGB = [18, 114, 183] // #1272B7
export const TALEA_GREEN: RGB = [33, 168, 74] // #21A84A
export const TALEA_GREEN_DARK: RGB = [0, 77, 25] // #004D19
export const TALEA_YELLOW: RGB = [255, 230, 4] // #FFE604

export const withAlpha = (c: RGB, a: number): RGBA => [c[0], c[1], c[2], a]
export const toCss = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`
