/**
 * Registry statico delle variabili ENVI-met: l'ex overlays.json della pipeline
 * Python, committato come TypeScript. Da qui la UI costruisce toggle, legenda,
 * rampe colore e URL dei GeoTIFF; il data layer (lib/envimetTif.ts) li carica
 * e li decodifica NEL BROWSER — non esiste piu' nessun PNG/JSON precotto.
 *
 * Per AGGIUNGERE una variabile: copia il tif in web/public/data/Envimet_data/,
 * aggiungi (o aggiorna) la voce in ENV_VARS qui sotto, fine. Vedi
 * documentation/12_envimet-aggiungere-dati.md.
 */
import { withBase } from '@/lib/basePath'
import type { PaletteStop } from '@/lib/windgl/texture'

export type RampKey = 'ylorrd' | 'blues' | 'greens' | 'magma' | 'viridis' | 'rdbu'

export type EnvimetVarDef = {
  key: string
  /** Nome file in web/public/data/Envimet_data/ (54 bande z, 253x273). */
  file: string
  label: { it: string; en: string }
  /** Descrizione divulgativa mostrata in legenda (solo curati). */
  desc?: { it: string; en: string }
  unit: string
  ramp: RampKey
  /** Range colore FISSO [vmin, vmax] ("stesso colore = stesso valore" fra
   * quote e simulazioni). null = range dai percentili 2-98 osservati sul cubo. */
  range: [number, number] | null
  /** 'band' = si mostra una quota alla volta (slider); 'maxz' = massimo lungo
   * la colonna z (vegetazione: la chioma sta in alto, a 1.5 m e' quasi zero). */
  agg: 'band' | 'maxz'
  /** true = dato curato per i cittadini (slider quote, click, descrizione).
   * false = variabile tecnica (visibile solo con SHOW_TECHNICAL_ENVIMET). */
  curated: boolean
  /** true = tif committato e deployato su Pages; false = funziona solo in
   * locale se il file c'e' (il toggle degrada con un messaggio, online). */
  shipped: boolean
}

// ---------------------------------------------------------------------------
// Rampe colore (stop t in [0,1]) — stesse della vecchia pipeline Python, cosi'
// i colori restano identici ai PNG storici. Unico punto di verita' client.
// ---------------------------------------------------------------------------

type RampStop = [number, [number, number, number]]

export const ENV_RAMPS: Record<RampKey, RampStop[]> = {
  ylorrd: [
    // giallo -> rosso (temperatura, MRT)
    [0.0, [255, 255, 178]],
    [0.25, [254, 217, 118]],
    [0.5, [254, 178, 76]],
    [0.75, [253, 141, 60]],
    [1.0, [189, 0, 38]],
  ],
  blues: [
    // umidita' / vento
    [0.0, [247, 251, 255]],
    [0.5, [107, 174, 214]],
    [1.0, [8, 48, 107]],
  ],
  greens: [
    // vegetazione LAD
    [0.0, [247, 252, 245]],
    [0.5, [116, 196, 118]],
    [1.0, [0, 68, 27]],
  ],
  magma: [
    // radiazione SW
    [0.0, [0, 0, 4]],
    [0.25, [81, 18, 124]],
    [0.5, [183, 55, 121]],
    [0.75, [252, 137, 97]],
    [1.0, [252, 253, 191]],
  ],
  viridis: [
    // generica (variabili tecniche)
    [0.0, [68, 1, 84]],
    [0.25, [59, 82, 139]],
    [0.5, [33, 145, 140]],
    [0.75, [94, 201, 98]],
    [1.0, [253, 231, 37]],
  ],
  rdbu: [
    // divergente (delta / variazioni / flussi)
    [0.0, [33, 102, 172]],
    [0.5, [247, 247, 247]],
    [1.0, [178, 24, 43]],
  ],
}

/** Stop di palette (formato windgl/texture.ts) sul range dati [vmin, vmax]. */
export function paletteStopsFor(ramp: RampKey, vmin: number, vmax: number): PaletteStop[] {
  return ENV_RAMPS[ramp].map(([t, [r, g, b]]) => [vmin + t * (vmax - vmin), [r, g, b]])
}

/** Gradiente CSS `linear-gradient(...)` della rampa, per la legenda. */
export function rampCssGradient(ramp: RampKey): string {
  const stops = ENV_RAMPS[ramp]
    .map(([t, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round(t * 100)}%`)
    .join(', ')
  return `linear-gradient(to right, ${stops})`
}

/** Colore [r,g,b] della rampa a t in [0,1] (per legende/edifici lato CPU). */
export function rampColorAt(ramp: RampKey, t: number): [number, number, number] {
  const stops = ENV_RAMPS[ramp]
  const x = Math.max(0, Math.min(1, t))
  for (let j = 0; j < stops.length - 1; j++) {
    const [t0, c0] = stops[j]
    const [t1, c1] = stops[j + 1]
    if (x <= t1) {
      const f = t1 === t0 ? 0 : (x - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ]
    }
  }
  return stops[stops.length - 1][1]
}

// ---------------------------------------------------------------------------
// Le variabili — 8 curate + le tecniche. `shipped` segna i tif committati su
// git (deployati su Pages): gli altri funzionano solo con il file in locale.
// ---------------------------------------------------------------------------

export const ENV_VARS: EnvimetVarDef[] = [
  // --- Dati CURATI per i cittadini (slider quote, click, descrizione) -------
  {
    key: 'temperature',
    file: '08_potential_air_temperature_all_z.tif',
    label: { it: "Temperatura dell'aria", en: 'Air temperature' },
    desc: {
      it: 'Quanto è calda l’aria all’altezza delle persone. Il rosso segna le zone dove si sente più caldo.',
      en: 'How hot the air is at human height. Red marks the spots where it feels hottest.',
    },
    unit: '°C', ramp: 'ylorrd', range: [24, 40], agg: 'band', curated: true, shipped: true,
  },
  {
    key: 'humidity',
    file: '12_relative_humidity_all_z.tif',
    label: { it: "Umidità dell'aria", en: 'Air humidity' },
    desc: {
      it: 'Quanta umidità c’è nell’aria. Valori alti = aria più afosa e pesante da respirare.',
      en: 'How much moisture is in the air. High values = muggier, heavier air.',
    },
    unit: '%', ramp: 'blues', range: [30, 70], agg: 'band', curated: true, shipped: true,
  },
  {
    key: 'vegetation_lad',
    file: '17_vegetation_lad_all_z.tif',
    label: { it: 'Vegetazione (chioma)', en: 'Vegetation (canopy)' },
    desc: {
      it: 'Quanto è fitta la chioma degli alberi: più è alta, più ombra e frescura regala il verde.',
      en: 'How dense the tree canopy is: the higher it is, the more shade and cooling the greenery gives.',
    },
    unit: 'm²/m³', ramp: 'greens', range: [0, 0.5], agg: 'maxz', curated: true, shipped: true,
  },
  {
    key: 'direct_sw',
    file: '18_direct_sw_radiation_all_z.tif',
    label: { it: 'Sole diretto', en: 'Direct sunlight' },
    desc: {
      it: 'Quanto sole diretto colpisce il suolo. Le zone più chiare sono le più esposte, senza ombra.',
      en: 'How much direct sunlight hits the ground. Brighter zones are the most exposed, with no shade.',
    },
    unit: 'W/m²', ramp: 'magma', range: [0, 1000], agg: 'band', curated: true, shipped: true,
  },
  {
    key: 'diffuse_sw',
    file: '19_diffuse_sw_radiation_all_z.tif',
    label: { it: 'Luce diffusa dal cielo', en: 'Diffuse sky light' },
    desc: {
      it: 'La luce del sole diffusa dal cielo, che arriva anche dove c’è ombra.',
      en: 'Sunlight scattered by the sky, reaching even shaded areas.',
    },
    unit: 'W/m²', ramp: 'magma', range: [0, 200], agg: 'band', curated: true, shipped: true,
  },
  {
    key: 'reflected_sw',
    file: '20_reflected_sw_radiation_all_z.tif',
    label: { it: 'Sole riflesso da muri e suolo', en: 'Sun reflected off walls & ground' },
    desc: {
      it: 'Il sole rimbalzato da muri e pavimenti: aumenta il caldo percepito nelle strade strette.',
      en: 'Sunlight bounced off walls and pavement: it adds to the perceived heat in narrow streets.',
    },
    unit: 'W/m²', ramp: 'magma', range: [0, 400], agg: 'band', curated: true, shipped: true,
  },
  {
    key: 'mean_radiant_temp',
    file: '26_mean_radiant_temp_all_z.tif',
    label: { it: 'Temperatura percepita', en: 'Perceived temperature' },
    desc: {
      it: 'Il caldo che senti davvero sulla pelle: somma sole diretto e calore di muri e asfalto. È l’indice più vicino al “quanto soffro il caldo”.',
      en: 'The heat your body actually feels: direct sun plus heat radiating from walls and pavement. The closest thing to “how much the heat bothers me”.',
    },
    unit: '°C', ramp: 'ylorrd', range: [20, 80], agg: 'band', curated: true, shipped: true,
  },
  {
    key: 'wind_speed',
    file: '04_wind_speed_all_z.tif',
    label: { it: 'Velocità del vento', en: 'Wind speed' },
    desc: {
      it: 'Quanto soffia il vento. In strada è più debole, salendo con lo slider cresce: il vento porta via il caldo e rinfresca.',
      en: 'How strong the wind blows. It is weaker at street level and grows as you raise the slider: wind carries heat away and cools things down.',
    },
    unit: 'm/s', ramp: 'blues', range: [0, 6], agg: 'band', curated: true, shipped: true,
  },

  // --- Supporto (non compaiono nel pannello: servono a vivo/volume) ---------
  // objects: maschera voxel edifici/vegetazione, usata dal volume 3D per
  // fermare i raggi dentro gli edifici. flow_u/v: vettori vento veri per il
  // motore particelle (direzione esatta a OGNI quota).
  {
    key: 'objects', file: '00_objects_all_z.tif',
    label: { it: 'Oggetti / edifici (maschera)', en: 'Objects / buildings (mask)' },
    unit: '', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: true,
  },
  {
    key: 'flow_u', file: '01_flow_u_all_z.tif',
    label: { it: 'Vento componente U (E-O)', en: 'Wind component U (E–W)' },
    unit: 'm/s', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: true,
  },
  {
    key: 'flow_v', file: '02_flow_v_all_z.tif',
    label: { it: 'Vento componente V (N-S)', en: 'Wind component V (N–S)' },
    unit: 'm/s', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: true,
  },
  {
    key: 'flow_w', file: '03_flow_w_all_z.tif',
    label: { it: 'Vento componente W (verticale)', en: 'Wind component W (vertical)' },
    unit: 'm/s', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: true,
  },

  // --- Variabili tecniche (solo con SHOW_TECHNICAL_ENVIMET, solo locale) ----
  {
    key: 'wind_speed_change', file: '05_wind_speed_change_all_z.tif',
    label: { it: 'Variazione velocità vento', en: 'Wind speed change' },
    unit: '%', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'wind_direction', file: '06_wind_direction_all_z.tif',
    label: { it: 'Direzione del vento', en: 'Wind direction' },
    unit: 'deg', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'pressure_perturbation', file: '07_pressure_perturbation_all_z.tif',
    label: { it: 'Perturbazione di pressione', en: 'Pressure perturbation' },
    unit: 'dPa', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'air_temperature_delta', file: '09_air_temperature_delta_all_z.tif',
    label: { it: 'Δ Temperatura aria', en: 'Air temperature Δ' },
    unit: 'K', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'air_temperature_change', file: '10_air_temperature_change_all_z.tif',
    label: { it: 'Variazione temperatura aria', en: 'Air temperature change' },
    unit: 'K/h', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'specific_humidity', file: '11_specific_humidity_all_z.tif',
    label: { it: 'Umidità specifica', en: 'Specific humidity' },
    unit: 'g/kg', ramp: 'blues', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'tke', file: '13_tke_all_z.tif',
    label: { it: 'Turbolenza (TKE)', en: 'Turbulence (TKE)' },
    unit: 'm²/m³', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'tke_dissipation', file: '14_tke_dissipation_all_z.tif',
    label: { it: 'Dissipazione turbolenza', en: 'Turbulence dissipation' },
    unit: 'm³/m³', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'vertical_exchange_coef_impuls', file: '15_vertical_exchange_coef_impuls_all_z.tif',
    label: { it: 'Coeff. scambio verticale', en: 'Vertical exchange coef.' },
    unit: 'm²/s', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'horizontal_exchange_coef_impuls', file: '16_horizontal_exchange_coef_impuls_all_z.tif',
    label: { it: 'Coeff. scambio orizzontale', en: 'Horizontal exchange coef.' },
    unit: 'm²/s', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'temperature_flux', file: '21_temperature_flux_all_z.tif',
    label: { it: 'Flusso di calore', en: 'Temperature flux' },
    unit: 'K*m/s', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'vapour_flux', file: '22_vapour_flux_all_z.tif',
    label: { it: 'Flusso di vapore', en: 'Vapour flux' },
    unit: 'g/kg*m/s', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'water_on_leafes', file: '23_water_on_leafes_all_z.tif',
    label: { it: 'Acqua sulle foglie', en: 'Water on leaves' },
    unit: 'g/m²', ramp: 'greens', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'leaf_temperature', file: '24_leaf_temperature_all_z.tif',
    label: { it: 'Temperatura foglie', en: 'Leaf temperature' },
    unit: '°C', ramp: 'ylorrd', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'local_mixing_length', file: '25_local_mixing_length_all_z.tif',
    label: { it: 'Lunghezza di mescolamento', en: 'Mixing length' },
    unit: 'm', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'tke_normalised_1d', file: '27_tke_normalised_1d_all_z.tif',
    label: { it: 'TKE normalizzata', en: 'TKE normalised' },
    unit: '', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'dissipation_normalised_1d', file: '28_dissipation_normalised_1d_all_z.tif',
    label: { it: 'Dissipazione normalizzata', en: 'Dissipation normalised' },
    unit: '', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'km_normalised_1d', file: '29_km_normalised_1d_all_z.tif',
    label: { it: 'Km normalizzato', en: 'Km normalised' },
    unit: '', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'tke_mechanical_turbulence_prod', file: '30_tke_mechanical_turbulence_prod_all_z.tif',
    label: { it: 'Produzione turbolenza meccanica', en: 'Mechanical turbulence production' },
    unit: '', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'stomata_resistance', file: '31_stomata_resistance_all_z.tif',
    label: { it: 'Resistenza stomatica', en: 'Stomata resistance' },
    unit: 's/m', ramp: 'greens', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'co2', file: '32_co2_all_z.tif',
    label: { it: 'CO₂ (qualità aria)', en: 'CO₂ (air quality)' },
    unit: 'mg/m3', ramp: 'greens', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'co2_2', file: '33_co2_2_all_z.tif',
    label: { it: 'CO₂ (ppm)', en: 'CO₂ (ppm)' },
    unit: 'ppm', ramp: 'greens', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'plant_co2_flux', file: '34_plant_co2_flux_all_z.tif',
    label: { it: 'Flusso CO₂ vegetazione', en: 'Plant CO₂ flux' },
    unit: 'mg/m²s', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'div_lw_radiation_temp_change', file: '35_div_lw_radiation_temp_change_all_z.tif',
    label: { it: 'Variazione T da radiazione IR', en: 'IR radiation temp. change' },
    unit: 'K/h', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'natural_convection_velocity', file: '36_natural_convection_velocity_all_z.tif',
    label: { it: 'Velocità convezione naturale', en: 'Natural convection velocity' },
    unit: 'm/s', ramp: 'rdbu', range: null, agg: 'band', curated: false, shipped: false,
  },
  {
    key: 'building_number', file: '37_building_number_all_z.tif',
    label: { it: 'Numero edificio (maschera)', en: 'Building number (mask)' },
    unit: '', ramp: 'viridis', range: null, agg: 'band', curated: false, shipped: false,
  },
]

const BY_KEY = new Map(ENV_VARS.map((v) => [v.key, v]))

export function envVarDef(key: string): EnvimetVarDef | null {
  return BY_KEY.get(key) ?? null
}

/** URL del GeoTIFF della variabile (same-origin, rispetta il basePath). */
export function envTifUrl(def: EnvimetVarDef): string {
  return withBase(`/data/Envimet_data/${def.file}`)
}
