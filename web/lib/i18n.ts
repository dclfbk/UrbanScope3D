/**
 * i18n minimale per la UI del viewer. Non uso react-i18next /
 * next-intl per evitare di tirarci dietro un'intera dipendenza per
 * ~25 stringhe. Quando l'app cresce, migrare a next-intl e' una
 * sostituzione 1:1 (la stessa key, lo stesso lookup).
 */

export type Lang = 'it' | 'en'

export const STRINGS = {
  // Pannelli
  layer: { it: 'Cosa vedere', en: 'What to see' },
  zone: { it: 'Quartieri', en: 'Districts' },
  basemap: { it: 'Basemap', en: 'Basemap' },

  // Categorie layer
  cat_edifici: { it: 'Edifici', en: 'Buildings' },
  cat_verde: { it: 'Verde', en: 'Green' },
  cat_ambiente: { it: 'Ambiente', en: 'Environment' },
  cat_microclima: { it: 'Microclima', en: 'Microclimate' },

  // Layer labels
  layer_buildings_3d: { it: 'Edifici 3D', en: 'Buildings 3D' },
  layer_shadows: { it: 'Ombre', en: 'Shadows' },
  layer_buildings_temp: { it: 'Temperatura degli edifici', en: 'Building temperature' },
  layer_trees: { it: 'Alberi', en: 'Trees' },
  layer_arredo: { it: 'Arredo urbano', en: 'Street furniture' },
  layer_green: { it: 'Aree verdi', en: 'Green areas' },
  layer_parks: { it: 'Parchi pubblici', en: 'Public parks' },
  layer_private_green: { it: 'Verde privato', en: 'Private green' },
  layer_air: { it: 'Qualita’ aria', en: 'Air quality' },
  layer_noise: { it: 'Rumore acustico (stima)', en: 'Acoustic noise (est.)' },

  // Search / Loading
  loading: { it: 'Caricamento Bologna 3D…', en: 'Loading Bologna 3D…' },
  searchPlaceholder: {
    it: 'Cerca una via, un quartiere o un luogo…',
    en: 'Search a street, district or place…',
  },
  go: { it: 'Vai', en: 'Go' },
  clearSearch: { it: 'Pulisci ricerca', en: 'Clear search' },
  quartierePrefix: { it: 'Quartiere', en: 'Neighborhood' },
  deselectQuartiere: { it: 'Deseleziona quartiere', en: 'Deselect neighborhood' },

  // Bussola
  resetNorth: { it: 'Riallinea a Nord', en: 'Reset North' },

  // Time slider
  sun: { it: 'Sole', en: 'Sun' },
  day: { it: 'giorno', en: 'day' },
  night: { it: 'notte', en: 'night' },

  // Info panel
  point: { it: 'Punto', en: 'Point' },
  temperatureOn: { it: 'Temperatura', en: 'Temperature' },
  avg: { it: 'media', en: 'avg' },
  max: { it: 'max', en: 'max' },
  min: { it: 'min', en: 'min' },
  loadingShort: { it: 'caricamento…', en: 'loading…' },
  noData: { it: 'Nessun dato', en: 'No data' },
  climatologyNote: {
    it: 'climatologia, media su {n} anni',
    en: 'climatology, mean over {n} years',
  },
  microclimaValues: { it: 'Microclima (punto)', en: 'Microclimate (point)' },
  tempSource: {
    it: 'sorgente: Open Data Bologna (citta’-wide)',
    en: 'source: Open Data Bologna (city-wide)',
  },
  close: { it: 'Chiudi', en: 'Close' },

  // Legenda overlay microclima
  legend: { it: 'Legenda', en: 'Legend' },

  // Panel toggles
  showLayers: { it: 'Mostra «Cosa vedere»', en: 'Show panel' },
  hideLayers: { it: 'Nascondi «Cosa vedere»', en: 'Hide panel' },
  showZones: { it: 'Mostra zone', en: 'Show areas' },
  hideZones: { it: 'Nascondi zone', en: 'Hide areas' },

  // Vista pulita + screenshot
  hidePanels: { it: 'Vista pulita (nascondi pannelli)', en: 'Clean view (hide panels)' },
  showPanels: { it: 'Mostra pannelli', en: 'Show panels' },
  screenshot: { it: 'Scarica screenshot', en: 'Download screenshot' },

  // Meteo (widget 3BMeteo)
  meteo: { it: 'Meteo', en: 'Weather' },
  meteoTitle: { it: 'Meteo Bologna', en: 'Bologna weather' },

  // Condivisione
  share: { it: 'Condividi', en: 'Share' },
  shareText: {
    it: 'Bologna in 3D — UrbanScope3D',
    en: 'Bologna in 3D — UrbanScope3D',
  },
  shareCopied: {
    it: 'Link copiato negli appunti',
    en: 'Link copied to clipboard',
  },
} as const

export type StringKey = keyof typeof STRINGS

export const t = (key: StringKey, lang: Lang): string => STRINGS[key][lang]

export const tFmt = (
  key: StringKey,
  lang: Lang,
  vars: Record<string, string | number>,
): string => {
  let s = STRINGS[key][lang] as string
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}
