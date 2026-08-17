'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import {
  _SunLight as SunLight,
  AmbientLight,
  LightingEffect,
  LayerExtension,
  type Layer,
} from '@deck.gl/core'
import {
  GeoJsonLayer,
  IconLayer,
  ScatterplotLayer,
  TextLayer,
} from '@deck.gl/layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { Geometry } from '@luma.gl/engine'
import { getSunPosition, toMapLibreLight } from '@/lib/sun'
import { computeSky, nightFactor } from '@/lib/sky'
import {
  Embers,
  EMBER_HEAT,
  EMBER_MIST,
  WindField,
  WIND_UNSCALE,
  buildWindTexture,
  makeSmokeSprite,
  type DomainFrame,
  type WindTexture,
} from '@/lib/microlive'
import {
  ENV_BOUNDS,
  ENV_CORNERS,
  ENV_GROUND_PLANE,
  ENV_SOURCE,
  groundAt as envGroundAt,
} from '@/lib/envimetGeo'
import {
  ENV_VARS,
  rampCssGradient,
  type EnvimetVarDef,
} from '@/lib/envimetRegistry'
import {
  bandSlice,
  cubeRange,
  envFrame,
  getCubeSync,
  loadCube,
  maxZSlice,
  sliceGrid,
  verticalProfile,
  type EnvimetCube,
} from '@/lib/envimetTif'
import { colorizeSlice } from '@/lib/envimetColor'
import { WindParticleLayer, type PaletteStop } from '@/lib/windgl'
import { t, type Lang, type StringKey } from '@/lib/i18n'
import TimeSlider from '@/components/UI/TimeSlider'
import InfoPanel from '@/components/UI/InfoPanel'
import MeteoWidget from '@/components/UI/MeteoWidget'
import { withBase } from '@/lib/basePath'
import {
  BOLOGNA_FOREST_DARK,
  BOLOGNA_OCRA,
  BOLOGNA_RED,
  BOLOGNA_ROOF,
  BOLOGNA_SANGIOVESE,
  toCss,
  withAlpha,
  type RGB,
} from '@/lib/palette'

// Gli overlay microclima ENVI-met (38 variabili) NON sono piu' elencati qui:
// vengono dal registry statico lib/envimetRegistry (ENV_VARS) e sono gestiti
// in `envVisible` (Record per `key`), non nel record `visibility` tipizzato.
// I DATI si leggono dai GeoTIFF grezzi decodificati nel browser
// (lib/envimetTif): niente piu' PNG/JSON precotti dalla pipeline Python.
type LayerKey =
  | 'buildings-3d'
  | 'shadows'
  | 'buildings-temp'
  | 'trees'
  | 'arredo'
  | 'green-areas'
  | 'parks'
  | 'private-green'
  | 'air-stations'
  | 'noise'

type CategoryKey = 'edifici' | 'verde' | 'ambiente' | 'microclima'

// Le variabili ENVI-met vengono dal registry statico (lib/envimetRegistry):
// niente piu' overlays.json. Il range colore delle variabili tecniche (range
// null nel registry) si raffina coi percentili del cubo una volta caricato.
const ENV_OVERLAYS: EnvimetVarDef[] = ENV_VARS
// Range colore da mostrare in legenda: fisso dal registry, altrimenti dai
// percentili 2-98 del cubo caricato (fallback 0-1 finche' non c'e').
function envRangeOf(o: EnvimetVarDef): { min: number; max: number } {
  if (o.range) return { min: o.range[0], max: o.range[1] }
  const cube = getCubeSync(o.key)
  if (!cube) return { min: 0, max: 1 }
  const [mn, mx] = cubeRange(cube)
  const r = (x: number) => Math.round(x * 10) / 10
  return { min: r(mn), max: r(mx) }
}

// Centralina qualita' aria (output di join_air_stations.py): punto + medie.
type AirStation = {
  geometry: { coordinates: [number, number] }
  properties: {
    id?: string
    name?: string
    type?: string
    no2_avg?: number | null
    pm10_avg?: number | null
    pm25_avg?: number | null
    ozone_avg?: number | null
    samples?: number
    window_end?: string
  }
}

const CATEGORIES: {
  key: CategoryKey
  labelKey: StringKey
  defaultOpen: boolean
}[] = [
  { key: 'edifici', labelKey: 'cat_edifici', defaultOpen: true },
  { key: 'verde', labelKey: 'cat_verde', defaultOpen: true },
  // Microclima PRIMA di Ambiente (richiesta utente): e' il cuore del progetto.
  { key: 'microclima', labelKey: 'cat_microclima', defaultOpen: false },
  { key: 'ambiente', labelKey: 'cat_ambiente', defaultOpen: false },
  // (Categoria 'territorio' / uso del suolo RIMOSSA su richiesta utente.)
]

// rawLabel: etichetta diretta (non i18n) per i layer ENVI-met, che prendono
// il nome dal JSON. Per gli altri layer si usa labelKey -> t().
const LAYERS: {
  id: LayerKey
  labelKey?: StringKey
  rawLabel?: string
  default: boolean
  category: CategoryKey
}[] = [
  { id: 'buildings-3d', labelKey: 'layer_buildings_3d', default: true, category: 'edifici' },
  // Arredo urbano (panchine, ecc.) come modellini 3D — OFF di default.
  { id: 'arredo', labelKey: 'layer_arredo', default: false, category: 'edifici' },
  // (Ombre temporaneamente rimosse dal pannello su richiesta: il layer/logica
  // restano nel codice, ma niente toggle -> ombre off.)
  // (Layer "Edifici footprint 2D" RIMOSSO dal pannello su richiesta utente.)
  // "Temperatura degli edifici": dato ENVI-met -> sta nella categoria
  // 'microclima' (reso a mano nel branch microclima, non nella lista generica).
  { id: 'buildings-temp', labelKey: 'layer_buildings_temp', default: false, category: 'microclima' },
  // Aree verdi + verde privato ON di default. Alberi OFF di default (~100k
  // istanze: l'utente li accende quando servono).
  // (Layer "parks" rimosso: stesso dataset di green-areas, ridondante.)
  { id: 'trees', labelKey: 'layer_trees', default: false, category: 'verde' },
  { id: 'green-areas', labelKey: 'layer_green', default: true, category: 'verde' },
  { id: 'private-green', labelKey: 'layer_private_green', default: true, category: 'verde' },
  { id: 'air-stations', labelKey: 'layer_air', default: false, category: 'ambiente' },
  // (Layer "Velocità vento" 2D RIMOSSO: era un singolo PNG a ~0.3 m. Il vento
  // ora è solo il dato 3D `wind_speed` in Microclima, con quote/slider.)
  { id: 'noise', labelKey: 'layer_noise', default: false, category: 'ambiente' },
  // (Gli overlay microclima ENVI-met sono dinamici: vedi categoria 'microclima'
  // resa da `envimetOverlays` + stato `envVisible`.)
]

// Data/ora della simulazione ENVI-met, estratta da ENV_SOURCE (costante del
// registry, es. "ENVI-met PILOT-01-TALEA 2024-07-27 11:00") e formattata per
// la legenda. I dati microclima sono una FOTOGRAFIA di quell'istante: non
// variano col giorno reale, quindi lo dichiariamo esplicitamente.
const ENV_MONTHS_IT = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
]
const ENV_MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
function formatEnvDate(source: string | null, lang: 'it' | 'en'): string | null {
  if (!source) return null
  const m = source.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/)
  if (!m) return null
  const [, y, mo, d, hm] = m
  const mi = parseInt(mo, 10) - 1
  const day = parseInt(d, 10)
  if (mi < 0 || mi > 11) return null
  return lang === 'it'
    ? `${day} ${ENV_MONTHS_IT[mi]} ${y}, ore ${hm}`
    : `${day} ${ENV_MONTHS_EN[mi]} ${y}, ${hm}`
}

// Mostrare o no il sotto-gruppo "Dati tecnici" del microclima (le ~30 variabili
// ENVI-met grezze oltre ai 7 dati curati). Di DEFAULT false: il sito e' per i
// cittadini, vedono solo i 7 dati chiari. Per RIATTIVARE i dati tecnici metti
// `true` qui (ricompaiono in fondo al gruppo Microclima, in un menu a scomparsa).
// Vedi documentation/12_envimet-aggiungere-dati.md §7.
const SHOW_TECHNICAL_ENVIMET = false

// Etichetta bilingue e descrizione divulgativa vengono dal registry
// (lib/envimetRegistry): un punto unico per label/desc/unita'/rampe.
const envLabel = (o: EnvimetVarDef, lang: Lang): string => o.label[lang]

const BUILDINGS_FOOTPRINT_URL = withBase('/data/1)Buildings/1.1_Edifici_Particellari.geojson')
const BUILDINGS_HEIGHTS_URL = withBase('/data/processed/buildings_heights.geojson')
// Stima della dimensione DECOMPRESSA del GeoJSON edifici (~32 MB), denominatore
// della barra di avanzamento. Il Content-Length non e' affidabile: se il file
// e' servito gzip/br riporta i byte COMPRESSI, mentre lo stream ne legge di
// decompressi. Quindi usiamo questa stima fissa e fermiamo la barra a 99%
// finche' il parse non e' davvero finito.
const BUILDINGS_BYTES_EST = 32_400_000
// Alberi UFFICIALI del Comune (dataset "alberi-manutenzioni", con specie):
// sorgente primaria. Fallback agli OSM, poi al DBTR. Vedi
// scripts/download_bologna_assets.py.
const TREES_BOLOGNA_URL = withBase('/data/processed/trees_bologna.geojson')
const TREES_DBTR_URL = withBase('/data/2)Vegetation/2.1_trees_aoi.geojson')
const TREES_OSM_URL = withBase('/data/processed/trees_osm.geojson')
// Arredo urbano del Comune (dataset "arredo": panchine, fontanelle, ...).
const ARREDO_URL = withBase('/data/processed/arredo_bologna.geojson')
// Terreno 3D: DEM Terrarium AUTO-OSPITATO in locale. Copre anche i colli a sud
// che il DTM locale 0.5m (~1.3 km sul centro) non include. I tile sono scaricati
// dall'AOI con scripts/download_terrain_tiles.py; le quote di base di
// edifici/alberi sono cotte dagli STESSI tile (scripts/bake_terrain_elevation.py)
// cosi' poggiano esattamente sulla superficie invece di stare a z=0.
//
// IMPORTANTE: serviti dalla stessa origine del sito. L'endpoint pubblico AWS
// (s3.amazonaws.com/elevation-tiles-prod) NON manda header CORS, e MapLibre
// raster-dem deve leggere i pixel per decodificare la quota: da S3 il terreno
// resterebbe piatto e gli edifici "volerebbero".
const TERRAIN_TILES_URL = withBase('/data/processed/terrain/{z}/{x}/{y}.png')
// Terreno renderizzato a UN SOLO zoom (z14), uguale a quello con cui sono cotte
// le quote di base di edifici/alberi/quartieri (bake_terrain_elevation.py
// --zoom 14). Perche': se il terreno varia LOD con la distanza (z11 lontano,
// z15 vicino) mentre le basi sono fisse a z14, in lontananza il terreno e' un
// filo piu' basso e gli edifici restano "rialzati di un po'". Forzando
// min=max=14 la superficie renderizzata coincide ESATTAMENTE con le basi cotte
// a ogni distanza/zoom -> niente edifici sospesi. I tile z14 coprono tutti gli
// edifici e tutto il maxBounds (verificato: lon 11.206-11.470 / lat 44.402-44.575).
// NB: oltre quella copertura (orizzonte profondo a sud) il terreno torna piatto,
// ma e' fuori dal maxBounds e comunque in zona dissolvenza edifici.
// Tile DEM presenti su disco dallo zoom 11 al 15. minzoom 11 = il terreno (e
// quindi le colline a sud) resta attivo anche quando si zooma FUORI; prima era
// 14 e sotto quel livello il DEM spariva -> mappa piatta. maxzoom 14 = oltre si
// sovra-zooma il tile 14 (le basi di edifici/alberi sono cotte a z14).
const TERRAIN_MINZOOM = 11
const TERRAIN_MAXZOOM = 14
const TERRAIN_EXAGGERATION = 1
// (Quota base e piano del suolo del dominio ENVI-met: costanti in
// lib/envimetGeo — le quote z_m delle bande sono RELATIVE al suolo, quindi il
// foglio microclima va a suolo_locale + z_m. Esagerazione terreno = 1, quindi
// i metri deck combaciano col terreno MapLibre.)
const GREEN_URL = withBase('/data/green.geojson')
const PRIVATE_GREEN_URL = withBase('/data/2)Vegetation/2.2_Verde_Privato_Urbanizzato.geojson')
// URL pubblico (GitHub Pages) usato nella condivisione: in locale
// window.location.href sarebbe localhost, ma vogliamo sempre linkare la
// produzione. Vedi .github/workflows/pages.yml.
const SHARE_URL = 'https://dclfbk.github.io/UrbanScope3D/'
const AIR_STATIONS_URL = withBase('/data/processed/air_stations.geojson')
const NOISE_URL = withBase('/data/processed/noise_roads.geojson')
const QUARTIERI_URL = withBase('/data/processed/quartieri.geojson')

type BasemapId = 'light' | 'dark' | 'satellite' | 'ortofoto'
const BASEMAPS: Record<
  BasemapId,
  { label: string; style: maplibregl.StyleSpecification | string }
> = {
  // Basemap chiaro di DEFAULT (Carto Voyager): mappa cittadina leggibile, niente
  // sfondo nero. Le etichette native (scure) restano leggibili -> NON sbiancare.
  light: {
    label: 'Mappa',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  },
  dark: {
    label: 'Dark',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  satellite: {
    label: 'Satellite',
    style: {
      version: 8,
      sources: {
        'satellite-source': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution:
            'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        },
      },
      layers: [
        {
          id: 'satellite-layer',
          type: 'raster',
          source: 'satellite-source',
        },
      ],
    } as unknown as maplibregl.StyleSpecification,
  },
  // Ortofoto AGEA 2020 RGB della Regione Emilia-Romagna (WMS regionale,
  // EPSG:3857). Layer ufficiale `Agea2020_RGB`; piu' aggiornata della
  // satellite Esri generica. CC BY 4.0.
  ortofoto: {
    label: 'Ortofoto ER',
    style: {
      version: 8,
      sources: {
        'ortofoto-source': {
          type: 'raster',
          tiles: [
            'https://servizigis.regione.emilia-romagna.it/wms/agea2020_rgb?' +
              'service=WMS&request=GetMap&version=1.3.0' +
              '&layers=Agea2020_RGB&styles=&format=image/jpeg' +
              '&transparent=false&width=256&height=256' +
              '&crs=EPSG:3857&bbox={bbox-epsg-3857}',
          ],
          tileSize: 256,
          attribution:
            'Ortofoto AGEA 2020 &copy; Regione Emilia-Romagna (CC BY 4.0)',
        },
      },
      layers: [
        {
          id: 'ortofoto-layer',
          type: 'raster',
          source: 'ortofoto-source',
        },
      ],
    } as unknown as maplibregl.StyleSpecification,
  },
}

// Tinge il layer `background` del basemap così il terreno non è né bianco né
// nero dove manca dettaglio (colline a sud). Sul chiaro (Voyager) usa un
// verde-salvia tenue stile streets.gl; sul dark il verde campagna scuro. Per i
// basemap raster (satellite/ortofoto) non esiste layer `background` -> no-op.
const tintBasemapBackground = (map: maplibregl.Map, id: BasemapId) => {
  // SOLO sul basemap scuro: il dark-matter ha background nero che si confonde
  // col cielo/buio -> lo tingiamo di verde campagna. Sul chiaro (Voyager) NON
  // tocchiamo nulla: terreno/strade restano com'erano in origine.
  if (id === 'dark' && map.getLayer('background')) {
    map.setPaintProperty('background', 'background-color', toCss(BOLOGNA_FOREST_DARK))
  }
}

const AOI_CENTER: [number, number] = [11.343720439501553, 44.49989258707834]
const DEFAULT_BUILDING_HEIGHT = 15

// Albero stilizzato: tronco cilindrico + chioma. Due forme di chioma generate
// proceduralmente (nessun asset esterno): coni sovrapposti per le conifere,
// sfera per le latifoglie. La forma si sceglie dal tag OSM leaf_type. Il raggio
// del tronco e' proporzionale all'altezza (vedi trunkRadiusOf).

// Mesh di un alberello a 3 tier conici, asse su +Z (base z=0, apice z~1.3).
// Plain mesh {positions, normals, indices} cosi' deck.gl SimpleMeshLayer lo
// disegna dritto in su senza ambiguita' di orientamento (a differenza di una
// ConeGeometry luma.gl, il cui asse e' su Y).
function makeFirMesh() {
  const seg = 12
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  let idx = 0
  const tiers = [
    { z0: 0.0, r: 1.0, h: 0.65 },
    { z0: 0.45, r: 0.72, h: 0.62 },
    { z0: 0.82, r: 0.44, h: 0.5 },
  ]
  for (const { z0, r, h } of tiers) {
    const zApex = z0 + h
    const nrm = (a: number) => {
      const nx = Math.cos(a) * h
      const ny = Math.sin(a) * h
      const nz = r
      const l = Math.hypot(nx, ny, nz) || 1
      return [nx / l, ny / l, nz / l]
    }
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2
      const a1 = ((i + 1) / seg) * Math.PI * 2
      const am = (a0 + a1) / 2
      positions.push(
        Math.cos(a0) * r, Math.sin(a0) * r, z0,
        Math.cos(a1) * r, Math.sin(a1) * r, z0,
        0, 0, zApex,
      )
      const n0 = nrm(a0), n1 = nrm(a1), na = nrm(am)
      normals.push(...n0, ...n1, ...na)
      indices.push(idx, idx + 1, idx + 2)
      idx += 3
    }
  }
  return new Geometry({
    topology: 'triangle-list',
    attributes: {
      POSITION: { value: new Float32Array(positions), size: 3 },
      NORMAL: { value: new Float32Array(normals), size: 3 },
    },
    indices: { value: new Uint16Array(indices), size: 1 },
  })
}
// Mesh sferica low-poly (chioma latifoglia): UV sphere raggio 0.5 traslata
// in z cosi' si estende da z=0 (base, appoggiata sulla cima del tronco) a z=1.
function makeBlobMesh() {
  const latBands = 6
  const lonBands = 8
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (let la = 0; la <= latBands; la++) {
    const theta = (la / latBands) * Math.PI
    const st = Math.sin(theta)
    const ct = Math.cos(theta)
    for (let lo = 0; lo <= lonBands; lo++) {
      const phi = (lo / lonBands) * Math.PI * 2
      const nx = st * Math.cos(phi)
      const ny = st * Math.sin(phi)
      const nz = ct
      positions.push(nx * 0.5, ny * 0.5, nz * 0.5 + 0.5)
      normals.push(nx, ny, nz)
    }
  }
  const ring = lonBands + 1
  for (let la = 0; la < latBands; la++) {
    for (let lo = 0; lo < lonBands; lo++) {
      const a = la * ring + lo
      const b = a + ring
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  return new Geometry({
    topology: 'triangle-list',
    attributes: {
      POSITION: { value: new Float32Array(positions), size: 3 },
      NORMAL: { value: new Float32Array(normals), size: 3 },
    },
    indices: { value: new Uint16Array(indices), size: 1 },
  })
}

// Conifera = coni (z 0..~1.32), latifoglia = sfera (z 0..1). Gli ZMAX servono
// a convertire un'altezza in metri nello scale verticale del SimpleMeshLayer.
const CONIFER_MESH = makeFirMesh()
const BROADLEAF_MESH = makeBlobMesh()
const CONIFER_ZMAX = 1.32
const BROADLEAF_ZMAX = 1.0

// --- Mesh per l'ARREDO URBANO (modellini 3D in METRI, come gli alberi) -------
// Composte da scatole: una panchina (gambe+seduta+schienale) e un paletto
// generico per gli altri arredi. Normali per-faccia -> illuminazione corretta.
type Box = [number, number, number, number, number, number] // x0,y0,z0,x1,y1,z1
function addQuad(
  P: number[], N: number[], I: number[],
  a: number[], b: number[], c: number[], d: number[], n: number[],
) {
  const base = P.length / 3
  P.push(...a, ...b, ...c, ...d)
  for (let k = 0; k < 4; k++) N.push(...n)
  I.push(base, base + 1, base + 2, base, base + 2, base + 3)
}
function addBox(P: number[], N: number[], I: number[], box: Box) {
  const [x0, y0, z0, x1, y1, z1] = box
  addQuad(P, N, I, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0])
  addQuad(P, N, I, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0])
  addQuad(P, N, I, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0])
  addQuad(P, N, I, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0])
  addQuad(P, N, I, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1])
  addQuad(P, N, I, [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1])
}
// Cilindro/troncocono ad asse +Z, centro (cx,cy), da z0 a z1, raggio r0->r1.
// Normali radiali (fianchi lisci) + due tappi piatti. Si appende a P/N/I come
// addBox cosi' i modelli si compongono di piu' pezzi (pali, barili, colonne).
function addCyl(
  P: number[], N: number[], I: number[],
  cx: number, cy: number, z0: number, z1: number,
  r0: number, r1: number, seg = 14, caps = true,
) {
  const side = P.length / 3
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    const cosA = Math.cos(a), sinA = Math.sin(a)
    P.push(cx + cosA * r0, cy + sinA * r0, z0); N.push(cosA, sinA, 0)
    P.push(cx + cosA * r1, cy + sinA * r1, z1); N.push(cosA, sinA, 0)
  }
  for (let i = 0; i < seg; i++) {
    const a = side + i * 2
    I.push(a, a + 2, a + 3, a, a + 3, a + 1)
  }
  if (!caps) return
  const top = P.length / 3
  P.push(cx, cy, z1); N.push(0, 0, 1)
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    P.push(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, z1); N.push(0, 0, 1)
  }
  for (let i = 0; i < seg; i++) I.push(top, top + 1 + i, top + 2 + i)
  const bot = P.length / 3
  P.push(cx, cy, z0); N.push(0, 0, -1)
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    P.push(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, z0); N.push(0, 0, -1)
  }
  for (let i = 0; i < seg; i++) I.push(bot, bot + 2 + i, bot + 1 + i)
}
function meshFrom(P: number[], N: number[], I: number[]) {
  return new Geometry({
    topology: 'triangle-list',
    attributes: {
      POSITION: { value: new Float32Array(P), size: 3 },
      NORMAL: { value: new Float32Array(N), size: 3 },
    },
    indices: { value: new Uint16Array(I), size: 1 },
  })
}
// Costruisce un mesh componibile chiamando addBox/addCyl dentro `build`.
function meshOf(build: (P: number[], N: number[], I: number[]) => void) {
  const P: number[] = [], N: number[] = [], I: number[] = []
  build(P, N, I)
  return meshFrom(P, N, I)
}
// Panchina ~1.6 m a doghe: gambe tonde, seduta e schienale a listelli, braccioli.
const BENCH_MESH = meshOf((P, N, I) => {
  // gambe tonde (ghisa) ai 4 angoli
  for (const sx of [-0.7, 0.7])
    for (const sy of [-0.18, 0.18])
      addCyl(P, N, I, sx, sy, 0, 0.45, 0.035, 0.035, 8)
  // traversa sotto la seduta che collega le gambe
  addBox(P, N, I, [-0.72, -0.04, 0.36, 0.72, 0.04, 0.42])
  // seduta: 4 doghe lungo x (gap tra loro)
  const seatY = [-0.22, -0.10, 0.02, 0.14]
  for (const y of seatY) addBox(P, N, I, [-0.80, y, 0.44, 0.80, y + 0.09, 0.48])
  // schienale: 3 doghe orizzontali leggermente arretrate
  const backZ = [0.56, 0.66, 0.76]
  for (const z of backZ) addBox(P, N, I, [-0.80, 0.18, z, 0.80, 0.23, z + 0.07])
  // braccioli (montante tondo + corrimano)
  for (const sx of [-0.74, 0.74]) {
    addCyl(P, N, I, sx, 0.0, 0.48, 0.66, 0.028, 0.028, 6)
    addBox(P, N, I, [sx - 0.05, -0.20, 0.64, sx + 0.05, 0.20, 0.70])
  }
})
// Cestino cilindrico su palo, con coperchio e fascia (stile cestino urbano).
const BIN_MESH = meshOf((P, N, I) => {
  addCyl(P, N, I, 0, 0, 0, 0.46, 0.045, 0.045, 8) // palo
  addCyl(P, N, I, 0, 0, 0.44, 0.92, 0.20, 0.185) // corpo (leggera rastremazione)
  addCyl(P, N, I, 0, 0, 0.92, 0.96, 0.215, 0.215) // fascia/orlo
  addCyl(P, N, I, 0, 0, 0.97, 1.04, 0.20, 0.135) // coperchio a cupola
})
// Fontana stile colonna in ghisa bolognese: base, colonna rastremata, collare,
// cupolino e beccuccio laterale. Tonda -> riconoscibile a colpo d'occhio.
const FOUNTAIN_MESH = meshOf((P, N, I) => {
  addCyl(P, N, I, 0, 0, 0, 0.10, 0.24, 0.20) // base
  addCyl(P, N, I, 0, 0, 0.10, 0.92, 0.12, 0.095) // colonna
  addCyl(P, N, I, 0, 0, 0.92, 0.99, 0.16, 0.16) // collare
  addCyl(P, N, I, 0, 0, 0.99, 1.16, 0.14, 0.02) // cupolino
  addBox(P, N, I, [0.09, -0.045, 0.74, 0.30, 0.045, 0.82]) // beccuccio
})
// Ringhiera/recinzione (~1.5 m): due montanti, due correnti e 4 pilastrini.
const RAILING_MESH = meshOf((P, N, I) => {
  addBox(P, N, I, [-0.74, -0.04, 0, -0.66, 0.04, 0.96]) // montante sx
  addBox(P, N, I, [0.66, -0.04, 0, 0.74, 0.04, 0.96]) // montante dx
  addBox(P, N, I, [-0.76, -0.025, 0.84, 0.76, 0.025, 0.92]) // corrente alto
  addBox(P, N, I, [-0.76, -0.025, 0.46, 0.76, 0.025, 0.54]) // corrente medio
  for (let k = 0; k < 4; k++) {
    const x = -0.42 + k * 0.28
    addBox(P, N, I, [x - 0.02, -0.02, 0.1, x + 0.02, 0.02, 0.86]) // pilastrino
  }
})
// Arredo generico/senza classe: dissuasore (paracarro) tondo con cupolino.
const POST_MESH = meshOf((P, N, I) => {
  addCyl(P, N, I, 0, 0, 0, 0.80, 0.10, 0.09) // fusto
  addCyl(P, N, I, 0, 0, 0.66, 0.72, 0.115, 0.115) // anello
  addCyl(P, N, I, 0, 0, 0.80, 0.90, 0.09, 0.02) // cupolino
})
// Lampione (per la modalita' inserimento): basamento, palo rastremato, braccio
// ricurvo a 2 segmenti e lanterna troncoconica con cappello.
const LAMP_MESH = meshOf((P, N, I) => {
  addCyl(P, N, I, 0, 0, 0, 0.14, 0.11, 0.10) // basamento
  addCyl(P, N, I, 0, 0, 0.14, 3.5, 0.075, 0.05) // palo rastremato
  // braccio "a frusta" in due segmenti che sale e si curva
  addBox(P, N, I, [-0.02, -0.025, 3.4, 0.30, 0.025, 3.56])
  addBox(P, N, I, [0.26, -0.025, 3.5, 0.6, 0.025, 3.58])
  // lanterna: troncoconico + cappello
  addCyl(P, N, I, 0.56, 0, 3.18, 3.46, 0.14, 0.10) // corpo lampada
  addCyl(P, N, I, 0.56, 0, 3.46, 3.56, 0.13, 0.05) // cappello
})
// Fontana monumentale TONDA da piazza: vasca circolare in pietra, colonna
// centrale a coppe e zampillo. Resa in DUE mesh (pietra + acqua azzurra) per
// avere due colori, come l'albero (tronco+chioma). Raggio vasca ~1.6 m.
const BIG_FOUNTAIN_STONE = meshOf((P, N, I) => {
  addCyl(P, N, I, 0, 0, 0, 0.18, 1.7, 1.7) // zoccolo
  addCyl(P, N, I, 0, 0, 0.18, 0.62, 1.6, 1.55) // vasca (parete)
  addCyl(P, N, I, 0, 0, 0.18, 0.30, 1.45, 1.45, 22, false) // bordo interno basso
  addCyl(P, N, I, 0, 0, 0.30, 0.95, 0.28, 0.22) // fusto centrale
  addCyl(P, N, I, 0, 0, 0.95, 1.05, 0.78, 0.78) // coppa intermedia (sotto)
  addCyl(P, N, I, 0, 0, 1.05, 1.22, 0.72, 0.20) // coppa intermedia (svaso)
  addCyl(P, N, I, 0, 0, 1.22, 1.7, 0.16, 0.12) // stelo superiore
  addCyl(P, N, I, 0, 0, 1.7, 1.78, 0.34, 0.34) // coppa alta
  addCyl(P, N, I, 0, 0, 1.78, 1.95, 0.30, 0.06) // svaso coppa alta
})
const BIG_FOUNTAIN_WATER = meshOf((P, N, I) => {
  addCyl(P, N, I, 0, 0, 0.30, 0.33, 1.5, 1.5, 24, true) // specchio d'acqua vasca
  addCyl(P, N, I, 0, 0, 1.10, 1.12, 0.66, 0.66, 18) // acqua coppa intermedia
  addCyl(P, N, I, 0, 0, 1.82, 1.84, 0.28, 0.28, 14) // acqua coppa alta
  addCyl(P, N, I, 0, 0, 1.84, 2.5, 0.05, 0.02, 8) // zampillo centrale
})
// Sfera (chioma/cespuglio) centro (cx,cy,cz), raggio r, schiacciabile in z.
function addSphere(
  P: number[], N: number[], I: number[],
  cx: number, cy: number, cz: number, r: number,
  squashZ = 1, latB = 6, lonB = 9,
) {
  const base = P.length / 3
  for (let la = 0; la <= latB; la++) {
    const theta = (la / latB) * Math.PI
    const st = Math.sin(theta), ct = Math.cos(theta)
    for (let lo = 0; lo <= lonB; lo++) {
      const phi = (lo / lonB) * Math.PI * 2
      const nx = st * Math.cos(phi), ny = st * Math.sin(phi), nz = ct
      P.push(cx + nx * r, cy + ny * r, cz + nz * r * squashZ)
      N.push(nx, ny, nz)
    }
  }
  const ring = lonB + 1
  for (let la = 0; la < latB; la++) {
    for (let lo = 0; lo < lonB; lo++) {
      const a = base + la * ring + lo, b = a + ring
      I.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
}
// Modelli degli oggetti che l'utente puo' INSERIRE a mano (tutti in metri,
// poggiati su z=quota terreno). Albero = tronco (marrone) + chioma (verde) su
// due layer separati per avere due colori; cespuglio = una sfera schiacciata.
const PLACED_TREE_TRUNK = meshOf((P, N, I) => {
  addCyl(P, N, I, 0, 0, 0, 2.2, 0.14, 0.11, 8)
})
const PLACED_TREE_CANOPY = meshOf((P, N, I) => {
  addSphere(P, N, I, 0, 0, 3.6, 1.8)
})
const PLACED_SHRUB_MESH = meshOf((P, N, I) => {
  addSphere(P, N, I, 0, 0, 0.5, 0.62, 1.15)
})
// Tronco UNITARIO (raggio 1, altezza 1, z 0..1) leggermente rastremato verso
// l'alto. Lo scaliamo per-albero in [raggio, raggio, altezzaTronco] cosi' il
// fusto e' piu' grosso per gli alberi piu' alti (vedi trunkRadiusOf). 7 lati =
// stesso look "a faccette" del vecchio ColumnLayer (diskResolution 6).
const TRUNK_MESH = meshOf((P, N, I) => {
  addCyl(P, N, I, 0, 0, 0, 1, 1, 0.78, 7)
})

// --- Foglio microclima che SEGUE IL TERRENO ------------------------------------
// Il dato ENVI-met è preso a una quota FISSA SUL SUOLO (1.5/4.5/… m). Il terreno
// del dominio è in pendenza (~13 m N-S) e mosso, quindi un foglio piatto a una
// quota assoluta unica, a 1.5 m, in certe zone galleggia in aria e in altre
// finisce sottoterra (-> "buchi" col depth test attivo). Soluzione: tassellare
// il dominio in una griglia e mettere OGNI vertice a `quota_terreno(vertice) +
// z_banda`. Così il foglio è sempre ~z_banda sopra il suolo reale (niente buchi)
// e gli edifici lo occludono correttamente. La mesh è in METRI (offset E/N/su da
// un'ancora lng/lat) + TEXCOORD per applicarci il PNG dell'overlay.
const ENV_SHEET_GRID = 28 // celle per lato (29x29 vertici): segue bene il rilievo
// Orientamento verticale della texture sul foglio-mesh. false = corretto
// (verificato a video: con true l'overlay usciva capovolto). SimpleMeshLayer
// campiona la texture con origine in alto-sx, quindi t = v (non 1-v).
const ENV_TEX_FLIP_V = false
// Dato a singola istanza per la SimpleMeshLayer del foglio (riferimento stabile,
// così deck non ricalcola gli attributi a ogni render).
const ENV_SHEET_DATA = [0]
function buildEnvSheetMesh(
  corners: [number, number][], // [TL, TR, BR, BL] in lng/lat
  zMeters: number,
  elevAt: (lng: number, lat: number) => number,
  anchorLng: number,
  anchorLat: number,
): Geometry {
  const [TL, TR, BR, BL] = corners
  const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
  ]
  const mPerLat = 110540
  const mPerLng = 111320 * Math.cos((anchorLat * Math.PI) / 180)
  const N = ENV_SHEET_GRID
  const positions: number[] = []
  const texCoords: number[] = []
  const normals: number[] = []
  for (let j = 0; j <= N; j++) {
    const v = j / N // 0 = bordo TL->TR (alto immagine), 1 = bordo BL->BR
    for (let i = 0; i <= N; i++) {
      const u = i / N // 0 = lato TL/BL (sx immagine), 1 = lato TR/BR (dx)
      const top = lerp(TL, TR, u)
      const bot = lerp(BL, BR, u)
      const p = lerp(top, bot, v) // [lng, lat] del vertice
      const elev = elevAt(p[0], p[1]) + zMeters
      positions.push((p[0] - anchorLng) * mPerLng, (p[1] - anchorLat) * mPerLat, elev)
      texCoords.push(u, ENV_TEX_FLIP_V ? 1 - v : v)
      normals.push(0, 0, 1)
    }
  }
  const indices: number[] = []
  const row = N + 1
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * row + i
      const b = a + 1
      const c = a + row
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  return new Geometry({
    topology: 'triangle-list',
    attributes: {
      POSITION: { value: new Float32Array(positions), size: 3 },
      NORMAL: { value: new Float32Array(normals), size: 3 },
      TEXCOORD_0: { value: new Float32Array(texCoords), size: 2 },
    },
    indices: { value: new Uint32Array(indices), size: 1 },
  })
}

// Proprietà grezze dell'albero dal GeoJSON sorgente (tag OSM: genus, species,
// genus:it, leaf_type, leaf_cycle, height, ...). Usate dal popup info e per
// scegliere forma/altezza della chioma. Possono mancare: il popup degrada.
type TreeProps = Record<string, string | number | null | undefined>
type TreePoint = {
  // [lon, lat, quota_terreno]: la z e' cotta nel geojson OSM cosi' l'albero
  // poggia sul terreno 3D (vedi scripts/bake_terrain_elevation.py). Col
  // fallback DBTR (non cotto) la z e' 0.
  position: [number, number, number]
  seed: number
  props: TreeProps
}

// Hash deterministico per dare un po' di variazione (scala + tonalita') a
// ogni albero senza fare flicker tra render.
function hashSeed(lon: number, lat: number): number {
  const x = Math.sin(lon * 12.9898 + lat * 78.233) * 43758.5453
  return x - Math.floor(x)
}

type TreeKind = 'conifer' | 'broadleaf'

// Forma della chioma dal tag OSM leaf_type: needleleaved -> conifera (coni),
// tutto il resto (broadleaved/leafless/sconosciuto) -> latifoglia (sfera). A
// Bologna la stragrande maggioranza e' broadleaved.
function treeKind(d: TreePoint): TreeKind {
  return String(d.props.leaf_type ?? '').toLowerCase() === 'needleleaved'
    ? 'conifer'
    : 'broadleaf'
}

// Altezza in metri: usa il tag OSM `height` se valido (raro, ~58 alberi a
// Bologna), altrimenti una stima procedurale 6..13 m variata per seed. Gestisce
// valori tipo "20", "9 m", "12.5".
function parseHeightM(v: TreeProps[string]): number | null {
  if (v == null) return null
  const m = String(v).match(/[\d.]+/)
  if (!m) return null
  const n = parseFloat(m[0])
  return Number.isFinite(n) && n >= 2 && n <= 120 ? n : null
}
// Altezza tipica (m) a maturita' in ambito urbano, per i generi piu' comuni a
// Bologna. Chiave = genere latino minuscolo. Usata quando manca il tag OSM
// `height` (quasi sempre: lo hanno ~58 alberi su 106k).
const GENUS_HEIGHT_M: Record<string, number> = {
  platanus: 25, // platano (i grandi viali)
  populus: 25, // pioppo
  cedrus: 22, // cedro
  quercus: 20, // quercia
  pinus: 18, // pino
  tilia: 18, // tiglio
  celtis: 18, // bagolaro
  ulmus: 18, // olmo
  ginkgo: 18,
  fraxinus: 17, // frassino
  robinia: 16,
  cupressus: 16, // cipresso
  aesculus: 16, // ippocastano
  liquidambar: 16,
  sophora: 16,
  styphnolobium: 16, // sofora (nuovo nome di Sophora japonica)
  acer: 14, // acero
  betula: 14, // betulla
  salix: 14, // salice
  carpinus: 12, // carpino
  catalpa: 12,
  magnolia: 10,
  morus: 10, // gelso
  prunus: 8, // ciliegi/prunus ornamentali
  lagerstroemia: 6, // lagerstroemia
}
// Genere latino: prima parola di genus / species / taxon, minuscola.
function genusOf(props: TreeProps): string | null {
  const raw = props['genus'] ?? props['species'] ?? props['taxon']
  if (raw == null || raw === '') return null
  return String(raw).trim().toLowerCase().split(/\s+/)[0] || null
}
// Classe di circonferenza tronco (dataset Comune, campo `circonferenza` tipo
// "Cl8: 140 - 170 (45-54cm)") -> frazione dell'altezza matura. Cl1 = giovane
// alberello, Cl12 = grande maturo. E' un dato REALE di dimensione/eta': lo usiamo
// per scalare l'altezza invece di affidarci solo al random.
const CIRC_FACTOR: Record<number, number> = {
  1: 0.28, 2: 0.38, 3: 0.48, 4: 0.57, 5: 0.66, 6: 0.74,
  7: 0.82, 8: 0.9, 9: 0.97, 10: 1.0, 11: 1.05, 12: 1.1,
}
function circClass(props: TreeProps): number | null {
  const m = String(props['circonferenza'] ?? '').match(/Cl\s*(\d+)/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}
function treeHeightM(d: TreePoint): number {
  // 1) altezza reale dal tag OSM se c'e' (raro).
  const real = parseHeightM(d.props.height)
  if (real != null) return real
  const genus = genusOf(d.props)
  const base = genus ? GENUS_HEIGHT_M[genus] : undefined
  if (base != null) {
    // 2a) se c'e' la classe di circonferenza (dataset Comune): scala l'altezza
    //     matura per la dimensione reale del tronco; piccolo jitter ±8% per seed.
    const cl = circClass(d.props)
    if (cl != null) {
      const f = CIRC_FACTOR[cl] ?? 0.7
      return Math.round(base * f * (0.92 + d.seed * 0.16) * 10) / 10
    }
    // 2b) altrimenti stima per genere variata ±18% per seed.
    return Math.round(base * (0.82 + d.seed * 0.36) * 10) / 10
  }
  // 3) fallback: conifere un filo piu' slanciate, resto come prima (6..13 m).
  return treeKind(d) === 'conifer' ? 9 + d.seed * 8 : 6 + d.seed * 7
}
function trunkHeightOf(d: TreePoint): number {
  return Math.max(1.5, treeHeightM(d) * 0.28)
}
// Raggio del tronco PROPORZIONALE all'altezza dell'albero: un platano di 25 m
// ha un fusto ben piu' grosso di un prunus di 6 m. Fattore ~0.02 (un albero di
// ~16 m -> ~0.32 m, come il vecchio raggio fisso), con clamp per non avere
// stecchini ne' tronchi sproporzionati. Piccolo jitter per seed per varieta'.
function trunkRadiusOf(d: TreePoint): number {
  const r = treeHeightM(d) * 0.02 * (0.9 + d.seed * 0.2)
  return Math.max(0.12, Math.min(0.65, r))
}

// Colore dell'ombra proiettata (RGBA 0..1). Alpha 0 = ombra invisibile.
const SHADOW_ON: [number, number, number, number] = [0, 0, 0, 0.5]
const SHADOW_OFF: [number, number, number, number] = [0, 0, 0, 0]

// Sole + ambient per un dato istante. `_shadow` segue il toggle "Ombre": NON va
// cambiato a runtime sullo STESSO overlay (ricompila il modulo ombre e fa
// sparire edifici/tetti) — per questo, quando il toggle cambia, RICREIAMO
// l'intero overlay deck (vedi effect dedicato), cosi' gli shader nascono gia'
// con/senza ombre. Qui _shadow resta coerente con come l'overlay e' stato
// creato. Di notte: sole a intensita' 0 e ambient alto -> edifici ben visibili.
function sunAmbientFor(
  timestamp: number,
  shadow: boolean,
): {
  sun: SunLight
  ambient: AmbientLight
} {
  const sunPos = getSunPosition(new Date(timestamp), AOI_CENTER[1], AOI_CENTER[0])
  const isDay = sunPos.altitudeDeg > 0
  // Sole MENO direzionale + ambient PIU' alto: prima (sun 1.5 / amb 1.0) le
  // facciate rivolte lontano dal sole diventavano molto scure e sembravano
  // "ombre" anche con il toggle Ombre spento (sono solo lati poco illuminati).
  // Cosi' la luce e' piu' morbida e uniforme: niente lati neri spuri.
  const sun = new SunLight({
    timestamp,
    color: [255, 255, 255],
    intensity: isDay ? 1.0 : 0,
    _shadow: shadow,
  })
  const ambient = new AmbientLight({
    color: [255, 255, 255],
    // 1.5 di giorno slavava gli edifici (effetto "tutto sbiadito"). 1.05 tiene
    // le facciate visibili ma restituisce contrasto/colore.
    intensity: isDay ? 1.05 : 1.2,
  })
  return { sun, ambient }
}

// Aggiorna l'effetto luce PERSISTENTE (deck.gl, ricevendo un nuovo effect con
// lo stesso id 'lighting-effect', terrebbe quello vecchio applicandone solo i
// `props` -> shadowColor verrebbe ignorato). Per questo qui si MUTA sempre la
// stessa istanza: setProps aggiorna sole/ambient, e shadowColor (letto live a
// ogni frame da getShaderModuleProps) accende/spegne davvero l'ombra.
function applyLighting(
  effect: LightingEffect,
  timestamp: number,
  castShadows: boolean,
): void {
  // _shadow coerente con castShadows: l'overlay e' stato creato con questo
  // valore, quindi setProps non cambia il modulo (nessuna ricompilazione).
  effect.setProps(sunAmbientFor(timestamp, castShadows))
  ;(effect as unknown as { shadowColor: number[] }).shadowColor = castShadows
    ? SHADOW_ON
    : SHADOW_OFF
}

type QuartiereFeature = {
  type: 'Feature'
  properties: {
    cod_quar: number
    quartiere: string
    bbox: [number, number, number, number]
  }
  geometry: {
    // Sempre MultiPolygon (build_quartieri.py dissolve + wrap). La z dei vertici
    // e' cotta dal terreno (bake_terrain_elevation.py) -> il bordo segue i colli.
    type: 'MultiPolygon'
    coordinates: number[][][][]
  }
}

type SearchResult =
  | { type: 'address'; label: string; lat: number; lon: number }
  | {
      type: 'quartiere'
      label: string
      cod_quar: number
      bbox: [number, number, number, number]
      lat: number
      lon: number
    }

// Geocoder Photon (komoot, su dati OSM): è pensato per l'autocomplete "as you
// type" ed è molto piu' bravo di Nominatim sulle VIE (match parziali, niente
// limite ~1 req/s). Bias su Bologna (lat/lon + bbox) e STRADE in cima.
// Doc: https://photon.komoot.io  — niente API key.
const PHOTON_URL = 'https://photon.komoot.io/api/'
// Riquadro Bologna + colli (un filo piu' largo del maxBounds della mappa).
const BOLOGNA_BOX = { west: 11.20, south: 44.40, east: 11.50, north: 44.60 }
type PhotonProps = {
  name?: string
  street?: string
  housenumber?: string
  city?: string
  district?: string
  locality?: string
  county?: string
  postcode?: string
  osm_key?: string
  osm_value?: string
}
async function geocodeBologna(
  q: string,
  lang: Lang,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const url =
    PHOTON_URL +
    '?q=' + encodeURIComponent(q) +
    '&limit=8' +
    `&lang=${lang === 'en' ? 'en' : 'it'}` +
    '&lat=44.4949&lon=11.3426' + // bias sul centro di Bologna
    `&bbox=${BOLOGNA_BOX.west},${BOLOGNA_BOX.south},${BOLOGNA_BOX.east},${BOLOGNA_BOX.north}`
  const r = await fetch(url, { signal })
  const data = (await r.json()) as {
    features?: {
      geometry: { coordinates: [number, number] }
      properties: PhotonProps
    }[]
  }
  const inBox = (lon: number, lat: number) =>
    lon >= BOLOGNA_BOX.west && lon <= BOLOGNA_BOX.east &&
    lat >= BOLOGNA_BOX.south && lat <= BOLOGNA_BOX.north
  const feats = (data.features ?? []).filter((f) =>
    inBox(f.geometry.coordinates[0], f.geometry.coordinates[1]),
  )
  // Strade (osm_key=highway) prima del resto: la ricerca è soprattutto per vie.
  feats.sort((a, b) => {
    const ah = a.properties.osm_key === 'highway' ? 0 : 1
    const bh = b.properties.osm_key === 'highway' ? 0 : 1
    return ah - bh
  })
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const f of feats) {
    const p = f.properties
    const main = p.name || [p.street, p.housenumber].filter(Boolean).join(' ')
    if (!main) continue
    const ctx = [p.district || p.locality, p.city]
      .filter((v): v is string => !!v)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(', ')
    const label = ctx ? `${main}, ${ctx}` : main
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      type: 'address',
      label,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    })
  }
  return out
}

const QUARTIERE_BLOCK_HEIGHT = 80 // m, altezza del blocco pseudo-3D
const QUARTIERE_BLOCK_COLOR = withAlpha(BOLOGNA_RED, 130)
const QUARTIERE_LINE_COLOR = withAlpha(BOLOGNA_RED, 230)

// Non più agganciata alla pipeline (l'highlight 3D del quartiere è stato
// tolto in favore del bordo lampeggiante): conservata come tentativo
// documentato — materiale per la tesi, vedi CLAUDE.md.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildSelectedQuartiereLayer(
  quartieri: QuartiereFeature[] | null,
  selectedCodQuar: number | null,
): GeoJsonLayer | null {
  if (!quartieri || selectedCodQuar == null) return null
  const feat = quartieri.find(
    (f) => f.properties.cod_quar === selectedCodQuar,
  )
  if (!feat) return null
  return new GeoJsonLayer({
    id: 'quartiere-selected',
    data: { type: 'FeatureCollection', features: [feat] },
    stroked: true,
    filled: true,
    extruded: true,
    getElevation: QUARTIERE_BLOCK_HEIGHT,
    getFillColor: QUARTIERE_BLOCK_COLOR,
    getLineColor: QUARTIERE_LINE_COLOR,
    lineWidthMinPixels: 1.5,
    pickable: false,
    material: false,
  })
}

// Colore di brand Talea per il feedback di selezione: BLU #1272B7 (manuale
// d'immagine). Prima era il ciano UrbanScope3D #22d3ee [34, 211, 238] — molto
// bello, tenuto commentato per poterci tornare.
// const BRAND_CYAN: RGB = [34, 211, 238]
const BRAND_BLUE: RGB = [18, 114, 183]

// Bordo del quartiere che si colora al cambio quartiere e poi svanisce in fade.
// SOLO perimetro (niente riempimento): prima il fill blu semitrasparente
// copriva tutta l'area tingendo anche le strade. Colore brand blu, sopra ai
// palazzi (depthCompare 'always'). `fading` porta l'alpha a 0 e una transizione
// deck.gl di 1s lo dissolve dolcemente.
function buildQuartiereFlashLayer(
  quartieri: QuartiereFeature[] | null,
  codQuar: number | null,
  fading: boolean,
): GeoJsonLayer | null {
  if (!quartieri || codQuar == null) return null
  const feat = quartieri.find((f) => f.properties.cod_quar === codQuar)
  if (!feat) return null
  return new GeoJsonLayer({
    id: 'quartiere-flash',
    data: { type: 'FeatureCollection', features: [feat] },
    stroked: true,
    filled: false,
    extruded: false,
    getLineColor: withAlpha(BRAND_BLUE, fading ? 0 : 255),
    lineWidthUnits: 'pixels',
    getLineWidth: 4,
    lineWidthMinPixels: 4,
    pickable: false,
    parameters: { depthCompare: 'always' },
    updateTriggers: { getLineColor: fading },
    transitions: { getLineColor: 1000 },
  })
}

// Etichette bianche col nome dei 6 quartieri, disegnate SOPRA i palazzi
// (depthCompare 'always') con bordino nero per leggibilita' su ogni basemap.
function buildQuartiereLabelsLayer(
  quartieri: QuartiereFeature[] | null,
): TextLayer | null {
  if (!quartieri || quartieri.length === 0) return null
  const data = quartieri.map((f) => {
    const [minlon, minlat, maxlon, maxlat] = f.properties.bbox
    return {
      position: [(minlon + maxlon) / 2, (minlat + maxlat) / 2] as [number, number],
      text: f.properties.quartiere,
    }
  })
  return new TextLayer<{ position: [number, number]; text: string }>({
    id: 'quartiere-labels',
    data,
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    getSize: 15,
    sizeUnits: 'pixels',
    getColor: [255, 255, 255, 255],
    outlineColor: [0, 0, 0, 220],
    outlineWidth: 3,
    fontSettings: { sdf: true },
    fontWeight: 700,
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    billboard: true,
    pickable: false,
    parameters: { depthCompare: 'always' },
  })
}

// Rampa giallo -> rosso (YlOrRd) per la temperatura, normalizzata su [min,max].
// --- Layer deck del "microclima vivo" -----------------------------------------
// Scie di vento: motore GPU (lib/windgl, transform feedback derivato da
// WeatherLayers GL) — le particelle sono avvette e colorate INTERAMENTE sulla
// GPU dalla texture u/v ricampionata client-side (lib/microlive.buildWindTexture).
// Fiamme/foschia: sistemi CPU (TypedArray mutati in place a ogni frame).

// Rampa velocita' (m/s) -> colore scia: lenta = azzurro tenue, veloce = bianca.
const WIND_PALETTE: PaletteStop[] = [
  [0, [110, 175, 255, 120]],
  [1.2, [160, 210, 255, 185]],
  [2.4, [225, 240, 255, 230]],
  [4, [255, 255, 255, 255]],
]

// Atlas dello sprite di fumo, creato pigramente al primo frame (solo client).
// Data-URL e non canvas: e' il tipo che IconLayer accetta (e cache-a) senza
// fare confusione con le Texture luma.
let smokeAtlas: string | null = null
const SMOKE_MAPPING = {
  puff: { x: 0, y: 0, width: 128, height: 128, mask: true },
}

function buildLiveLayers(sys: {
  windTex: WindTexture
  groundPlane: [number, number, number]
  zM: number
  heat: Embers
  mist: Embers
}): Layer[] {
  const out: Layer[] = []
  out.push(
    new WindParticleLayer({
      id: 'live-wind-trails',
      image: sys.windTex.image,
      imageUnscale: WIND_UNSCALE,
      bounds: sys.windTex.bounds,
      // Quota reale: piano del suolo ENVI-met + quota dello slider -> terreno
      // ed edifici occludono le scie (patch 3D del layer vendorizzato).
      groundPlane: sys.groundPlane,
      altitude: sys.zM + 1,
      palette: WIND_PALETTE,
      numParticles: 4000,
      maxAge: 30,
      speedFactor: 30,
      width: 2.5,
      pickable: false,
    }),
  )
  if (!smokeAtlas) smokeAtlas = makeSmokeSprite(128).toDataURL()
  const clouds: [string, Embers][] = [
    ['live-heat-embers', sys.heat],
    ['live-humidity-mist', sys.mist],
  ]
  for (const [id, e] of clouds) {
    if (!e.active || e.count === 0) continue
    out.push(
      new IconLayer({
        id,
        data: {
          length: e.count,
          attributes: {
            getPosition: { value: e.posBuf, size: 3 },
            getColor: { value: e.colBuf, size: 4, normalized: true },
            getSize: { value: e.sizeBuf, size: 1 },
            getAngle: { value: e.angBuf, size: 1 },
          },
        },
        iconAtlas: smokeAtlas,
        iconMapping: SMOKE_MAPPING,
        getIcon: () => 'puff',
        sizeUnits: 'meters',
        // Niente minimo in pixel: da lontano gli sprite si fondono in foschia
        // invece di diventare un tappeto di puntini a taglia fissa.
        sizeMinPixels: 1,
        billboard: true, // sprite rivolti alla camera: volumetrici in obliquo
        pickable: false,
        // Edifici e terreno occludono il fumo (niente raggi-X), ma il fumo non
        // scrive depth: gli sprite sovrapposti si fondono invece di "bucarsi".
        parameters: { depthCompare: 'less-equal', depthWriteEnabled: false },
      }),
    )
  }
  return out
}

// Stessa rampa usata nella pipeline ENVI-met (build_envimet_overlays.py) e
// nella legenda, cosi' edifici e overlay parlano la stessa lingua cromatica.
const YLORRD: [number, number, number][] = [
  [255, 255, 178],
  [254, 217, 118],
  [254, 178, 76],
  [253, 141, 60],
  [189, 0, 38],
]

function ylOrRd(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (YLORRD.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = YLORRD[i]
  const b = YLORRD[Math.min(i + 1, YLORRD.length - 1)]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

// Grigio per edifici senza dato di temperatura (fuori dal dominio ENVI-met).
const BUILDING_GREY: [number, number, number] = [120, 124, 130]

// Dissolvenza per distanza: gli edifici lontani dal centro vista sfumano fino a
// sparire, cosi' in vista bassa non restano "sospesi" all'orizzonte. Pieni
// entro NEAR, invisibili oltre FAR, lineari in mezzo. Centro = map.getCenter()
// aggiornato a 'moveend' (vedi fadeCenter nello stato).
// Dissolvenza praticamente DISATTIVATA entro l'area dati: l'utente non vuole
// vedere edifici semitrasparenti. I dati edifici si estendono ~10 km dal centro,
// quindi con NEAR=16 km nulla di visibile sfuma; resta solo una rete oltre i
// 16 km (fuori dai dati) per sicurezza. La trasparenza percepita sulle colline
// era la FOSCHIA del cielo (vedi computeSky in lib/sky.ts), non questa.
const BUILDINGS_FADE_NEAR_M = 16000
const BUILDINGS_FADE_FAR_M = 30000
type FadeCfg = { lon: number; lat: number; near: number; far: number }

// Solo le slot di cache del centroide (__cx/__cy): gli oggetti feature sono
// riusati da deck fra un recolor e l'altro, quindi il centroide si calcola una
// volta sola per edificio. NB: NON dichiaro `geometry` nel tipo perche' il
// Geometry di deck (Point|Polygon|...) non combacerebbe e romperebbe
// l'inferenza degli accessor -> la leggo via cast a GeomLike.
type Centroidable = { __cx?: number; __cy?: number }
type GeomLike = {
  geometry?: {
    type: string
    coordinates: number[][][] | number[][][][]
  } | null
}
function featureCentroid(f: Centroidable): [number, number] {
  if (f.__cx !== undefined && f.__cy !== undefined) return [f.__cx, f.__cy]
  const g = (f as GeomLike).geometry
  let ring: number[][] | null = null
  if (g?.type === 'Polygon') ring = g.coordinates[0] as number[][]
  else if (g?.type === 'MultiPolygon')
    ring = (g.coordinates as number[][][][])[0][0]
  let cx = 0
  let cy = 0
  if (ring && ring.length) {
    for (const p of ring) {
      cx += p[0]
      cy += p[1]
    }
    cx /= ring.length
    cy /= ring.length
  }
  f.__cx = cx
  f.__cy = cy
  return [cx, cy]
}
// Fattore 1..0 in base alla distanza del centroide dal centro vista.
function fadeFactor(f: Centroidable, fade: FadeCfg | null): number {
  if (!fade) return 1
  const [lon, lat] = featureCentroid(f)
  const dx = (lon - fade.lon) * Math.cos((fade.lat * Math.PI) / 180) * 111320
  const dy = (lat - fade.lat) * 110540
  const d = Math.hypot(dx, dy)
  if (d <= fade.near) return 1
  if (d >= fade.far) return 0
  return 1 - (d - fade.near) / (fade.far - fade.near)
}
// Applica il fattore di dissolvenza all'alpha di un colore RGBA.
function withFade(
  c: [number, number, number, number],
  a: number,
): [number, number, number, number] {
  return a >= 1 ? c : [c[0], c[1], c[2], Math.round(c[3] * a)]
}

// Colonna MRT (temperatura percepita) per quota di un edificio: [[z_m, mrt], ...]
type MrtCol = [number, number][]

// MRT a livello pedonale (~1.5 m): valore della colonna piu' vicino a 1.5 m.
// null se l'edificio non ha dato (fuori dal dominio ENVI-met). E' la grandezza
// con cui coloriamo gli edifici in modalita' "temperatura": piu' contrastata
// dell'aria (che varia ~6 °C) e piu' intuitiva ("quanto scotta stare li'").
const PEDESTRIAN_Z = 1.5
function pedestrianMrt(col: MrtCol | undefined | null): number | null {
  if (!col || col.length === 0) return null
  let best = col[0]
  for (const c of col) {
    if (Math.abs(c[0] - PEDESTRIAN_Z) < Math.abs(best[0] - PEDESTRIAN_Z)) best = c
  }
  return best[1]
}

type BuildingFeature = Centroidable & {
  properties?: { height?: number; air_temp?: number; mrt_col?: MrtCol } | null
}

function buildShadowBuildingsLayer(
  visible: boolean,
  // GeoJSON edifici: di norma l'oggetto gia' parsato dal prefetch in streaming;
  // su fallback una stringa URL che deck.gl scarica da solo. null = dati non
  // ancora pronti -> nessun layer (evita il doppio download).
  data: string | object | null,
  // Se valorizzato, gli edifici sono colorati per la MRT pedonale (temperatura
  // percepita ENVI-met) normalizzata su questo range; chi non ha il dato resta
  // grigio.
  tempRange: { min: number; max: number } | null,
  // Dissolvenza per distanza (null = nessuna).
  fade: FadeCfg | null,
  // Chiamata quando il GeoJSON edifici ha finito di caricare (per il loader).
  onDataLoad?: () => void,
): GeoJsonLayer | null {
  if (!visible || data == null) return null
  // Edifici PIENI (alpha 255): niente facciate semitrasparenti da cui si
  // intravede il terreno/le case dietro.
  const lineBase = withAlpha(BOLOGNA_SANGIOVESE, 255) as [
    number,
    number,
    number,
    number,
  ]
  // Variazione di LUMINANZA per-edificio: una citta' tutta dello stesso ocra
  // piatto sembra finta. Moltiplichiamo l'ocra per un fattore deterministico
  // (hash del centroide -> ~0.86..1.12) cosi' ogni casa e' un po' piu' chiara o
  // scura, come le facciate vere. IMPORTANTE: e' un fattore scalare sul SOLO
  // ocra, quindi lo shader tetti (lit = color/ocra; tetto = ROOF*lit) scala il
  // tetto dello STESSO fattore -> facciata e tetto restano coerenti.
  const ocraVaried = (f: BuildingFeature): [number, number, number, number] => {
    const [cx, cy] = featureCentroid(f as unknown as Centroidable)
    const k = 0.86 + hashSeed(cx, cy) * 0.26
    return [
      Math.min(255, Math.round(BOLOGNA_OCRA[0] * k)),
      Math.min(255, Math.round(BOLOGNA_OCRA[1] * k)),
      Math.min(255, Math.round(BOLOGNA_OCRA[2] * k)),
      255,
    ]
  }
  const baseColor = (f: BuildingFeature): [number, number, number, number] => {
    if (tempRange) {
      const tC = pedestrianMrt(f.properties?.mrt_col)
      if (tC == null)
        return [...BUILDING_GREY, 255] as [number, number, number, number]
      const tNorm = (tC - tempRange.min) / (tempRange.max - tempRange.min || 1)
      return [...ylOrRd(tNorm), 255] as [number, number, number, number]
    }
    return ocraVaried(f)
  }
  return new GeoJsonLayer({
    id: 'buildings-shadow',
    data: data as string,
    onDataLoad: () => onDataLoad?.(),
    stroked: true,
    filled: true,
    extruded: true,
    getElevation: (f: BuildingFeature) => {
      const h = f.properties?.height
      return typeof h === 'number' && h > 0 ? h : DEFAULT_BUILDING_HEIGHT
    },
    getFillColor: (f: BuildingFeature) =>
      withFade(baseColor(f), fadeFactor(f, fade)),
    getLineColor: (f: BuildingFeature) =>
      withFade(lineBase, fadeFactor(f, fade)),
    lineWidthMinPixels: 0.5,
    // Pickable: al click leggo air_temp dell'edificio (temperatura aria che lo
    // colora) e la mostro nel pannello del punto.
    pickable: true,
    // Tetto rosso "alla bolognese" tinto nello shader (faccia superiore), SOLO
    // in modalita' normale: in modalita' temperatura il riempimento e' la rampa
    // giallo->rosso e un tetto rosso fisso la falserebbe. L'estensione va solo
    // sul sub-layer di riempimento poligoni (non su bordi/punti, che non hanno
    // ne' normali ne' lighting nello shader). Vedi RoofTopColorExtension.
    _subLayerProps: tempRange
      ? undefined
      : { 'polygons-fill': { extensions: [ROOF_TOP_EXTENSION] } },
    updateTriggers: {
      getFillColor: [
        tempRange?.min,
        tempRange?.max,
        fade?.lon,
        fade?.lat,
        fade?.near,
        fade?.far,
      ],
      getLineColor: [fade?.lon, fade?.lat, fade?.near, fade?.far],
    },
    material: {
      ambient: 0.4,
      diffuse: 0.9,
      shininess: 20,
      specularColor: [80, 60, 50],
    },
  })
}


// Tetti "alla bolognese": rosso mattone dei coppi, distinti dalle facciate
// ocra. PROBLEMA STORICO: deck.gl colora top+lati di un edificio estruso con UN
// solo colore. Prima si disegnava un layer di poligoni piatti SEPARATO, sollevato
// a z=altezza: fragile (z-fighting, terreno che dilata la profondita', dati
// condivisi) e i tetti finivano per "volare".
//
// SOLUZIONE: nessuna geometria separata. Una LayerExtension inietta GLSL nello
// shader del SolidPolygonLayer degli edifici e tinge di rosso SOLO i vertici la
// cui normale punta verso l'alto (la faccia superiore). Le facciate (normale
// orizzontale) restano ocra. Niente layer extra -> niente tetto che vola, e un
// fetch/tessellazione in meno.
//
// Il colore rosso eredita la stessa illuminazione delle facciate: nello shader
// `color.rgb` e' gia' l'ocra ILLUMINATA, quindi ricaviamo il fattore di luce
// (color/ocra) e lo applichiamo al rosso. Cosi' il tetto si scurisce di notte e
// con le ombre esattamente come le pareti, senza chiamare funzioni di lighting.
const glslRGB = (c: RGB) =>
  `vec3(${(c[0] / 255).toFixed(4)}, ${(c[1] / 255).toFixed(4)}, ${(c[2] / 255).toFixed(4)})`
class RoofTopColorExtension extends LayerExtension {
  getShaders() {
    return {
      inject: {
        // Eseguito nel vertex shader del SolidPolygonLayer (Gouraud): per i
        // vertici della faccia superiore (normale ~ +Z) sostituisce l'ocra
        // illuminata col rosso mattone, preservando il fattore di luce e l'alpha
        // (la dissolvenza per distanza arriva da getFillColor).
        'vs:DECKGL_FILTER_COLOR': `
          if (geometry.normal.z > 0.5) {
            vec3 ocra = ${glslRGB(BOLOGNA_OCRA)};
            vec3 lit = color.rgb / max(ocra, vec3(0.001));
            color.rgb = clamp(${glslRGB(BOLOGNA_ROOF)} * lit, 0.0, 1.0);
          }
        `,
      },
    }
  }
}
// Istanza unica e stabile: passarla nuova a ogni render forzerebbe deck.gl a
// ricompilare lo shader continuamente.
const ROOF_TOP_EXTENSION = new RoofTopColorExtension()

function buildTreesLayers(
  visible: boolean,
  data: TreePoint[] | null,
): Layer[] {
  if (!visible || !data || data.length === 0) return []
  // Tronco come SimpleMeshLayer (non ColumnLayer): ci serve un RAGGIO per-albero
  // (proporzionale all'altezza) e il ColumnLayer ha un solo `radius` fisso per
  // tutta la collezione. getScale [r, r, h] scala il tronco unitario.
  const trunk = new SimpleMeshLayer<TreePoint>({
    id: 'trees-trunk',
    data,
    mesh: TRUNK_MESH,
    pickable: true,
    // Gli alberi NON entrano nello shadow pass: con 100k+ istanze raddoppiare
    // il rendering nella shadow map li rendeva lentissimi (e le ombre degli
    // alberi sarebbero comunque caotiche). Solo gli edifici proiettano ombre.
    // shadowEnabled e' una prop runtime letta da ShadowPass, non nei tipi TS.
    // @ts-expect-error deck.gl runtime prop assente dai types
    shadowEnabled: false,
    getPosition: (d) => d.position,
    getScale: (d) => {
      const r = trunkRadiusOf(d)
      return [r, r, trunkHeightOf(d)]
    },
    getColor: [82, 58, 38, 255],
    material: {
      ambient: 0.45,
      diffuse: 0.7,
      shininess: 3,
      specularColor: [40, 30, 20],
    },
  })
  // Colore chioma: latifoglie verde brillante, conifere verde scuro/bluastro;
  // variazione per seed per non avere una foresta monocroma.
  const canopyColor = (
    d: TreePoint,
    kind: TreeKind,
  ): [number, number, number, number] => {
    if (kind === 'conifer') {
      const g = 80 + Math.round(d.seed * 40)
      return [38 + Math.round(d.seed * 18), g, 56 + Math.round((1 - d.seed) * 26), 245]
    }
    const g = 120 + Math.round(d.seed * 55)
    return [55 + Math.round(d.seed * 30), g, 48 + Math.round((1 - d.seed) * 30), 245]
  }
  const canopyMaterial = {
    ambient: 0.35,
    diffuse: 0.9,
    shininess: 6,
    specularColor: [50, 80, 50] as [number, number, number],
  }
  // Una chioma per FORMA (leaf_type): SimpleMeshLayer accetta un solo mesh, per
  // questo si separano conifere e latifoglie in due layer, ciascuno col proprio
  // mesh e il sottoinsieme di alberi. getScale [s, s, sz]: s = raggio chioma
  // (scala col diametro tipico), sz = altezza chioma in metri / ZMAX del mesh.
  const makeCanopy = (
    id: string,
    subset: TreePoint[],
    mesh: Geometry,
    zmax: number,
    kind: TreeKind,
    radiusK: number,
    radMin: number,
    radMax: number,
  ) =>
    new SimpleMeshLayer<TreePoint>({
      id,
      data: subset,
      mesh,
      pickable: true,
      // @ts-expect-error deck.gl runtime prop assente dai types (vedi trunk)
      shadowEnabled: false,
      getPosition: (d) => d.position,
      getTranslation: (d) => [0, 0, trunkHeightOf(d) * 0.92],
      getScale: (d) => {
        const H = treeHeightM(d)
        const canopyH = Math.max(1.5, H - trunkHeightOf(d) * 0.92)
        const s =
          Math.max(radMin, Math.min(radMax, H * radiusK)) * (0.85 + d.seed * 0.3)
        return [s, s, canopyH / zmax]
      },
      getColor: (d) => canopyColor(d, kind),
      material: canopyMaterial,
    })
  const conifers = data.filter((d) => treeKind(d) === 'conifer')
  const broadleaves = data.filter((d) => treeKind(d) === 'broadleaf')
  const layers: Layer[] = [trunk]
  if (conifers.length) {
    layers.push(
      makeCanopy('trees-canopy-conifer', conifers, CONIFER_MESH, CONIFER_ZMAX, 'conifer', 0.18, 0.9, 4.5),
    )
  }
  if (broadleaves.length) {
    layers.push(
      makeCanopy('trees-canopy-broadleaf', broadleaves, BROADLEAF_MESH, BROADLEAF_ZMAX, 'broadleaf', 0.30, 1.1, 7.0),
    )
  }
  return layers
}

// Cerchio di evidenziazione attorno all'albero selezionato: un anello blu
// (brand Talea #1272B7) sul terreno alla base dell'albero. depthTest off cosi'
// resta sempre visibile, non occluso dalla chioma o dagli edifici.
function buildSelectedTreeLayer(
  sel: { lon: number; lat: number; z: number } | null,
): Layer | null {
  if (!sel) return null
  return new ScatterplotLayer<{ lon: number; lat: number; z: number }>({
    id: 'tree-selected-ring',
    data: [sel],
    // z = quota di base dell'albero (terreno): l'anello sta ALLA BASE
    // dell'albero, non a z=0 (dove prima finiva "sotto" l'albero).
    getPosition: (d) => [d.lon, d.lat, d.z],
    stroked: true,
    filled: false,
    getLineColor: [18, 114, 183, 255],
    getRadius: 3.5,
    radiusUnits: 'meters',
    radiusMinPixels: 13,
    lineWidthUnits: 'pixels',
    getLineWidth: 3,
    lineWidthMinPixels: 3,
    pickable: false,
    // depthCompare 'always' = disabilita il depth test -> l'anello e' sempre
    // visibile, non occluso da chioma/edifici (in luma.gl v9 non c'e' depthTest).
    parameters: { depthCompare: 'always' },
  })
}

// Arredo urbano (dataset Comune): ogni elemento e' un pilastrino 3D (ColumnLayer)
// con la base alla quota del terreno (z cotta nel geojson). Panchine -> marrone
// legno; resto -> grigio. Modello volutamente semplice (sara' raffinabile).
type ArredoFeature = {
  geometry: { coordinates: [number, number] | [number, number, number] }
  properties?: { classe?: string; conservazione?: string; quartiere?: string } | null
}
// Categoria arredo dal campo `classe` (per scegliere mesh e colore).
type ArredoKind = 'bench' | 'bin' | 'fountain' | 'railing' | 'other'
function arredoKind(props: ArredoFeature['properties']): ArredoKind {
  const c = String(props?.classe ?? '').toLowerCase()
  if (/panchin|seduta/.test(c)) return 'bench'
  if (/cestin|cestone/.test(c)) return 'bin'
  if (/fontan/.test(c)) return 'fountain'
  if (/cancellata|ringhiera|recinzione|staccionata/.test(c)) return 'railing'
  return 'other'
}
// Etichetta categoria localizzata: titolo SEMPRE leggibile nel popup, anche
// quando il dato aperto del Comune non riporta la `classe` (~3.700 oggetti).
const ARREDO_KIND_LABEL: Record<ArredoKind, { it: string; en: string }> = {
  bench: { it: 'Panchina', en: 'Bench' },
  bin: { it: 'Cestino', en: 'Litter bin' },
  fountain: { it: 'Fontana', en: 'Fountain' },
  railing: { it: 'Ringhiera', en: 'Railing' },
  other: { it: 'Arredo urbano', en: 'Street furniture' },
}

function buildArredoLayers(
  visible: boolean,
  data: ArredoFeature[] | null,
): Layer[] {
  if (!visible || !data || data.length === 0) return []
  const of = (k: ArredoKind) => data.filter((d) => arredoKind(d.properties) === k)
  const material = {
    ambient: 0.45,
    diffuse: 0.85,
    shininess: 6,
    specularColor: [50, 45, 40] as [number, number, number],
  }
  const mk = (
    id: string,
    subset: ArredoFeature[],
    mesh: Geometry,
    color: [number, number, number, number],
  ) =>
    new SimpleMeshLayer<ArredoFeature>({
      id,
      data: subset,
      mesh,
      getPosition: (d) => d.geometry.coordinates as [number, number, number],
      getColor: color,
      material,
      pickable: true, // click -> popup con tipo/stato/quartiere
      // niente ombre (come gli alberi): troppe istanze nello shadow pass.
      // @ts-expect-error deck.gl runtime prop assente dai types
      shadowEnabled: false,
    })
  return [
    mk('arredo-bench', of('bench'), BENCH_MESH, [124, 82, 45, 255]), // legno
    mk('arredo-bin', of('bin'), BIN_MESH, [58, 78, 66, 255]), // verde scuro
    mk('arredo-fountain', of('fountain'), FOUNTAIN_MESH, [54, 84, 70, 255]), // ghisa verde
    mk('arredo-railing', of('railing'), RAILING_MESH, [86, 90, 96, 255]), // metallo
    mk('arredo-post', of('other'), POST_MESH, [92, 96, 102, 255]), // antracite
  ]
}

// --- Modalita' INSERIMENTO utente (solo sessione, niente salvataggio) ---------
// L'utente sceglie un oggetto e lo posa cliccando (punto). Per filari/siepi/
// ringhiere sceglie un tool "a linea": 1o clic = inizio, 2o clic = fine, il
// segmento viene riempito di copie equidistanti (spacing in metri).
type PlaceKind =
  | 'tree' | 'shrub' | 'bench' | 'bin' | 'fountain' | 'fountain-big'
  | 'lamp' | 'bollard' | 'railing'
type PlacedObject = {
  id: number
  kind: PlaceKind
  position: [number, number, number] // lon, lat, quota terreno
  heading: number // rotazione attorno alla verticale, gradi (orientamento)
}
type InsertTool = {
  id: string
  kind: PlaceKind
  line: boolean // true = posa una fila tra due clic
  spacing: number // metri tra le copie (solo line)
}
const INSERT_TOOLS: InsertTool[] = [
  { id: 'tree', kind: 'tree', line: false, spacing: 0 },
  { id: 'bench', kind: 'bench', line: false, spacing: 0 },
  { id: 'bin', kind: 'bin', line: false, spacing: 0 },
  { id: 'fountain', kind: 'fountain', line: false, spacing: 0 },
  { id: 'fountain-big', kind: 'fountain-big', line: false, spacing: 0 },
  { id: 'lamp', kind: 'lamp', line: false, spacing: 0 },
  { id: 'bollard', kind: 'bollard', line: false, spacing: 0 },
  { id: 'tree-row', kind: 'tree', line: true, spacing: 8 },
  { id: 'hedge', kind: 'shrub', line: true, spacing: 1.1 },
  { id: 'railing-line', kind: 'railing', line: true, spacing: 1.5 },
]

// Azimut del segmento A->B in gradi (0 = +X/Est, antiorario). Usato per
// orientare gli oggetti "a linea" (ringhiere) lungo la direzione tracciata.
function segmentHeadingDeg(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180)
  const dx = (b[0] - a[0]) * Math.cos(midLat)
  const dy = b[1] - a[1]
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

// Icone dei tool di inserimento: piccoli disegni a tratto (monocromi, ereditano
// il colore del testo del bottone). Sostituiscono le emoji, piu' coerenti con
// la UI tecnica. viewBox 16x16, stroke = currentColor.
function ToolIcon({ id }: { id: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const paths: Record<string, ReactNode> = {
    tree: (<><circle cx="8" cy="6" r="4" {...p} /><path d="M8 10v4" {...p} /></>),
    bench: (<><path d="M2 6h12M2 9h12M3 6v5M13 6v5" {...p} /></>),
    bin: (<><path d="M3 5h10M6 3h4M4.5 5l.8 9h5.4l.8-9" {...p} /></>),
    fountain: (<><path d="M8 3v9M4 12h8" {...p} /><circle cx="8" cy="3" r="1" {...p} /></>),
    'fountain-big': (<><path d="M2 13h12M4 13c0-3 8-3 8 0M8 10V5" {...p} /><path d="M8 5c-1 1-1 2 0 2s1-1 0-2z" {...p} /></>),
    lamp: (<><path d="M6 14h2M7 14V4" {...p} /><path d="M7 4q4 0 4 3" {...p} /><circle cx="11" cy="8.4" r="1.3" {...p} /></>),
    bollard: (<><path d="M6 14h4M7 14V6a1 1 0 0 1 2 0v8" {...p} /></>),
    'tree-row': (<><circle cx="4" cy="7" r="2.2" {...p} /><circle cx="8" cy="7" r="2.2" {...p} /><circle cx="12" cy="7" r="2.2" {...p} /><path d="M4 9v3M8 9v3M12 9v3" {...p} /></>),
    hedge: (<><path d="M2 12v-1a2 2 0 0 1 4 0 2 2 0 0 1 4 0 2 2 0 0 1 4 0v1z" {...p} /></>),
    'railing-line': (<><path d="M2 6h12M2 11h12M4 5v7M7 5v7M10 5v7M13 5v7" {...p} /></>),
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {paths[id] ?? paths.bollard}
    </svg>
  )
}

// Copie equidistanti lungo il segmento A->B (estremi inclusi). Distanza stimata
// con proiezione equirettangolare (sufficiente a scala urbana). La z si
// interpola tra i due estremi (gia' campionati sul terreno).
function lineBetween(
  a: [number, number, number],
  b: [number, number, number],
  spacingM: number,
  kind: PlaceKind,
): { kind: PlaceKind; position: [number, number, number]; heading: number }[] {
  const midLat = ((a[1] + b[1]) / 2) * (Math.PI / 180)
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos(midLat)
  const dx = (b[0] - a[0]) * mPerDegLon
  const dy = (b[1] - a[1]) * mPerDegLat
  const dist = Math.hypot(dx, dy)
  const n = Math.max(1, Math.round(dist / Math.max(0.3, spacingM)))
  // Tutte le copie ALLINEATE alla direzione del segmento (ringhiere dritte).
  const heading = segmentHeadingDeg(a, b)
  const out: { kind: PlaceKind; position: [number, number, number]; heading: number }[] = []
  for (let i = 0; i <= n; i++) {
    const tt = i / n
    out.push({
      kind,
      heading,
      position: [
        a[0] + (b[0] - a[0]) * tt,
        a[1] + (b[1] - a[1]) * tt,
        a[2] + (b[2] - a[2]) * tt,
      ],
    })
  }
  return out
}

// Layer 3D degli oggetti inseriti dall'utente, raggruppati per tipo (un
// SimpleMeshLayer per tipo, colore fisso). Riusa i mesh di alberi/arredo.
function buildPlacedLayers(placed: PlacedObject[]): Layer[] {
  if (!placed.length) return []
  const of = (k: PlaceKind) => placed.filter((p) => p.kind === k)
  const material = {
    ambient: 0.45,
    diffuse: 0.85,
    shininess: 6,
    specularColor: [50, 45, 40] as [number, number, number],
  }
  const mk = (
    id: string,
    subset: PlacedObject[],
    mesh: Geometry,
    color: [number, number, number, number],
  ) =>
    new SimpleMeshLayer<PlacedObject>({
      id,
      data: subset,
      mesh,
      getPosition: (d) => d.position,
      // [pitch, yaw, roll]: yaw ruota attorno alla verticale -> orientamento.
      getOrientation: (d) => [0, d.heading, 0],
      getColor: color,
      material,
      pickable: true, // click -> selezione (ruota / elimina)
      // @ts-expect-error deck.gl runtime prop assente dai types
      shadowEnabled: false,
    })
  const layers: Layer[] = []
  const trees = of('tree')
  if (trees.length) {
    layers.push(mk('placed-tree-trunk', trees, PLACED_TREE_TRUNK, [108, 74, 44, 255]))
    layers.push(mk('placed-tree-canopy', trees, PLACED_TREE_CANOPY, [74, 132, 74, 255]))
  }
  const bigF = of('fountain-big')
  if (bigF.length) {
    layers.push(mk('placed-fountain-big', bigF, BIG_FOUNTAIN_STONE, [176, 170, 158, 255]))
    layers.push(mk('placed-fountain-big-water', bigF, BIG_FOUNTAIN_WATER, [86, 156, 196, 235]))
  }
  const add = (k: PlaceKind, mesh: Geometry, color: [number, number, number, number]) => {
    const s = of(k)
    if (s.length) layers.push(mk(`placed-${k}`, s, mesh, color))
  }
  add('shrub', PLACED_SHRUB_MESH, [86, 138, 78, 255])
  add('bench', BENCH_MESH, [124, 82, 45, 255])
  add('bin', BIN_MESH, [58, 78, 66, 255])
  add('fountain', FOUNTAIN_MESH, [54, 84, 70, 255])
  add('lamp', LAMP_MESH, [120, 124, 130, 255])
  add('bollard', POST_MESH, [92, 96, 102, 255])
  add('railing', RAILING_MESH, [86, 90, 96, 255])
  return layers
}

// Id di tutti i layer degli oggetti inseriti (per il pick della selezione).
const PLACED_LAYER_IDS = [
  'placed-tree-trunk', 'placed-tree-canopy', 'placed-fountain-big',
  'placed-fountain-big-water', 'placed-shrub', 'placed-bench', 'placed-bin',
  'placed-fountain', 'placed-lamp', 'placed-bollard', 'placed-railing',
]

// HTML del popup di un arredo cliccato (stile coerente coi popup albero/aria).
function arredoPopupHtml(
  props: ArredoFeature['properties'],
  lang: Lang,
): string {
  const it = lang === 'it'
  // Titolo = categoria localizzata (sempre presente). Il dettaglio `classe` del
  // dato aperto va in riga sotto; se manca, lo diciamo esplicitamente.
  const tipo = ARREDO_KIND_LABEL[arredoKind(props)][it ? 'it' : 'en']
  const row = (label: string, value: string) =>
    `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:#666;">${label}</span><b style="text-align:right;">${value}</b></div>`
  const rows: string[] = []
  // Tipo preciso dal dato aperto SOLO se presente. ~3800 arredi (inseriti nel
  // 2004) non hanno classe ne' altro campo descrittivo: per loro il titolo
  // generico "Arredo urbano"/"Street furniture" e' tutto cio' che sappiamo.
  if (props?.classe) rows.push(row(it ? 'Tipo' : 'Type', String(props.classe)))
  if (props?.conservazione)
    rows.push(row(it ? 'Stato' : 'Condition', String(props.conservazione)))
  if (props?.quartiere)
    rows.push(row(it ? 'Quartiere' : 'District', String(props.quartiere)))
  return (
    `<div style="font-family:ui-monospace,monospace;font-size:12px;color:#222;min-width:160px;">` +
    `<div style="color:#0e7490;font-weight:700;margin-bottom:4px;">${tipo}</div>` +
    rows.join('') +
    `</div>`
  )
}

// Segnaposto del punto cliccato: un "punto di posizione" stile mappa — disco blu
// pieno (brand Talea #1272B7) con bordo bianco e un alone azzurro morbido
// intorno. Centrato sul punto esatto -> anchor 'center'. Forma chiaramente
// diversa dalla goccia a PIN della ricerca, cosi' i due non si confondono.
function makeProbeInfoElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.width = '28px'
  el.style.height = '28px'
  el.style.cursor = 'pointer'
  el.style.filter = 'drop-shadow(0 1px 3px rgba(0,0,0,0.45))'
  const blue = '#1272b7'
  el.innerHTML =
    '<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">' +
    // alone azzurro morbido
    `<circle cx="14" cy="14" r="12" fill="${blue}" fill-opacity="0.18"/>` +
    `<circle cx="14" cy="14" r="9" fill="${blue}" fill-opacity="0.28"/>` +
    // disco pieno con bordo bianco
    `<circle cx="14" cy="14" r="6" fill="${blue}" stroke="#ffffff" stroke-width="2.5"/>` +
    '</svg>'
  return el
}

// Traduzioni dei valori enum OSM (mostrati nel popup in forma leggibile).
const LEAF_TYPE_VAL: Record<string, { it: string; en: string }> = {
  broadleaved: { it: 'Latifoglia', en: 'Broadleaved' },
  needleleaved: { it: 'Aghifoglia', en: 'Needleleaved' },
  leafless: { it: 'Spoglio', en: 'Leafless' },
}
const LEAF_CYCLE_VAL: Record<string, { it: string; en: string }> = {
  deciduous: { it: 'caduca', en: 'deciduous' },
  evergreen: { it: 'sempreverde', en: 'evergreen' },
  semi_evergreen: { it: 'semi-sempreverde', en: 'semi-evergreen' },
}
const DENOTATION_VAL: Record<string, { it: string; en: string }> = {
  avenue: { it: 'filare/viale', en: 'avenue' },
  park: { it: 'parco', en: 'park' },
  garden: { it: 'giardino', en: 'garden' },
  urban: { it: 'urbano', en: 'urban' },
  agricultural: { it: 'agricolo', en: 'agricultural' },
  landmark: { it: 'punto di riferimento', en: 'landmark' },
  natural_monument: { it: 'monumento naturale', en: 'natural monument' },
}

// HTML del popup info di un albero cliccato. Stile coerente col popup delle
// centraline qualita' aria. Preferisce i nomi comuni italiani (genus:it,
// species:it) e traduce i valori enum; degrada con grazia se i campi mancano.
function treePopupHtml(
  lat: number,
  lon: number,
  props: TreeProps,
  lang: Lang,
): string {
  const it = lang === 'it'
  const str = (k: string) => {
    const v = props[k]
    return v == null || v === '' ? null : String(v)
  }
  const trans = (
    map: Record<string, { it: string; en: string }>,
    raw: string | null,
  ) => (raw ? (map[raw.toLowerCase()]?.[lang] ?? raw) : null)

  const row = (label: string, value: string) =>
    `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:#666;">${label}</span><b style="text-align:right;">${value}</b></div>`
  const rows: string[] = []

  // Specie: nome comune IT + binomio latino in corsivo (quello che c'e').
  const speciesIt = str('species:it')
  const speciesLat = str('species') ?? str('taxon')
  if (speciesIt || speciesLat) {
    const main = speciesIt ?? speciesLat!
    const sub =
      speciesIt && speciesLat ? ` <i style="color:#888;">(${speciesLat})</i>` : ''
    rows.push(row(it ? 'Specie' : 'Species', `${main}${sub}`))
  }
  const genus = str('genus:it') ?? str('genus')
  if (genus) rows.push(row(it ? 'Genere' : 'Genus', genus))

  // Tipo foglia + ciclo fogliare uniti in una riga ("Latifoglia · caduca").
  const leaf = trans(LEAF_TYPE_VAL, str('leaf_type'))
  const cycle = trans(LEAF_CYCLE_VAL, str('leaf_cycle'))
  const leafLine = [leaf, cycle].filter(Boolean).join(' · ')
  if (leafLine) rows.push(row(it ? 'Foglia' : 'Leaf', leafLine))

  const h = parseHeightM(props.height)
  if (h != null) rows.push(row(it ? 'Altezza' : 'Height', `${h} m`))
  const crown = str('diameter_crown')
  if (crown) rows.push(row(it ? 'Ø chioma' : 'Crown Ø', /m|cm/.test(crown) ? crown : `${crown} m`))
  const circ = str('circumference')
  if (circ) rows.push(row(it ? 'Circonferenza' : 'Circumference', /m|cm/.test(circ) ? circ : `${circ} m`))
  const den = trans(DENOTATION_VAL, str('denotation'))
  if (den) rows.push(row(it ? 'Contesto' : 'Context', den))

  if (rows.length === 0) {
    rows.push(
      `<div style="color:#777;">${it ? 'Nessun attributo nel dataset' : 'No attributes in dataset'}</div>`,
    )
  }

  // Titolo: nome proprio (alberi monumentali) se presente, altrimenti generico.
  const name = str('name')
  const title = name ? `🌳 ${name}` : it ? '🌳 Albero' : '🌳 Tree'
  return (
    `<div style="font-family:ui-monospace,monospace;font-size:12px;color:#222;min-width:170px;max-width:240px;">` +
    `<div style="color:#2f7d32;font-weight:700;margin-bottom:4px;">${title}</div>` +
    rows.join('') +
    `<div style="color:#999;margin-top:4px;">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>` +
    `</div>`
  )
}

// Rende bianche (con alone scuro) le etichette testuali della basemap per
// leggerle meglio. Idempotente; va richiamata dopo ogni setStyle perche' lo
// swap ricarica i colori originali. Sotto ai palazzi 3D (deck overlaid) le
// label restano coperte, ma dove non lo sono risaltano.
function whitenMapLabels(map: maplibregl.Map): void {
  const style = map.getStyle()
  for (const l of style?.layers ?? []) {
    if (l.type !== 'symbol') continue
    // I numeri civici del basemap (CartoDB dark-matter) galleggiano sui palazzi
    // 3D come "numerini" sparsi: li nascondo del tutto invece di sbiancarli.
    const srcLayer = (l as { 'source-layer'?: string })['source-layer']
    if (/housenum/i.test(l.id) || /housenum/i.test(srcLayer ?? '')) {
      try {
        map.setLayoutProperty(l.id, 'visibility', 'none')
      } catch {
        // niente da nascondere
      }
      continue
    }
    try {
      map.setPaintProperty(l.id, 'text-color', '#ffffff')
      map.setPaintProperty(l.id, 'text-halo-color', 'rgba(0,0,0,0.85)')
      map.setPaintProperty(l.id, 'text-halo-width', 1.4)
    } catch {
      // layer simbolo senza testo: niente da colorare
    }
  }
}

// Porta i layer-etichetta del basemap (type 'symbol') IN CIMA allo stack, cosi'
// i nomi di vie/quartieri restano leggibili SOPRA gli edifici 3D (l'overlay deck
// interleaved tende a coprirli). `moveLayer(id)` senza beforeId = sposta in cima.
function raiseMapLabels(map: maplibregl.Map): void {
  const style = map.getStyle()
  for (const l of style?.layers ?? []) {
    if (l.type !== 'symbol') continue
    try {
      map.moveLayer(l.id)
    } catch {
      // layer non spostabile: ignoro
    }
  }
}

// Testi della modalità AIUTO (annotazioni): per ogni `data-help="<key>"` messo su
// un comando dell'interfaccia, la card mostra label + cosa fa. `side` = lato
// preferito dove disegnare la card rispetto al comando contornato.
const HELP_INFO: Record<
  string,
  { label: [string, string]; text: [string, string]; side: 'below' | 'above' | 'left' | 'right' }
> = {
  search: {
    label: ['Ricerca', 'Search'],
    text: ['Cerca una via o un quartiere di Bologna; suggerimenti mentre scrivi.', 'Search a Bologna street or district; suggestions as you type.'],
    side: 'below',
  },
  basemap: {
    label: ['Mappa di base', 'Base map'],
    text: ['Cambia lo sfondo: mappa, scuro, satellite, ortofoto.', 'Switch the background: map, dark, satellite, orthophoto.'],
    side: 'left',
  },
  layers: {
    label: ['Cosa vedere', 'What to see'],
    text: ['Apri il pannello e accendi i dati: microclima, edifici, verde, ambiente.', 'Open the panel and turn on data: microclimate, buildings, greenery, environment.'],
    side: 'right',
  },
  arredi: {
    label: ['Arredi urbani', 'Street furniture'],
    text: ['Aggiungi alla scena panchine, alberi, fontane e altro.', 'Add benches, trees, fountains and more to the scene.'],
    side: 'below',
  },
  compass: {
    label: ['Bussola', 'Compass'],
    text: ['Mostra l’orientamento; cliccala per rimettere il Nord in su.', 'Shows orientation; click it to reset North up.'],
    side: 'left',
  },
  height: {
    label: ['Slider quota', 'Height slider'],
    text: ['Vedi il dato microclima dal livello strada (1,5 m) fin sopra i tetti.', 'See the microclimate data from street level (1.5 m) up above the rooftops.'],
    side: 'left',
  },
  legend: {
    label: ['Legenda', 'Legend'],
    text: ['La scala dei colori del dato attivo, con minimo e massimo.', 'The colour scale of the active layer, with min and max.'],
    side: 'above',
  },
  sun: {
    label: ['Sole e orario', 'Sun & time'],
    text: ['Sposta il sole nell’arco della giornata e guarda come cambiano le ombre.', 'Move the sun through the day and watch the shadows change.'],
    side: 'above',
  },
  controls: {
    label: ['Vista, foto, condividi, meteo', 'View, photo, share, weather'],
    text: ['Nascondi i pannelli, scarica uno screenshot 3D, condividi o apri il meteo.', 'Hide panels, download a 3D screenshot, share or open the weather.'],
    side: 'above',
  },
}

type MapViewerProps = {
  lang: Lang
  // Modalità AIUTO (annotazioni) CONTROLLATA dal genitore: il bottone "Guida"
  // vive nell'header (a sinistra del toggle lingua), fuori da MapViewer. Quando
  // è attiva, ogni comando viene contornato di giallo con una card che spiega
  // cosa fa (stile help di talea.comune.bologna.it/historysuhi).
  helpOpen: boolean
  onHelpOpenChange: (open: boolean) => void
}

export default function MapViewer({
  lang,
  helpOpen,
  onHelpOpenChange,
}: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  // Effetto luce deck.gl PERSISTENTE: creato una volta, poi sempre mutato (mai
  // sostituito) cosi' il cambio di shadowColor viene davvero applicato.
  const lightingRef = useRef<LightingEffect | null>(null)
  // True dopo il primo 'idle' della mappa: solo allora popolo i layer deck.
  // Serve a far compilare gli shader DOPO che l'effetto ombre ha registrato il
  // suo modulo (altrimenti edifici/tetti uscivano senza il tetto finche' non si
  // toccavano le ombre -> ricompilazione tardiva).
  const [overlayReady, setOverlayReady] = useState(false)
  // Specchio SINCRONO di overlayReady: l'effect che popola i layer lo legge per
  // non disegnare sul nuovo overlay PRIMA del suo 'idle' (lo stato React si
  // aggiorna in differita; quando ricreo l'overlay al cambio ombre devo bloccare
  // subito il popolamento, e il ref lo fa nello stesso ciclo di render).
  const overlayReadyRef = useRef(false)
  // Ultimo stato "ombre" effettivamente applicato all'overlay (null = init non
  // ancora registrato). Serve a ricreare l'overlay SOLO quando il toggle cambia.
  const shadowsAppliedRef = useRef<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  // Prontezza dei dati pesanti caricati all'avvio: stile/terreno (mapLoaded) +
  // edifici 3D (~32 MB, il file dominante). Il loader resta finche' NON sono
  // pronti, poi svela la scena. Il verde e' off di default e si scarica in
  // background: NON blocca piu' il loader (prima ne aspettava i ~42 MB).
  const [mapLoaded, setMapLoaded] = useState(false)
  const [buildingsReady, setBuildingsReady] = useState(false)
  // GeoJSON edifici prefetchato in streaming per una barra di avanzamento
  // REALE in byte (vedi effect dedicato). L'oggetto gia' parsato va al layer
  // deck cosi' non viene riscaricato. `buildingsBytes` = byte letti finora.
  const [buildingsData, setBuildingsData] = useState<unknown>(null)
  const [buildingsBytes, setBuildingsBytes] = useState(0)
  // True solo se il prefetch in streaming fallisce: allora il layer ripiega
  // sull'URL (deck.gl scarica da solo). Finche' e' false e i dati non ci sono
  // ancora, il layer NON viene creato cosi' deck non scarica IN PARALLELO lo
  // stesso file (doppio download) mentre lo streamo io.
  const [buildingsLoadFailed, setBuildingsLoadFailed] = useState(false)
  const [currentTime, setCurrentTime] = useState<Date>(
    () => new Date(2026, 5, 21, 12, 0, 0),
  )
  const [visibility, setVisibility] = useState<Record<LayerKey, boolean>>(
    () =>
      Object.fromEntries(LAYERS.map((l) => [l.id, l.default])) as Record<
        LayerKey,
        boolean
      >,
  )
  const [trees, setTrees] = useState<TreePoint[] | null>(null)
  // Evita fetch doppi del GeoJSON alberi (lazy: parte al primo toggle del
  // layer 'Alberi'). Su errore viene rimesso a false per consentire un retry.
  const treesRequestedRef = useRef(false)
  const treesVisible = visibility['trees']
  // Layer 3D degli alberi memoizzati su [treesVisible, trees]: NON vengono
  // ricostruiti (ne' i 100k+ alberi rifiltrati per tipo) a ogni tick del time
  // slider o al toggle di altri layer -> molto piu' fluido.
  const treeLayers = useMemo(
    () => buildTreesLayers(treesVisible, trees),
    [treesVisible, trees],
  )
  // Arredo urbano (lazy come gli alberi: carica al primo toggle del layer).
  const [arredo, setArredo] = useState<ArredoFeature[] | null>(null)
  const arredoRequestedRef = useRef(false)
  const arredoVisible = visibility['arredo']
  const arredoLayers = useMemo(
    () => buildArredoLayers(arredoVisible, arredo),
    [arredoVisible, arredo],
  )
  // Modalita' inserimento utente (sessione): tool attivo, oggetti posati,
  // primo punto in attesa per i tool a linea. I ref danno al click handler
  // (registrato una sola volta) i valori SEMPRE aggiornati.
  const [insertTool, setInsertTool] = useState<InsertTool | null>(null)
  const [insertPanelOpen, setInsertPanelOpen] = useState(false)
  const [placed, setPlaced] = useState<PlacedObject[]>([])
  // Id dell'oggetto inserito attualmente SELEZIONATO (click su di esso): mostra
  // la barretta ruota/elimina e l'anello di selezione. null = nessuno.
  const [selectedPlaced, setSelectedPlaced] = useState<number | null>(null)
  const [lineStart, setLineStart] = useState<[number, number, number] | null>(null)
  const insertToolRef = useRef<InsertTool | null>(null)
  const lineStartRef = useRef<[number, number, number] | null>(null)
  const placedIdRef = useRef(0)
  useEffect(() => {
    insertToolRef.current = insertTool
  }, [insertTool])
  useEffect(() => {
    lineStartRef.current = lineStart
  }, [lineStart])
  // Cursore a mirino quando un tool e' attivo (il punto d'inizio linea viene
  // azzerato dai click che cambiano/disattivano il tool, non qui).
  useEffect(() => {
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = insertTool ? 'crosshair' : ''
  }, [insertTool])
  const placedLayers = useMemo(() => buildPlacedLayers(placed), [placed])
  // Oggetto inserito selezionato (per anello + barretta ruota/elimina).
  const selectedPlacedObj = useMemo(
    () => placed.find((p) => p.id === selectedPlaced) ?? null,
    [placed, selectedPlaced],
  )
  // Ruota di 30° l'oggetto selezionato (orientamento attorno alla verticale).
  const rotateSelected = (deltaDeg: number) =>
    setPlaced((prev) =>
      prev.map((p) =>
        p.id === selectedPlaced ? { ...p, heading: p.heading + deltaDeg } : p,
      ),
    )
  // Elimina l'oggetto selezionato.
  const deleteSelected = () => {
    setPlaced((prev) => prev.filter((p) => p.id !== selectedPlaced))
    setSelectedPlaced(null)
  }
  const [probe, setProbe] = useState<{ lat: number; lon: number } | null>(null)
  // Albero cliccato (picking deck.gl): mostra un popup con le sue info.
  const [selectedTree, setSelectedTree] = useState<{
    lon: number
    lat: number
    z: number
    props: TreeProps
  } | null>(null)
  const treePopupRef = useRef<maplibregl.Popup | null>(null)
  // Arredo cliccato (picking deck.gl): popup con tipo/stato/quartiere.
  const [selectedArredo, setSelectedArredo] = useState<{
    lon: number
    lat: number
    props: ArredoFeature['properties']
  } | null>(null)
  const arredoPopupRef = useRef<maplibregl.Popup | null>(null)
  // air_temp dell'edificio sotto l'ultimo click (null = nessun edificio o fuori
  // dominio ENVI-met). Usato dal pannello del punto in modalita' temperatura.
  const probeBuildingTempRef = useRef<number | null>(null)
  // (I valori al punto cliccato e il profilo verticale sono ora DERIVATI con
  // useMemo più sotto — vedi `pointEnv` / `pointProfile`: lettura pura dai
  // cubi in memoria, niente stato + effect.)
  // Cubi ENVI-met: `envCubeTick` scatta quando un cubo GeoTIFF finisce di
  // decodificare (ritriggera memo/effect che leggono getCubeSync);
  // `envLoading` guida l'indicatore di avanzamento accanto al toggle.
  const [envCubeTick, setEnvCubeTick] = useState(0)
  const [envLoading, setEnvLoading] = useState<
    Record<string, { loaded: number; total: number } | 'error'>
  >({})
  // Segnaposto "Google Maps" del punto cliccato sulla mappa.
  const probeMarkerRef = useRef<maplibregl.Marker | null>(null)
  // Stazioni qualita' aria (marker DOM, sempre sopra agli edifici 3D).
  const [airStations, setAirStations] = useState<AirStation[] | null>(null)
  const airMarkersRef = useRef<maplibregl.Marker[]>([])
  // Rumore: tooltip con i dB che segue il mouse sulla strada. (L'hiss Web
  // Audio proporzionale ai dB è stato RIMOSSO il 17/08/2026: suonava anche a
  // suoni spenti e infastidiva — richiesta utente/prof.)
  const noiseTipRef = useRef<maplibregl.Popup | null>(null)
  // Parto SUBITO dal file con le altezze (esiste): gli edifici 3D giusti si
  // caricano dall'inizio, senza il flash del footprint piatto (z=0, sepolto
  // sotto il terreno). Se il file processato mancasse, si ripiega sul footprint.
  const [buildingsUrl, setBuildingsUrl] = useState<string>(
    BUILDINGS_HEIGHTS_URL,
  )
  // Visibilita' degli overlay microclima (dinamici, fino a 37+). Separata dal
  // record `visibility` tipizzato. UNO alla volta: accenderne uno azzera gli
  // altri. Chiave = `key` dell'overlay.
  const [envVisible, setEnvVisible] = useState<Record<string, boolean>>({})
  // Inquadra il dominio dei dati ENVI-met con una vista OBLIQUA (pitch ~50°),
  // così quando si attiva un overlay microclima O gli "Edifici → temperatura"
  // la camera ci va sopra in diagonale: il "foglio" del dato alle varie quote si
  // legge in 3D (prima era una vista piatta dall'alto, richiesta utente). Tutti
  // gli overlay condividono lo stesso dominio -> bounds costanti (ENV_BOUNDS).
  const flyToEnvDomain = () => {
    const map = mapRef.current
    if (!map) return
    const [west, south, east, north] = ENV_BOUNDS
    // fitBounds non accetta pitch ≠ 0 nel calcolo: prima inquadro il dominio a
    // piatto per ricavare centro/zoom, poi easeTo con il pitch obliquo.
    const cam = map.cameraForBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: { top: 90, bottom: 160, left: 70, right: 70 } },
    )
    if (!cam) return
    map.easeTo({
      center: cam.center,
      // Col pitch la prospettiva "stringe"; un tempo toglievo zoom, ma l'utente
      // vuole avvicinarsi un po' di piu' al dominio microclima -> aggiungo zoom.
      zoom: (typeof cam.zoom === 'number' ? cam.zoom : map.getZoom()) + 0.6,
      pitch: 50, // vista in diagonale
      bearing: map.getBearing(),
      duration: 1100,
      essential: true,
    })
  }
  const selectEnv = (key: string, on: boolean) => {
    setEnvVisible(on ? { [key]: true } : {})
    if (on) flyToEnvDomain()
  }
  // Quota (indice banda 0-53 del cubo) selezionata dallo slider altezza per
  // gli overlay microclima 3D. Default 2 = livello pedonale (~1.5 m). Ora che
  // il dato viene dal cubo GeoTIFF, TUTTE le 54 quote sono selezionabili
  // (prima solo le 9 con un PNG precotto).
  // (Quota suolo / piano del suolo / source: costanti in lib/envimetGeo.)
  const [envHeightBand, setEnvHeightBand] = useState(2)
  // ---- "MICROCLIMA VIVO": animazione multi-dato, tutta CLIENT-SIDE ---------
  // (motore in lib/microlive.ts). Un toggle dedicato nella categoria Microclima
  // accende TRE sistemi di particelle SOVRAPPOSTI all'overlay di base scelto:
  //   ~ scie di vento avvette dal campo ENVI-met (stile windy.com), alla quota
  //     dello slider (modulo per quota dai valori grezzi; direzione decodificata
  //     nel BROWSER dal PNG viridis, o da wind_uv.values.json se presente);
  //   🔥 "fiammelle" che salgono dove la temperatura percepita (MRT) e' alta;
  //   ○ foschia lenta dove l'umidita' relativa e' alta.
  // Cosi' piu' dati si LEGGONO INSIEME e in movimento, e il lavoro (decodifica
  // raster, colori, animazione) sta nel client, non nella pipeline Python.
  const [liveOn, setLiveOn] = useState(false)
  // Scatta quando i dati del vivo sono caricati/decodificati (avvia il loop).
  const [liveReady, setLiveReady] = useState(0)
  const liveSysRef = useRef<{
    frame: DomainFrame
    wind: WindField
    /** Texture u/v per le scie GPU, ricostruita al cambio quota. */
    windTex: WindTexture
    /** Piano del suolo [a,b,c] per la quota delle scie (quota = a+b*lon+c*lat). */
    groundPlane: [number, number, number]
    /** Quota (m sul suolo) delle scie = quota dello slider. */
    zM: number
    heat: Embers
    mist: Embers
    // Cubi flow_u/flow_v: al cambio quota dello slider si ricampiona la slice
    // giusta (vettori vento ESATTI a ogni quota, dai GeoTIFF).
    uCube: EnvimetCube
    vCube: EnvimetCube
  } | null>(null)
  // Layer deck del vivo, ricostruiti a ogni frame dal loop rAF.
  const liveLayersRef = useRef<Layer[]>([])
  // Ultimo array di layer STATICI costruito dall'effect principale: il loop
  // rAF lo riusa cosi' com'e' (stesse istanze -> diff deck quasi gratis).
  const staticLayersRef = useRef<Layer[]>([])

  // Carica e prepara (una volta) i dati del "vivo": i cubi GeoTIFF di
  // flow_u/flow_v (vettori vento ESATTI a ogni quota), MRT e umidita', tutti
  // decodificati NEL BROWSER (lib/envimetTif). Gia' in cache se l'utente ha
  // acceso gli overlay corrispondenti.
  useEffect(() => {
    if (!liveOn || liveSysRef.current) return
    let cancelled = false
    ;(async () => {
      try {
        const [uCube, vCube, mrtCube, humCube] = await Promise.all([
          loadCube('flow_u'),
          loadCube('flow_v'),
          loadCube('mean_radiant_temp'),
          loadCube('humidity'),
        ])
        if (cancelled) return
        const frame = envFrame()
        const zIdx = Math.min(envHeightBand, uCube.nz - 1)
        const wind = WindField.fromUV(sliceGrid(uCube, zIdx), sliceGrid(vCube, zIdx))
        const gp = ENV_GROUND_PLANE
        const groundPlane: [number, number, number] = [gp.a, gp.b, gp.c]
        const windTex = buildWindTexture(frame, wind)
        // Fumo sempre dalla banda pedonale: e' li' che il caldo "si sente".
        // ~4k sprite CPU: il loop di step() resta sotto il ms, il costo vero
        // e' il fill-rate GPU degli sprite sovrapposti (ok su GPU integrate).
        const heat = new Embers(frame, sliceGrid(mrtCube, 2), envGroundAt, wind, {
          ...EMBER_HEAT,
          count: 6500,
        })
        const mist = new Embers(frame, sliceGrid(humCube, 2), envGroundAt, wind, {
          ...EMBER_MIST,
          count: 400,
        })
        liveSysRef.current = {
          frame,
          wind,
          windTex,
          groundPlane,
          zM: uCube.zM[zIdx] ?? 1.5,
          heat,
          mist,
          uCube,
          vCube,
        }
        setLiveReady((x) => x + 1)
      } catch (e) {
        console.warn('[microclima vivo] dati non disponibili:', e)
      }
    })()
    return () => {
      cancelled = true
    }
    // envHeightBand volutamente fuori: la quota e' gestita dall'effect sotto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOn])

  // Slider quota: ricampiona le slice u/v del campo vento alla nuova banda e
  // aggiorna la quota a cui volano le scie, senza ricreare i sistemi.
  useEffect(() => {
    const sys = liveSysRef.current
    if (!sys) return
    const zIdx = Math.min(envHeightBand, sys.uCube.nz - 1)
    sys.wind.setUV(sliceGrid(sys.uCube, zIdx), sliceGrid(sys.vCube, zIdx))
    // Nuova texture u/v per il motore GPU (il campo alla quota e' cambiato).
    sys.windTex = buildWindTexture(sys.frame, sys.wind)
    sys.zM = sys.uCube.zM[zIdx] ?? 1.5
  }, [envHeightBand, liveReady])

  // Loop di animazione (~30 fps): avanza i sistemi, ricostruisce i layer del
  // vivo e li compone con gli ULTIMI layer statici. In pagina nascosta rAF si
  // ferma da solo; spegnendo il toggle si rimuovono i layer e il loop muore.
  useEffect(() => {
    const sys = liveSysRef.current
    const overlay = overlayRef.current
    if (!liveOn || !sys || !overlay) {
      if (!liveOn && overlayRef.current && liveLayersRef.current.length > 0) {
        liveLayersRef.current = []
        overlayRef.current.setProps({ layers: [...staticLayersRef.current] })
        mapRef.current?.triggerRepaint()
      }
      return
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dtMs = now - last
      if (dtMs < 33) return // cap ~30 fps: basta e avanza, risparmia batteria
      last = now
      const dt = Math.min(0.1, dtMs / 1000)
      sys.heat.step(dt, now / 1000)
      sys.mist.step(dt, now / 1000)
      liveLayersRef.current = buildLiveLayers(sys)
      if (overlayReadyRef.current && overlayRef.current) {
        overlayRef.current.setProps({
          layers: [...staticLayersRef.current, ...liveLayersRef.current],
        })
        mapRef.current?.triggerRepaint()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // overlayReady nelle dipendenze: se il toggle e' gia' attivo al caricamento
    // i dati possono arrivare PRIMA che l'overlay deck esista; senza ri-run il
    // loop resterebbe morto (overlay catturato null all'avvio dell'effect).
  }, [liveOn, liveReady, overlayReady])
  const [basemap, setBasemap] = useState<BasemapId>('dark')
  // Pannello basemap: ora e' un menu APRIBILE accanto alla barra di ricerca
  // (prima era un pannello fisso in basso a destra). Chiuso di default.
  const [basemapOpen, setBasemapOpen] = useState(false)
  const reapplyRef = useRef<(() => void) | null>(null)
  const [collapsed, setCollapsed] = useState<Record<CategoryKey, boolean>>(
    () =>
      Object.fromEntries(
        CATEGORIES.map((c) => [c.key, !c.defaultOpen]),
      ) as Record<CategoryKey, boolean>,
  )
  const [bearing, setBearing] = useState(-20)
  // Centro vista per la dissolvenza degli edifici lontani: aggiornato a
  // 'moveend' (non a ogni frame). Vedi BUILDINGS_FADE_*.
  const [fadeCenter, setFadeCenter] = useState<{ lon: number; lat: number } | null>(
    null,
  )
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null)
  // Evita che il riempimento automatico del campo dopo aver scelto un risultato
  // (gotoResult fa setSearch) ri-lanci i suggerimenti as-you-type.
  const suppressSuggestRef = useRef(false)
  // Vista pulita: nasconde tutti i pannelli/filtri per uno screenshot o una
  // vista 3D senza ingombri. Lo screenshot cattura comunque solo le canvas
  // (mappa + deck), mai il DOM dei pannelli.
  const [uiHidden, setUiHidden] = useState(false)
  // Pannello meteo (widget 3BMeteo). Si nasconde anche in vista pulita.
  const [meteoOpen, setMeteoOpen] = useState(false)
  // Toast "link copiato" dopo il fallback di condivisione su desktop.
  const [shareToast, setShareToast] = useState(false)
  // (Il paesaggio sonoro sintetizzato — lib/soundscape.ts — e il bottone
  // "Suoni della zona" sono stati RIMOSSI il 17/08/2026 su richiesta; il
  // motore resta nel repo come materiale di tesi.)
  const [quartieri, setQuartieri] = useState<QuartiereFeature[] | null>(null)
  const [selectedQuartiere, setSelectedQuartiere] = useState<number | null>(
    null,
  )
  // Quartiere il cui bordo "lampeggia" per qualche secondo dopo un cambio,
  // poi svanisce in fade (flashFading -> alpha 0 con transizione deck.gl).
  const [flashQuartiere, setFlashQuartiere] = useState<number | null>(null)
  const [flashFading, setFlashFading] = useState(false)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [layerPanelOpen, setLayerPanelOpen] = useState(true)
  const [zonePanelOpen, setZonePanelOpen] = useState(false)
  // Sotto-gruppo "dati tecnici" del microclima: chiuso di default, cosi' il
  // cittadino vede solo i 7 dati curati e non un muro di 31 variabili tecniche.
  const [techOpen, setTechOpen] = useState(false)
  // Banner di benvenuto (mostrato una volta sola, poi ricordato in
  // localStorage). Guida il cittadino: scegli un dato, clicca sulla mappa.
  // Initializer pigro: MapViewer e' montato solo client-side (dynamic
  // ssr:false), quindi localStorage e' sempre disponibile al primo render.
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return !localStorage.getItem('us3d_intro_seen')
    } catch {
      return true
    }
  })
  const dismissIntro = () => {
    setShowIntro(false)
    try {
      localStorage.setItem('us3d_intro_seen', '1')
    } catch {}
  }
  // Guida testuale completa (modale): stato INTERNO, aperta dal banner della
  // modalità Aiuto ("Guida completa") o dal banner di benvenuto. Il bottone
  // "Guida" dell'header apre invece la modalità AIUTO annotata (helpOpen).
  const [showGuide, setShowGuide] = useState(false)
  // Modalità AIUTO: rettangoli (in coordinate viewport) dei comandi marcati con
  // `data-help`, misurati all'apertura. Per ognuno disegno un contorno giallo
  // tratteggiato + una card che spiega cosa fa (vedi HELP_INFO e l'overlay).
  const [helpRects, setHelpRects] = useState<{ key: string; rect: DOMRect }[]>([])
  useEffect(() => {
    if (!helpOpen) return // l'overlay non e' renderizzato: rect stantii innocui
    const measure = () => {
      const els = Array.from(
        document.querySelectorAll<HTMLElement>('[data-help]'),
      )
      const out: { key: string; rect: DOMRect }[] = []
      for (const el of els) {
        const k = el.getAttribute('data-help')
        if (!k) continue
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) out.push({ key: k, rect: r })
      }
      setHelpRects(out)
    }
    // Misura SOLO in timeout (niente setState sincrono nell'effect): subito
    // dopo il commit e di nuovo quando i pannelli si sono disposti.
    const t0 = setTimeout(measure, 0)
    const t1 = setTimeout(measure, 120)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(t0)
      clearTimeout(t1)
      window.removeEventListener('resize', measure)
    }
    // L'overlay e' pointer-events-none: l'utente puo' aprire/chiudere pannelli
    // MENTRE l'aiuto e' attivo. Ogni stato che sposta o mostra/nasconde un
    // comando marcato data-help sta nelle deps, cosi' contorni e card seguono
    // la UI reale invece di restare sulla foto scattata all'apertura.
  }, [
    helpOpen,
    lang,
    layerPanelOpen,
    zonePanelOpen,
    basemapOpen,
    collapsed,
    probe,
    visibility,
    envVisible,
    searchResults,
    selectedQuartiere,
    uiHidden,
  ])
  // Overlay microclima attivo come foglio 3D (SimpleMeshLayer texturizzata) o
  // null. Il DATO viene dal cubo GeoTIFF decodificato nel browser: qui si
  // prende la slice della quota dello slider e la si COLORA client-side
  // (lib/envimetColor, stessa rampa dei vecchi PNG). Il foglio è INCLINATO sul
  // piano del suolo: ogni angolo ha la sua quota = suolo locale + z banda,
  // così a 1.5/4.5 m segue la pendenza N-S del dominio (~13 m).
  const envSlice = useMemo<
    {
      def: EnvimetVarDef
      cube: EnvimetCube
      /** Slice colorata (RGBA) pronta come texture del foglio. */
      image: ImageData
      values: Float32Array
      zIdx: number
      zM: number
      // Quota del suolo a un punto qualsiasi: FALLBACK del foglio-mesh quando
      // il terreno 3D non è ancora caricato (piano del suolo, segue la pendenza).
      groundAt: (lon: number, lat: number) => number
    } | null
  >(() => {
    const def = ENV_OVERLAYS.find((o) => envVisible[o.key])
    if (!def) return null
    const cube = getCubeSync(def.key)
    if (!cube) return null // envCubeTick nelle deps: riprova quando il cubo arriva
    const zIdx = def.agg === 'band' ? Math.min(envHeightBand, cube.nz - 1) : 0
    const values = def.agg === 'maxz' ? maxZSlice(cube) : bandSlice(cube, zIdx)
    const [vmin, vmax] = cubeRange(cube)
    const image = colorizeSlice(values, cube.w, cube.h, def.ramp, vmin, vmax)
    // Quota (m sul suolo) della banda scelta: il foglio sale a questa altezza.
    const zM = def.agg === 'band' ? (cube.zM[zIdx] ?? 1.5) : 1.5
    return { def, cube, image, values, zIdx, zM, groundAt: envGroundAt }
    // envCubeTick: i cubi arrivano fuori da React, il tick invalida il memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envVisible, envHeightBand, envCubeTick])

  // Mesh del foglio microclima che SEGUE IL TERRENO (vedi buildEnvSheetMesh):
  // ogni vertice a `quota_terreno_reale + z_banda`, campionando la quota dal
  // terreno 3D di MapLibre (queryTerrainElevation), con fallback al piano del
  // suolo se il terreno non è ancora caricato. Ricostruita quando cambia
  // overlay/quota o quando il terreno diventa pronto (overlayReady). `elevAt` è
  // riusato per posare il pallino del punto cliccato sul foglio.
  const envSheet = useMemo(() => {
    if (!envSlice) return null
    const map = mapRef.current
    const c = ENV_CORNERS
    const anchorLng = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4
    const anchorLat = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4
    const qe =
      map &&
      typeof (map as unknown as { queryTerrainElevation?: unknown })
        .queryTerrainElevation === 'function'
        ? (
            map as unknown as {
              queryTerrainElevation: (ll: [number, number]) => number | null
            }
          ).queryTerrainElevation
        : null
    const elevAt = (lng: number, lat: number) => {
      const e = qe ? qe.call(map, [lng, lat]) : null
      return typeof e === 'number' && Number.isFinite(e)
        ? e
        : envSlice.groundAt(lng, lat)
    }
    const mesh = buildEnvSheetMesh(
      [c[0], c[1], c[2], c[3]] as [number, number][],
      envSlice.zM,
      elevAt,
      anchorLng,
      anchorLat,
    )
    return {
      mesh,
      anchor: [anchorLng, anchorLat, 0] as [number, number, number],
      elevAt,
    }
    // overlayReady: ricostruisce quando il terreno è caricato (quote reali).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envSlice, overlayReady])

  // Ref aggiornato a `currentTime`: serve dentro callback registrate al
  // mount (basemap switch, addCustomLayers) per leggere SEMPRE l'ora
  // corrente senza ricreare la mappa.
  const currentTimeRef = useRef<Date>(new Date(2026, 5, 21, 12, 0, 0))

  // Prefetch degli edifici 3D (~32 MB) con AVANZAMENTO REALE in byte: leggiamo
  // lo stream della risposta e aggiorniamo `buildingsBytes` man mano, cosi' la
  // barra del loader riflette quanto e' stato davvero scaricato (non scatti
  // fissi). A fine download parsiamo il GeoJSON e lo passiamo al layer deck
  // (niente secondo download). Su errore si ripiega: il layer scarica da URL e
  // sblocchiamo comunque il loader.
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(buildingsUrl, { signal: ctrl.signal })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let loaded = 0
        // Aggiorno lo stato solo ogni ~1% (la barra avanza fluida lo stesso
        // grazie alla transition CSS) per non scatenare un render per chunk.
        let lastReported = 0
        const STEP = BUILDINGS_BYTES_EST / 100
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            loaded += value.length
            if (!cancelled && loaded - lastReported >= STEP) {
              lastReported = loaded
              setBuildingsBytes(loaded)
            }
          }
        }
        const text = await new Blob(chunks as BlobPart[]).text()
        const fc = JSON.parse(text)
        if (cancelled) return
        setBuildingsData(fc)
        // Parse finito: forza la barra al 100% sulla quota edifici.
        setBuildingsBytes(BUILDINGS_BYTES_EST)
        setBuildingsReady(true)
      } catch {
        if (cancelled) return
        // Fallback: segnalo il fallimento -> il layer scarica da URL (vedi
        // caller di buildShadowBuildingsLayer); sblocco comunque il loader.
        setBuildingsLoadFailed(true)
        setBuildingsReady(true)
      }
    })()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [buildingsUrl])

  // Carica gli alberi in modo LAZY: il GeoJSON OSM pesa ~18 MB (106k alberi
  // con specie/genere), inutile scaricarlo finche' il layer 'Alberi' resta
  // spento (e' off di default). Parte al primo attivamento del toggle; prova
  // OSM (Overpass), fallback al DBTR clippato all'AOI. Un solo fetch grazie a
  // treesRequestedRef (rimesso a false su errore per consentire un retry).
  useEffect(() => {
    if (!visibility['trees'] || treesRequestedRef.current) return
    treesRequestedRef.current = true
    const tryFetch = async (url: string) => {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<{
        features: {
          geometry: { coordinates: [number, number] | [number, number, number] }
          properties?: TreeProps | null
        }[]
      }>
    }
    tryFetch(TREES_BOLOGNA_URL)
      .catch(() => tryFetch(TREES_OSM_URL))
      .catch(() => tryFetch(TREES_DBTR_URL))
      .then((fc) => {
        setTrees(
          fc.features.map((f) => {
            const [lon, lat, z] = f.geometry.coordinates
            return {
              position: [lon, lat, z ?? 0] as [number, number, number],
              seed: hashSeed(lon, lat),
              props: f.properties ?? {},
            }
          }),
        )
      })
      .catch(() => {
        setTrees([])
        treesRequestedRef.current = false
      })
  }, [visibility])

  // Carica l'arredo urbano in modo LAZY (come gli alberi): parte al primo
  // attivamento del layer 'Arredo urbano'. Su errore rimette il ref a false.
  useEffect(() => {
    if (!visibility['arredo'] || arredoRequestedRef.current) return
    arredoRequestedRef.current = true
    fetch(ARREDO_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ features: ArredoFeature[] }>
      })
      .then((fc) => setArredo(fc.features ?? []))
      .catch(() => {
        setArredo([])
        arredoRequestedRef.current = false
      })
  }, [visibility])

  // Loader iniziale: i dati sono pronti (stile/terreno + edifici parsati) MA
  // deck.gl deve ancora tassellare/disegnare i 32 MB di edifici. Se svelassimo
  // subito si vedrebbe la scena VUOTA per un istante. Quindi aspettiamo il
  // prossimo 'idle' della mappa (= edifici effettivamente disegnati) prima di
  // togliere il loader. Rete di sicurezza a 6 s se l''idle' non arrivasse.
  useEffect(() => {
    const map = mapRef.current
    if (!(mapLoaded && buildingsReady) || !map) return
    let done = false
    const finish = () => {
      if (done) return
      done = true
      setLoading(false)
    }
    map.once('idle', finish)
    const t = window.setTimeout(finish, 6000)
    return () => {
      window.clearTimeout(t)
      map.off('idle', finish)
    }
  }, [mapLoaded, buildingsReady])
  // Rete di sicurezza: il loader non resta mai bloccato oltre 25 s.
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 25000)
    return () => clearTimeout(t)
  }, [])

  // Probe asset processati (altezze edifici da DSM, overlay vento). Se i file
  // non esistono ancora -- l'utente non ha lanciato gli script di build --
  // i layer ricadono sul footprint base / niente overlay.
  useEffect(() => {
    let cancelled = false
    // Default = file con altezze. Se NON esiste (script non lanciati), ripiego
    // sul footprint piatto cosi' gli edifici si vedono comunque.
    fetch(BUILDINGS_HEIGHTS_URL, { method: 'HEAD' })
      .then((r) => {
        if (!cancelled && !r.ok) setBuildingsUrl(BUILDINGS_FOOTPRINT_URL)
      })
      .catch(() => {
        if (!cancelled) setBuildingsUrl(BUILDINGS_FOOTPRINT_URL)
      })
    // Stazioni qualita' aria: carico il geojson (se esiste) e lo metto in
    // stato; i marker DOM vengono creati da un effect dedicato.
    fetch(AIR_STATIONS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (cancelled || !fc || !Array.isArray(fc.features)) return
        setAirStations(fc.features as AirStation[])
      })
      .catch(() => {})
    // (Gli overlay microclima ENVI-met vengono dal registry statico + cubi
    // GeoTIFF decodificati nel browser: niente piu' overlays.json da caricare.)
    return () => {
      cancelled = true
    }
  }, [])

  // Carica (lazy) i CUBI GeoTIFF delle variabili accese: il download parte al
  // toggle, la decodifica gira in un worker (lib/envimetTif), e `envLoading`
  // guida l'indicatore di avanzamento accanto alla voce del pannello. La MRT
  // si carica anche per 'Edifici -> temperatura' (valore al click).
  useEffect(() => {
    const wanted = new Set<string>()
    for (const o of ENV_OVERLAYS) if (envVisible[o.key]) wanted.add(o.key)
    if (visibility['buildings-temp']) wanted.add('mean_radiant_temp')
    for (const key of wanted) {
      if (getCubeSync(key)) continue
      // Seed dell'indicatore in microtask (niente setState sincrono
      // nell'effect); arriva comunque prima del primo progress della fetch.
      queueMicrotask(() =>
        setEnvLoading((s) =>
          key in s ? s : { ...s, [key]: { loaded: 0, total: 0 } },
        ),
      )
      loadCube(key, (loaded, total) =>
        setEnvLoading((s) => ({ ...s, [key]: { loaded, total } })),
      )
        .then(() => {
          setEnvLoading((s) => {
            if (!(key in s)) return s
            const rest = { ...s }
            delete rest[key]
            return rest
          })
          setEnvCubeTick((t) => t + 1)
        })
        .catch(() => {
          // Tif assente (variabile non "shipped" online) o decodifica fallita:
          // la voce resta spuntabile ma il toggle mostra l'errore.
          setEnvLoading((s) => ({ ...s, [key]: 'error' }))
        })
    }
  }, [visibility, envVisible])

  // Deriva i valori al punto cliccato dai layer attivi + cubi pronti, e il
  // PROFILO VERTICALE completo (tutte le 54 quote) della variabile attiva:
  // col cubo in memoria "il valore a ogni quota" e' una lettura gratis, quindi
  // sono useMemo (derivazione pura), non stato aggiornato da un effect.
  const activeProbeOverlays = useMemo<EnvimetVarDef[]>(() => {
    const active = ENV_OVERLAYS.filter((o) => envVisible[o.key])
    // Se 'Edifici -> temperatura' e' attivo, mostra comunque la temperatura
    // percepita (MRT) al punto cliccato (anche con l'overlay raster spento):
    // e' la grandezza con cui sono colorati gli edifici.
    if (visibility['buildings-temp']) {
      const mrtDef = ENV_OVERLAYS.find((o) => o.key === 'mean_radiant_temp')
      if (mrtDef && !active.some((o) => o.key === 'mean_radiant_temp')) {
        active.unshift(mrtDef)
      }
    }
    return active
  }, [envVisible, visibility])
  const pointEnv = useMemo<
    { key: string; label: string; unit: string; value: number | null }[]
  >(() => {
    if (!probe) return []
    const { lat, lon } = probe
    const frame = envFrame()
    const sample = (o: EnvimetVarDef): number | null => {
      const cube = getCubeSync(o.key)
      if (!cube) return null
      const [u, v] = frame.uvFromLonLat(lon, lat)
      // Variabili max-z (vegetazione): si campiona l'aggregato, non una banda.
      const grid =
        o.agg === 'maxz'
          ? { w: cube.w, h: cube.h, v: maxZSlice(cube) }
          : sliceGrid(cube, Math.min(envHeightBand, cube.nz - 1))
      const x = frame.sample(grid, u, v)
      return x == null ? null : Math.round(x * 10) / 10
    }
    return activeProbeOverlays.map((o) => ({
      key: o.key,
      label: envLabel(o, lang),
      unit: o.unit,
      // Per la MRT preferisco quella dell'edificio cliccato (esatta, = colore
      // dell'edificio); altrimenti campiono il cubo alla quota dello slider.
      value:
        o.key === 'mean_radiant_temp' && probeBuildingTempRef.current != null
          ? probeBuildingTempRef.current
          : sample(o),
    }))
    // envCubeTick: i cubi arrivano fuori da React, il tick invalida il memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe, activeProbeOverlays, envCubeTick, envHeightBand, lang])
  // Profilo verticale della prima variabile attiva con dimensione z.
  const pointProfile = useMemo<{
    def: EnvimetVarDef
    points: { zM: number; v: number | null }[]
    vmin: number
    vmax: number
  } | null>(() => {
    if (!probe) return null
    const profDef = activeProbeOverlays.find((o) => o.agg === 'band')
    const profCube = profDef ? getCubeSync(profDef.key) : null
    if (!profDef || !profCube) return null
    const prof = verticalProfile(profCube, probe.lon, probe.lat)
    const [vmin, vmax] = cubeRange(profCube)
    return prof.some((p) => p.v != null)
      ? { def: profDef, points: prof, vmin, vmax }
      : null
    // envCubeTick: come sopra, invalida il memo quando un cubo finisce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe, activeProbeOverlays, envCubeTick])

  // Range colore di 'Edifici -> temperatura': percentili 5-95 delle MRT
  // pedonali DEGLI EDIFICI stessi. Prima si usava il min/max dell'intero cubo
  // (tutte le 54 quote, outlier compresi): gli edifici occupavano solo un
  // pezzo della rampa e sembravano tutti uguali/saturi. Sul range reale delle
  // case le differenze sole/ombra si vedono. Fallback 20-80 (registry) finche'
  // il GeoJSON non e' pronto.
  const mrtBuildingsRange = useMemo<{ min: number; max: number } | null>(() => {
    if (!visibility['buildings-temp']) return null
    const fc = buildingsData as { features?: BuildingFeature[] } | null
    const vals: number[] = []
    if (fc && Array.isArray(fc.features)) {
      for (const f of fc.features) {
        const v = pedestrianMrt(f.properties?.mrt_col)
        if (v != null) vals.push(v)
      }
    }
    if (vals.length < 10) return { min: 20, max: 80 }
    vals.sort((a, b) => a - b)
    const q = (p: number) =>
      vals[Math.min(vals.length - 1, Math.round(p * (vals.length - 1)))]
    return { min: q(0.05), max: q(0.95) }
  }, [visibility, buildingsData])

  // Marker DOM delle stazioni qualita' aria (sempre sopra agli edifici 3D,
  // che con deck.gl occluderebbero i cerchi MapLibre). Click -> popup con le
  // medie inquinanti. Ricreati quando cambiano i dati o il toggle.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    airMarkersRef.current.forEach((m) => m.remove())
    airMarkersRef.current = []
    if (!airStations || !visibility['air-stations']) return
    for (const s of airStations) {
      const [lon, lat] = s.geometry.coordinates
      const el = document.createElement('div')
      el.style.cssText =
        'width:15px;height:15px;border-radius:50%;background:#1272b7;' +
        'border:2px solid #0a4d7a;box-shadow:0 0 8px 3px rgba(18,114,183,.45);' +
        'cursor:pointer'
      const p = s.properties
      const row = (v: number | null | undefined, label: string) =>
        v != null
          ? `<div style="display:flex;justify-content:space-between;gap:10px;"><span>${label}</span><b>${v} µg/m³</b></div>`
          : ''
      const html =
        `<div style="font-family:ui-monospace,monospace;font-size:12px;color:#222;min-width:150px;">` +
        `<div style="color:#0e7490;font-weight:700;margin-bottom:2px;">${p.name ?? 'Stazione'}</div>` +
        (p.type ? `<div style="color:#777;margin-bottom:4px;">${p.type}</div>` : '') +
        row(p.no2_avg, 'NO₂') +
        row(p.pm10_avg, 'PM10') +
        row(p.pm25_avg, 'PM2.5') +
        row(p.ozone_avg, 'O₃') +
        (p.samples
          ? `<div style="color:#999;margin-top:4px;">media ${p.samples} campioni${p.window_end ? ` · al ${p.window_end}` : ''}</div>`
          : '') +
        `</div>`
      const popup = new maplibregl.Popup({
        closeButton: true,
        offset: 16,
        anchor: 'bottom', // compare SOPRA il punto
        className: 'us3d-popup',
      }).setHTML(html)
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lon, lat])
        .setPopup(popup)
        .addTo(map)
      airMarkersRef.current.push(marker)
    }
    return () => {
      airMarkersRef.current.forEach((m) => m.remove())
      airMarkersRef.current = []
    }
  }, [airStations, visibility])

  // Carica i 6 quartieri di Bologna (Open Data Bologna - aree statistiche
  // raggruppate per `cod_quar` in build_quartieri.py). Usati per la search
  // bar (suggerimento "Quartiere: X") e per il blocco pseudo-3D estruso al
  // click.
  useEffect(() => {
    let cancelled = false
    fetch(QUARTIERI_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (cancelled || !fc) return
        setQuartieri(fc.features as QuartiereFeature[])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Segnaposto del punto cliccato: un'icona INFO rossa sul punto selezionato.
  // Si sposta al click successivo e sparisce alla chiusura dell'InfoPanel
  // (probe -> null).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Marker DOM MapLibre: poggia sul terreno 3D (segue il rilievo). Quando però
    // è attivo un foglio microclima SOLLEVATO, il marker sul terreno resterebbe
    // sotto il foglio: in quel caso lo nascondo e uso il disco piatto deck.gl
    // posato sul foglio (vedi 'env-probe-dot').
    if (!probe || envSlice) {
      probeMarkerRef.current?.remove()
      probeMarkerRef.current = null
      return
    }
    if (!probeMarkerRef.current) {
      // Mirino circolare custom (vedi makeProbeInfoElement): alto contrasto su
      // ogni basemap, forma diversa dal PIN della ricerca. anchor 'center' => il
      // centro del mirino cade esattamente sul punto cliccato.
      const marker = new maplibregl.Marker({
        element: makeProbeInfoElement(),
        anchor: 'center',
      })
        .setLngLat([probe.lon, probe.lat])
        .addTo(map)
      // Sempre sopra a tutto: MapLibre assegna lo z-index ai marker per
      // ordinamento prospettico, lo forzo alto cosi' il pin non viene mai
      // occluso dagli edifici 3D ne' dagli altri marker (es. ricerca).
      marker.getElement().style.zIndex = '9999'
      probeMarkerRef.current = marker
    } else {
      probeMarkerRef.current.setLngLat([probe.lon, probe.lat])
    }
  }, [probe, envSlice])

  // Popup info dell'albero cliccato (marker DOM MapLibre, sopra agli edifici
  // deck.gl). Un nuovo click su un altro albero lo sposta; un click sul vuoto
  // o sul tasto × lo chiude (setSelectedTree -> null).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!selectedTree) {
      treePopupRef.current?.remove()
      treePopupRef.current = null
      return
    }
    if (!treePopupRef.current) {
      const popup = new maplibregl.Popup({
        closeButton: true,
        offset: 14,
        anchor: 'bottom',
        className: 'us3d-popup',
      })
      // Chiusura col × => azzero lo stato (cur gia' null quando siamo noi a
      // rimuoverlo nel cleanup: il guard evita un set ridondante).
      popup.on('close', () => setSelectedTree((cur) => (cur ? null : cur)))
      treePopupRef.current = popup
    }
    treePopupRef.current
      .setLngLat([selectedTree.lon, selectedTree.lat])
      .setHTML(
        treePopupHtml(
          selectedTree.lat,
          selectedTree.lon,
          selectedTree.props,
          lang,
        ),
      )
      .addTo(map)
  }, [selectedTree, lang])

  // Popup info dell'arredo cliccato (stessa meccanica del popup albero).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!selectedArredo) {
      arredoPopupRef.current?.remove()
      arredoPopupRef.current = null
      return
    }
    if (!arredoPopupRef.current) {
      const popup = new maplibregl.Popup({
        closeButton: true,
        offset: 14,
        anchor: 'bottom',
        className: 'us3d-popup',
      })
      popup.on('close', () => setSelectedArredo((cur) => (cur ? null : cur)))
      arredoPopupRef.current = popup
    }
    arredoPopupRef.current
      .setLngLat([selectedArredo.lon, selectedArredo.lat])
      .setHTML(arredoPopupHtml(selectedArredo.props, lang))
      .addTo(map)
  }, [selectedArredo, lang])

  // Costruzione mappa.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      // Attribution default DISATTIVATA: ne aggiungo una COMPATTA sotto (solo il
      // bottone ⓘ, toggle chiuso di default). Richiesta: attribution sempre chiusa.
      attributionControl: false,
      style: BASEMAPS[basemap].style,
      center: AOI_CENTER,
      zoom: 14,
      minZoom: 12,
      // 21 = si puo' zoomare bene fino al singolo arredo/albero (i tile basemap
      // oltre il loro nativo vengono sovra-zoomati, gli oggetti 3D restano nitidi).
      maxZoom: 21,
      pitch: 60,
      bearing: -20,
      // Stile streets.gl: LMB pan, RMB drag yaw+pitch (default MapLibre,
      // ribadito esplicitamente). 75 e' il sweet spot: taglio cinematico
      // senza il costo extra del sky fog vicino orizzonte (85 lag su
      // GPU integrate).
      maxPitch: 75,
      dragRotate: true,
      pitchWithRotate: true,
      // Necessario per lo screenshot: senza, drawImage della canvas MapLibre
      // restituisce un frame vuoto (il buffer viene azzerato dopo il
      // compositing). La canvas deck.gl preserva gia' il buffer di default.
      // In maplibre-gl v5 l'opzione vive in canvasContextAttributes.
      canvasContextAttributes: { preserveDrawingBuffer: true },
      // Esteso a sud (44.42) per inquadrare i colli: il terreno 3D e i dati
      // arrivano fin la' (quote fino a ~365 m).
      maxBounds: [
        [11.25, 44.42],
        [11.45, 44.55],
      ],
    })

    // Attribution COMPATTA (compact: true): in basso a destra mostra solo il
    // bottone ⓘ, chiuso di default; l'utente lo apre se vuole le fonti. Persiste
    // attraverso i cambi di basemap (setStyle non rimuove i control aggiunti).
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    )

    // Aggiunge tutti i layer custom alla mappa. Idempotente (controlla
    // map.getLayer prima di addLayer) cosi' puo' essere richiamata dopo
    // map.setStyle() per re-installare i layer sul nuovo stile.
    const addCustomLayers = () => {
      const initialVis = (id: LayerKey) =>
        visibility[id] ? 'visible' : 'none'

      // (Layer MapLibre 'land-use' / uso del suolo e 'buildings-particellari' /
      // footprint 2D RIMOSSI su richiesta utente: niente toggle nel pannello e
      // niente fetch dei rispettivi GeoJSON. BUILDINGS_FOOTPRINT_URL resta usato
      // come fallback degli edifici 3D, non come layer a se'.)

      // NB: edifici 3D OSM (openfreemap) DISATTIVATI. Si sovrapponevano agli
      // edifici Open Data Bologna estrusi da deck.gl (altezze diverse) ->
      // "edifici doppi", z-fighting/sfarfallio e ombre incoerenti (es. lo
      // stadio appariva con una struttura/ombra piu' alta del reale, perche'
      // il `render_height` OSM differiva). I dati Open Data coprono tutto il
      // comune, quindi gli OSM erano ridondanti. Per riattivarli come solo
      // contesto lontano serve un clip fuori dall'AOI (qui non disponibile).

      if (!map.getSource('green')) {
        map.addSource('green', { type: 'geojson', data: GREEN_URL })
      }
      if (!map.getLayer('green-areas')) {
        map.addLayer({
          id: 'green-areas',
          source: 'green',
          type: 'fill',
          paint: {
            'fill-color': 'rgba(34, 197, 94, 0.4)',
            'fill-outline-color': 'rgba(34, 197, 94, 0.8)',
          },
          layout: { visibility: initialVis('green-areas') },
        })
      }

      // (Layer "parks" rimosso: era lo STESSO dataset di green-areas — 5044
      // feature identiche — solo con meno attributi. Si tiene il solo
      // green-areas, che ha la copertura più completa.)

      // Verde privato (Open Data Bologna 2.2)
      if (!map.getSource('private-green')) {
        map.addSource('private-green', {
          type: 'geojson',
          data: PRIVATE_GREEN_URL,
        })
      }
      if (!map.getLayer('private-green')) {
        map.addLayer({
          id: 'private-green',
          source: 'private-green',
          type: 'fill',
          paint: {
            'fill-color': 'rgba(120, 180, 100, 0.45)',
            'fill-outline-color': 'rgba(80, 140, 70, 0.7)',
          },
          layout: { visibility: initialVis('private-green') },
        })
      }

      // Rumore acustico (stima da classe strada, build_noise.py). Linee
      // colorate per dB: verde quieto -> rosso rumoroso. E' un layer di
      // terra; gli edifici 3D deck.gl possono coprirne dei tratti, ma le
      // strade stanno fra gli edifici quindi si leggono bene.
      if (!map.getSource('noise')) {
        map.addSource('noise', { type: 'geojson', data: NOISE_URL })
      }
      if (!map.getLayer('noise')) {
        map.addLayer({
          id: 'noise',
          source: 'noise',
          type: 'line',
          paint: {
            'line-color': [
              'interpolate', ['linear'], ['get', 'noise_db'],
              50, '#22c55e',
              58, '#84cc16',
              65, '#eab308',
              72, '#f97316',
              78, '#ef4444',
            ],
            'line-width': [
              'interpolate', ['linear'], ['get', 'noise_db'],
              50, 1.2,
              78, 5,
            ],
            'line-opacity': 0.85,
          },
          layout: {
            visibility: initialVis('noise'),
            'line-cap': 'round',
            'line-join': 'round',
          },
        })
      }

      // Overlay microclima ENVI-met: sorgente IMMAGINE MapLibre drappeggiata sul
      // terreno 3D (vedi l'effect 'env-overlay'), cosi' segue il rilievo e a
      // quote basse il terreno non lo buca; lo slider quota cambia l'immagine.

      // Stazioni qualita' aria: NON sono piu' layer MapLibre (verrebbero
      // occluse dagli edifici 3D deck.gl, che disegnano sopra tutto). Sono
      // marker DOM (vedi effect dedicato), sempre in primo piano.

      // Terreno 3D. setStyle azzera sia il terrain sia il source, quindi li
      // ri-creiamo qui ad ogni ricarica stile. Gli edifici/alberi deck.gl
      // hanno la quota di base cotta nelle coordinate, quindi poggiano su
      // questa superficie (vedi scripts/bake_terrain_elevation.py).
      if (!map.getSource('terrain-dem')) {
        map.addSource('terrain-dem', {
          type: 'raster-dem',
          tiles: [TERRAIN_TILES_URL],
          encoding: 'terrarium',
          tileSize: 256,
          minzoom: TERRAIN_MINZOOM,
          maxzoom: TERRAIN_MAXZOOM,
          attribution:
            'Quote: Terrain Tiles (Mapzen / AWS Open Data)',
        })
      }
      map.setTerrain({ source: 'terrain-dem', exaggeration: TERRAIN_EXAGGERATION })
    }

    map.on('load', () => {
      addCustomLayers()
      tintBasemapBackground(map, basemap)
      if (basemap === 'dark') whitenMapLabels(map)
      // Dopo il primo render (deck ha aggiunto gli edifici): alzo le etichette.
      map.once('idle', () => raiseMapLabels(map))
      reapplyRef.current = addCustomLayers

      // Effetto luce: creato con lo stato ombre INIZIALE (di default off). Se il
      // toggle "Ombre" cambia, l'overlay viene RICREATO (effect dedicato).
      const shadows0 = !!visibility['shadows']
      const lighting = new LightingEffect(
        sunAmbientFor(currentTime.getTime(), shadows0),
      )
      ;(lighting as unknown as { shadowColor: number[] }).shadowColor = shadows0
        ? SHADOW_ON
        : SHADOW_OFF
      lightingRef.current = lighting
      // Registro lo stato ombre con cui l'overlay nasce: l'effect di ricreazione
      // confronta con questo per ricreare SOLO ai cambi reali del toggle.
      shadowsAppliedRef.current = shadows0

      // Layer deck inizialmente VUOTI: vengono popolati dal toggle effect al
      // primo 'idle' (overlayReady), cosi' compilano DOPO che l'effetto ombre
      // ha registrato il suo modulo shader -> niente tetti mancanti.
      // interleaved:true = deck.gl disegna DENTRO il contesto GL di MapLibre,
      // usando la SUA camera (che include la quota del terreno al centro vista)
      // e il SUO depth buffer. Cosi':
      //  - gli edifici/alberi non "galleggiano" piu' (in non-interleaved deck
      //    ignorava il terreno e tutto appariva sollevato di ~quota centro);
      //  - il terreno OCCLUDE cio' che gli sta dietro (case dietro le colline).
      const overlay = new MapboxOverlay({
        interleaved: true,
        effects: [lighting],
        layers: [],
      })
      map.addControl(overlay as unknown as maplibregl.IControl)
      overlayRef.current = overlay
      map.once('idle', () => {
        overlayReadyRef.current = true
        setOverlayReady(true)
      })

      // Centro vista per la dissolvenza edifici: iniziale + a ogni 'moveend'
      // (a fine spostamento, non per-frame). Ricolora i layer edifici/tetti.
      const updateFadeCenter = () => {
        const c = map.getCenter()
        setFadeCenter({ lon: c.lng, lat: c.lat })
      }
      updateFadeCenter()
      map.on('moveend', updateFadeCenter)

      const sun0 = getSunPosition(currentTime, AOI_CENTER[1], AOI_CENTER[0])
      map.setLight(toMapLibreLight(sun0))
      map.setSky(computeSky(sun0.altitudeDeg))

      map.on('click', (e) => {
        // MODALITA' INSERIMENTO: se un tool e' attivo, il clic POSA un oggetto
        // (e non apre popup/probe). La z e' la quota del terreno sotto il clic,
        // cosi' l'oggetto poggia sul rilievo come alberi/arredo.
        const tool = insertToolRef.current
        if (tool) {
          const qe = (
            map as unknown as {
              queryTerrainElevation?: (
                ll: maplibregl.LngLatLike,
              ) => number | null
            }
          ).queryTerrainElevation
          const z = (qe ? qe.call(map, e.lngLat) : 0) ?? 0
          const lon = e.lngLat.lng, lat = e.lngLat.lat
          let fresh: { kind: PlaceKind; position: [number, number, number]; heading: number }[]
          if (!tool.line) {
            fresh = [{ kind: tool.kind, position: [lon, lat, z], heading: 0 }]
          } else {
            const start = lineStartRef.current
            if (!start) {
              setLineStart([lon, lat, z])
              return
            }
            fresh = lineBetween(start, [lon, lat, z], tool.spacing, tool.kind)
            setLineStart(null)
          }
          const withIds = fresh.map((o) => ({
            id: placedIdRef.current++,
            ...o,
          }))
          setPlaced((prev) => [...prev, ...withIds])
          return
        }
        // Nessun tool attivo: se clicco un OGGETTO INSERITO dall'utente lo
        // SELEZIONO (per ruotarlo/eliminarlo) e non apro popup/probe.
        const ovPlaced = overlayRef.current as unknown as {
          pickObject?: (p: {
            x: number
            y: number
            radius?: number
            layerIds?: string[]
          }) => { object?: PlacedObject } | null
        } | null
        const pickedPlaced = ovPlaced?.pickObject?.({
          x: e.point.x,
          y: e.point.y,
          radius: 6,
          layerIds: PLACED_LAYER_IDS,
        })
        if (pickedPlaced && pickedPlaced.object) {
          setSelectedPlaced(pickedPlaced.object.id)
          setSelectedTree(null)
          setSelectedArredo(null)
          setProbe(null)
          return
        }
        setSelectedPlaced(null)
        // Prima controllo se ho cliccato un albero (layer deck.gl pickable):
        // in tal caso mostro il popup info dell'albero e NON apro il probe
        // microclima. radius 6px per agganciare anche i tronchi sottili.
        const ov = overlayRef.current as unknown as {
          pickObject?: (p: {
            x: number
            y: number
            radius?: number
            layerIds?: string[]
          }) => { object?: TreePoint } | null
        } | null
        const picked = ov?.pickObject?.({
          x: e.point.x,
          y: e.point.y,
          radius: 6,
          layerIds: [
            'trees-canopy-broadleaf',
            'trees-canopy-conifer',
            'trees-trunk',
          ],
        })
        if (picked && picked.object) {
          const tp = picked.object
          setSelectedTree({
            lon: tp.position[0],
            lat: tp.position[1],
            z: tp.position[2] ?? 0,
            props: tp.props,
          })
          setSelectedArredo(null)
          setProbe(null)
          return
        }
        // Poi controllo l'arredo urbano (panchine/cestini/...): popup info.
        const pickedArr = (
          ov as unknown as {
            pickObject?: (p: {
              x: number
              y: number
              radius?: number
              layerIds?: string[]
            }) => { object?: ArredoFeature } | null
          } | null
        )?.pickObject?.({
          x: e.point.x,
          y: e.point.y,
          radius: 5,
          layerIds: [
            'arredo-bench',
            'arredo-bin',
            'arredo-fountain',
            'arredo-railing',
            'arredo-post',
          ],
        })
        if (pickedArr && pickedArr.object) {
          const a = pickedArr.object
          const [lon, lat] = a.geometry.coordinates
          setSelectedArredo({ lon, lat, props: a.properties ?? null })
          setSelectedTree(null)
          setProbe(null)
          return
        }
        // Click sul vuoto/edificio: i valori (vento / microclima) sono derivati
        // in un effect dai layer attivi, qui registro solo il punto. In piu',
        // se ho cliccato un edificio, leggo la sua MRT pedonale (la temperatura
        // percepita che lo colora) cosi' il pannello la mostra esatta, anche
        // dove il raster non campiona bene.
        const pb = ov?.pickObject?.({
          x: e.point.x,
          y: e.point.y,
          radius: 2,
          layerIds: ['buildings-shadow'],
        }) as unknown as
          | { object?: { properties?: { mrt_col?: MrtCol } } }
          | null
        const at = pedestrianMrt(pb?.object?.properties?.mrt_col)
        probeBuildingTempRef.current = typeof at === 'number' ? at : null
        setSelectedTree(null)
        setSelectedArredo(null)
        setProbe({ lat: e.lngLat.lat, lon: e.lngLat.lng })
      })

      // Rumore: hover su una strada -> tooltip con i dB. (L'hiss Web Audio
      // proporzionale ai dB è stato RIMOSSO il 17/08/2026: partiva all'hover
      // fuori da ogni toggle e infastidiva.)
      map.on('mousemove', 'noise', (e) => {
        const f = e.features?.[0]
        if (!f) return
        const db = Number((f.properties as { noise_db?: number }).noise_db)
        map.getCanvas().style.cursor = 'crosshair'
        if (!noiseTipRef.current) {
          noiseTipRef.current = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 8,
          })
        }
        noiseTipRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font:600 12px ui-monospace,monospace;color:#111;">${db} dB</div>`,
          )
          .addTo(map)
      })
      map.on('mouseleave', 'noise', () => {
        map.getCanvas().style.cursor = ''
        noiseTipRef.current?.remove()
      })

      const syncBearing = () => setBearing(map.getBearing())
      map.on('rotate', syncBearing)
      map.on('moveend', syncBearing)
      syncBearing()

      // NB: il loader NON si chiude qui (map 'load' = solo stile pronto). Si
      // chiude quando gli edifici 3D sono caricati (effect dedicato sotto),
      // cosi' la scena appare gia' completa. Qui segnalo solo la tappa "stile".
      setMapLoaded(true)
    })

    mapRef.current = map

    return () => {
      noiseTipRef.current?.remove()
      noiseTipRef.current = null
      treePopupRef.current?.remove()
      treePopupRef.current = null
      arredoPopupRef.current?.remove()
      arredoPopupRef.current = null
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Aggiorna la luce MapLibre + cielo quando cambia currentTime. Gli effetti
  // deck.gl (sole + ombre) vengono settati INSIEME ai layer nel toggle effect
  // sotto: cosi' un singolo setProps aggiorna effetti e layer in un colpo solo
  // (settarli separati lasciava gli edifici non ridisegnati spegnendo le ombre).
  useEffect(() => {
    currentTimeRef.current = currentTime
    const map = mapRef.current
    if (!map) return
    const sun = getSunPosition(currentTime, AOI_CENTER[1], AOI_CENTER[0])
    if (map.isStyleLoaded()) {
      map.setLight(toMapLibreLight(sun))
      map.setSky(computeSky(sun.altitudeDeg))
    }
  }, [currentTime])


  // (L'overlay microclima è una SimpleMeshLayer deck che segue il terreno —
  // vedi envSheet / buildEnvSheetMesh; l'effect che ripuliva i residui della
  // vecchia sorgente raster MapLibre è stato rimosso con la sorgente stessa.)

  // Toggle layer + propagazione dati alberi/altezze quando cambiano.
  // Ricrea l'overlay deck al cambio del toggle "Ombre". Con interleaved NON si
  // puo' cambiare _shadow a runtime sullo stesso overlay (ricompila il modulo
  // ombre e fa sparire edifici/tetti); l'unico modo pulito e' creare un overlay
  // NUOVO con _shadow gia' giusto. I layer vengono ripopolati dall'effect sotto
  // dopo il prossimo 'idle' (quando overlayReadyRef torna true). Deve stare
  // PRIMA dell'effect di popolamento cosi' gira per primo nello stesso render.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !overlayRef.current || shadowsAppliedRef.current === null) return
    const shadowsOn = !!visibility['shadows']
    if (shadowsAppliedRef.current === shadowsOn) return // ombre invariate
    shadowsAppliedRef.current = shadowsOn

    // Blocco SUBITO il popolamento (ref sincrono) finche' il nuovo overlay non
    // ha fatto il suo 'idle': evito di disegnare su shader non pronti.
    overlayReadyRef.current = false
    setOverlayReady(false)

    try {
      map.removeControl(overlayRef.current as unknown as maplibregl.IControl)
    } catch {
      /* gia' rimosso */
    }
    const lighting = new LightingEffect(
      sunAmbientFor(currentTimeRef.current.getTime(), shadowsOn),
    )
    ;(lighting as unknown as { shadowColor: number[] }).shadowColor = shadowsOn
      ? SHADOW_ON
      : SHADOW_OFF
    lightingRef.current = lighting
    const overlay = new MapboxOverlay({
      interleaved: true,
      effects: [lighting],
      layers: [],
    })
    map.addControl(overlay as unknown as maplibregl.IControl)
    overlayRef.current = overlay
    map.once('idle', () => {
      overlayReadyRef.current = true
      setOverlayReady(true)
    })
  }, [visibility])

  useEffect(() => {
    const map = mapRef.current
    const overlay = overlayRef.current
    if (!map) return
    const apply = () => {
      const maplibre3d = visibility['buildings-3d'] ? 'visible' : 'none'
      // (L'overlay env e' la sorgente immagine 'env-overlay', gestita a parte.)
      for (const id of [
        'green-areas',
        'private-green',
        'noise',
      ] as LayerKey[]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(
            id,
            'visibility',
            visibility[id] ? 'visible' : 'none',
          )
        }
      }
      // (Le stazioni qualita' aria sono marker DOM, gestite a parte.)
      if (map.getLayer('osm-buildings-context')) {
        map.setLayoutProperty('osm-buildings-context', 'visibility', maplibre3d)
      }
      if (overlay && overlayReadyRef.current) {
        // Se 'buildings-temp' e' attivo, coloro ogni edificio per la sua MRT
        // pedonale (temperatura percepita ~1.5 m, campionata da ENVI-met dalla
        // pipeline in mrt_col) normalizzata sui percentili 5-95 degli edifici
        // stessi (vedi mrtBuildingsRange). Spaziale: edifici dentro al dominio
        // ENVI-met colorati giallo->rosso, gli altri grigi.
        const mrtRange = mrtBuildingsRange
        // Luce: aggiorno sole/ambient con l'ora. castShadows = stato del toggle
        // "Ombre" (l'overlay e' stato creato/ricreato con _shadow coerente, vedi
        // effect "ricrea overlay al cambio ombre"), quindi nessuna ricompilazione.
        if (lightingRef.current) {
          applyLighting(
            lightingRef.current,
            currentTime.getTime(),
            !!visibility['shadows'],
          )
        }
        // Dissolvenza edifici lontani (null finche' non conosco il centro vista).
        const fade: FadeCfg | null = fadeCenter
          ? {
              lon: fadeCenter.lon,
              lat: fadeCenter.lat,
              near: BUILDINGS_FADE_NEAR_M,
              far: BUILDINGS_FADE_FAR_M,
            }
          : null
        // Layer STATICI (tutto tranne il "microclima vivo"): salvati in ref
        // cosi' il loop rAF dell'animazione li ricompone senza ricostruirli.
        const staticLayers = [
            buildShadowBuildingsLayer(
              // Mostro gli edifici estrusi se e' attivo il 3D OPPURE la
              // colorazione per temperatura (cosi' 'buildings-temp' funziona
              // anche da solo).
              visibility['buildings-3d'] || visibility['buildings-temp'],
              // Oggetto gia' parsato dal prefetch in streaming. Se il prefetch
              // e' fallito ripiega sull'URL (deck scarica). Altrimenti, finche'
              // sta ancora scaricando, null -> nessun layer (niente doppio
              // download); il loader copre comunque lo schermo.
              (buildingsData as object) ??
                (buildingsLoadFailed ? buildingsUrl : null),
              mrtRange,
              fade,
              () => setBuildingsReady(true),
            ),
            // (I tetti rossi sono ora tinti nello shader degli edifici stessi —
            // vedi RoofTopColorExtension — niente piu' layer di tetti separato.)
            // OVERLAY MICROCLIMA = foglio che SEGUE IL TERRENO: SimpleMeshLayer
            // con texture COLORATA NEL BROWSER dalla slice del cubo GeoTIFF
            // (lib/envimetColor, niente più PNG precotti); la mesh è una griglia
            // con OGNI vertice a `quota_terreno_reale + z_banda` (vedi envSheet /
            // buildEnvSheetMesh). Depth test NORMALE: gli edifici lo occludono
            // (niente raggi-X "sopra le case") e, essendo sempre ~z sopra il
            // suolo, il terreno non lo "buca" più (niente zone vuote a 1.5/4.5 m).
            envSheet && envSlice
              ? new SimpleMeshLayer({
                  id: 'env-sheet',
                  data: ENV_SHEET_DATA,
                  mesh: envSheet.mesh,
                  texture: envSlice.image,
                  getPosition: () => envSheet.anchor,
                  getColor: [255, 255, 255, 255],
                  // Col "vivo" acceso il foglio si attenua: il fumo del caldo
                  // deve essere il protagonista, non annegare nell'arancione.
                  opacity: liveOn ? 0.3 : 0.85,
                  material: false, // niente luce: i colori del dato restano fedeli
                  pickable: false,
                  parameters: { depthCompare: 'less-equal' },
                })
              : null,
            // Pallino PIATTO del punto cliccato, ANCORATO AL TERRENO (il marker
            // DOM sparisce quando c'è un foglio microclima). Resta fermo quando
            // lo slider quota solleva il foglio: il punto indica DOVE hai
            // cliccato, non la quota che stai guardando (prima saliva col
            // foglio e disorientava — richiesta utente 17/08/2026). depthTest
            // off = visibile anche attraverso il foglio.
            probe && envSlice
              ? new ScatterplotLayer<[number, number, number]>({
                  id: 'env-probe-dot',
                  data: [
                    [
                      probe.lon,
                      probe.lat,
                      // Quota terreno REALE al punto (+0.5 m anti z-fighting).
                      (envSheet
                        ? envSheet.elevAt(probe.lon, probe.lat)
                        : envSlice.groundAt(probe.lon, probe.lat)) + 0.5,
                    ],
                  ],
                  getPosition: (d) => d,
                  getFillColor: [18, 114, 183, 255],
                  getLineColor: [255, 255, 255, 255],
                  stroked: true,
                  lineWidthMinPixels: 2,
                  radiusUnits: 'meters',
                  getRadius: 3,
                  radiusMinPixels: 5,
                  radiusMaxPixels: 14,
                  billboard: false,
                  parameters: { depthCompare: 'always' },
                  pickable: false,
                })
              : null,
            ...treeLayers,
            ...arredoLayers,
            ...placedLayers,
            // Pallino del 1o punto in attesa per i tool a linea (filari/siepi).
            lineStart
              ? new ScatterplotLayer<[number, number, number]>({
                  id: 'insert-line-start',
                  data: [lineStart],
                  getPosition: (d) => d,
                  getFillColor: [255, 209, 102, 230],
                  getLineColor: [40, 40, 40, 255],
                  lineWidthMinPixels: 2,
                  stroked: true,
                  radiusUnits: 'pixels',
                  getRadius: 6,
                })
              : null,
            buildSelectedTreeLayer(selectedTree),
            // Anello arancione alla base dell'oggetto inserito selezionato.
            selectedPlacedObj
              ? new ScatterplotLayer<PlacedObject>({
                  id: 'placed-selected-ring',
                  data: [selectedPlacedObj],
                  getPosition: (d) => d.position,
                  stroked: true,
                  filled: false,
                  getLineColor: [245, 158, 11, 255],
                  getRadius: 1.4,
                  radiusUnits: 'meters',
                  radiusMinPixels: 16,
                  lineWidthUnits: 'pixels',
                  getLineWidth: 3,
                  lineWidthMinPixels: 3,
                  pickable: false,
                  parameters: { depthCompare: 'always' },
                })
              : null,
            buildQuartiereFlashLayer(quartieri, flashQuartiere, flashFading),
            buildQuartiereLabelsLayer(quartieri),
          ].filter(Boolean) as Layer[]
        staticLayersRef.current = staticLayers
        overlay.setProps({
          // Stessa istanza persistente: deck fa deepEqual e non la sostituisce
          // (le mutazioni sopra sono gia' attive); se invece il deck e' stato
          // ricreato — es. cambio basemap — la re-installa con i valori giusti.
          effects: lightingRef.current ? [lightingRef.current] : [],
          // I layer del "microclima vivo" (se accesi) vanno RIAPPESI anche qui,
          // altrimenti questo setProps li farebbe sparire fino al frame dopo.
          layers: [...staticLayers, ...liveLayersRef.current],
        })
        // Cambiare lo shadowColor (alpha 0/0.5) aggiorna un uniform ma non
        // ridisegna da solo: forzo un repaint cosi' l'on/off delle ombre si
        // vede subito, senza dover muovere la mappa.
        map.triggerRepaint()
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once('idle', apply)
  }, [
    visibility,
    treeLayers,
    arredoLayers,
    placedLayers,
    selectedPlacedObj,
    lineStart,
    selectedTree,
    quartieri,
    flashQuartiere,
    flashFading,
    overlayReady,
    buildingsUrl,
    buildingsData,
    buildingsLoadFailed,
    currentTime,
    fadeCenter,
    probe,
    envSlice,
    envSheet,
    mrtBuildingsRange,
    // envCubeTick: il range MRT degli edifici legge il cubo appena caricato.
    envCubeTick,
    // liveOn: il foglio microclima cambia opacita' quando il "vivo" e' acceso.
    liveOn,
  ])

  // (L'overlay microclima e' una SimpleMeshLayer che segue il terreno —
  // costruita nell'array layers sopra; lo slider quota cambia l'immagine e la
  // quota del foglio. Vedi envSheet / buildEnvSheetMesh.)

  // Basemap switcher: setStyle distrugge i source/layer custom, quindi dopo
  // 'style.load' ri-eseguo addCustomLayers (registrata in reapplyRef).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(BASEMAPS[basemap].style)
    map.once('style.load', () => {
      reapplyRef.current?.()
      // Sole + luce + cielo vengono persi nello swap, ricomputo
      // sull'ora corrente letta dal ref (potrebbe essere cambiata dopo
      // il mount).
      const now = currentTimeRef.current
      const sun = getSunPosition(now, AOI_CENTER[1], AOI_CENTER[0])
      map.setLight(toMapLibreLight(sun))
      map.setSky(computeSky(sun.altitudeDeg))
      // setStyle ricarica il background originale del basemap: ritingiamo
      // (verde campagna sul dark, salvia chiaro sul light). Vedi
      // `tintBasemapBackground`.
      tintBasemapBackground(map, basemap)
      // Sbianco le etichette SOLO sul basemap scuro; sul chiaro restano native.
      if (basemap === 'dark') whitenMapLabels(map)
      map.once('idle', () => raiseMapLabels(map))
    })
  }, [basemap])

  const resetNorth = () => {
    mapRef.current?.easeTo({ bearing: 0, duration: 600 })
  }

  // Quick-jump a una delle 6 zone (quartieri) di Bologna. Preserva
  // bearing e pitch correnti ("da dove sei adesso"), flyTo al centro
  // del quartiere con zoom esplicito 15 (piu' stretto del fitBounds
  // standard). Setta `selectedQuartiere` cosi' compare il badge
  // "Quartiere: X" sotto la search bar -- il blocco rosso pseudo-3D
  // e' stato rimosso dalla pipeline deck.gl, niente highlight 3D.
  // Bordo quartiere colorato: pieno per 4s, poi fade di 1s -> via a 5s.
  const triggerQuartiereFlash = (codQuar: number) => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    setFlashFading(false)
    setFlashQuartiere(codQuar)
    fadeTimerRef.current = setTimeout(() => setFlashFading(true), 4000)
    flashTimerRef.current = setTimeout(() => {
      setFlashQuartiere(null)
      setFlashFading(false)
    }, 5000)
  }

  // Inquadra l'INTERO quartiere col suo contorno (fitBounds sulla bbox, con
  // padding per le UI sopra/sotto), preservando un po' di 3D (pitch 35).
  const fitQuartiere = (bbox: [number, number, number, number]) => {
    const map = mapRef.current
    if (!map) return
    const [minlon, minlat, maxlon, maxlat] = bbox
    map.fitBounds(
      [
        [minlon, minlat],
        [maxlon, maxlat],
      ],
      {
        padding: { top: 96, bottom: 140, left: 70, right: 70 },
        pitch: 35,
        bearing: 0,
        duration: 1400,
        // linear:true => fitBounds usa easeTo (interpola DIRETTAMENTE centro e
        // zoom) invece di flyTo, che faceva la parabola "zoom-out fino a vedere
        // il centro citta', poi zoom-in sul quartiere". Ora va dritto al
        // quartiere. easing ease-in-out per partenza/arrivo morbidi.
        linear: true,
        easing: (t: number) =>
          t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
        essential: true,
      },
    )
  }

  const jumpToQuartiere = (f: QuartiereFeature) => {
    if (!mapRef.current) return
    fitQuartiere(f.properties.bbox)
    setSelectedQuartiere(f.properties.cod_quar)
    triggerQuartiereFlash(f.properties.cod_quar)
  }

  const jumpToCity = () => {
    const map = mapRef.current
    if (!map) return
    // Centro storico (AOI_CENTER) con zoom 14: vista interna alla citta',
    // non l'inquadratura larga di tutto il comune.
    map.flyTo({
      center: AOI_CENTER,
      zoom: 14,
      pitch: 55,
      bearing: 0,
      duration: 1400,
    })
    setSelectedQuartiere(null)
  }

  // 0 = pieno giorno, 1 = notte profonda. Usato per modulare l'overlay
  // scuro globale sul viewer (vedi `nightOverlayOpacity` sotto).
  const currentNightFactor = useMemo(() => {
    const sun = getSunPosition(currentTime, AOI_CENTER[1], AOI_CENTER[0])
    return nightFactor(sun.altitudeDeg)
  }, [currentTime])
  // Max 0.35 (prima 0.55): mantiene l'atmosfera notturna ma lascia ben visibili
  // gli edifici, che di notte sono illuminati dal solo ambient.
  const nightOverlayOpacity = currentNightFactor * 0.35

  // Match dei 6 quartieri di Bologna: case-insensitive sul nome, senza
  // accenti/punteggiatura (es. "S. Stefano" deve matchare "Santo Stefano").
  const matchQuartieri = (q: string): SearchResult[] => {
    if (!quartieri) return []
    const norm = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const nq = norm(q)
    if (!nq) return []
    return quartieri
      .filter((f) => norm(f.properties.quartiere).includes(nq))
      .map((f) => {
        const [minlon, minlat, maxlon, maxlat] = f.properties.bbox
        return {
          type: 'quartiere' as const,
          label: `Quartiere ${f.properties.quartiere}`,
          cod_quar: f.properties.cod_quar,
          bbox: f.properties.bbox,
          lon: (minlon + maxlon) / 2,
          lat: (minlat + maxlat) / 2,
        }
      })
  }

  // Geocoding via Nominatim (OSM), limitato alla bbox di Bologna. Nessuna
  // dipendenza extra: una fetch e flyTo sul risultato scelto. I 6 quartieri
  // (match client-side su `quartieri.geojson`) vengono mostrati in cima.
  const runSearch = async (e: FormEvent) => {
    e.preventDefault()
    const q = search.trim()
    if (!q) return
    setSearching(true)
    const quartieriHits = matchQuartieri(q)
    try {
      const addresses = await geocodeBologna(q, lang)
      setSearchResults([...quartieriHits, ...addresses])
    } catch {
      setSearchResults(quartieriHits)
    } finally {
      setSearching(false)
    }
  }

  const gotoResult = (res: SearchResult) => {
    const map = mapRef.current
    if (!map) return
    if (res.type === 'quartiere') {
      fitQuartiere(res.bbox)
      setSelectedQuartiere(res.cod_quar)
      triggerQuartiereFlash(res.cod_quar)
      searchMarkerRef.current?.remove()
      searchMarkerRef.current = null
    } else {
      map.flyTo({ center: [res.lon, res.lat], zoom: 16, duration: 1200 })
      searchMarkerRef.current?.remove()
      searchMarkerRef.current = new maplibregl.Marker({ color: '#1272b7' })
        .setLngLat([res.lon, res.lat])
        .addTo(map)
    }
    setSearchResults([])
    suppressSuggestRef.current = true
    setSearch(res.label.split(',')[0])
  }

  // Suggerimenti AS-YOU-TYPE: mentre si digita (min 3 caratteri) si interroga
  // Nominatim con debounce (~450 ms, rispetta il limite ~1 req/s) e si mostrano
  // i risultati nello stesso dropdown — quartieri in cima, poi indirizzi/vie.
  // Prima i suggerimenti comparivano solo premendo Invio/Cerca.
  useEffect(() => {
    if (suppressSuggestRef.current) {
      suppressSuggestRef.current = false
      return
    }
    const q = search.trim()
    const ctrl = new AbortController()
    // Debounce breve (Photon non ha il limite ~1 req/s di Nominatim) + abort
    // della richiesta precedente a ogni tasto -> suggerimenti reattivi. Anche
    // lo svuotamento (query troppo corta) passa dal timeout: niente setState
    // sincrono nel corpo dell'effect.
    const handle = setTimeout(
      async () => {
        if (q.length < 2) {
          setSearchResults([])
          return
        }
        const quartieriHits = matchQuartieri(q)
        try {
          const addresses = await geocodeBologna(q, lang, ctrl.signal)
          setSearchResults([...quartieriHits, ...addresses])
        } catch {
          if (!ctrl.signal.aborted) setSearchResults(quartieriHits)
        }
      },
      q.length < 2 ? 0 : 250,
    )
    return () => {
      ctrl.abort()
      clearTimeout(handle)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, quartieri, lang])

  // Composita TUTTE le canvas dentro il container (MapLibre sotto + deck.gl
  // sopra) su una canvas 2D e risolve un PNG blob. Cattura solo le canvas,
  // quindi i pannelli/filtri (DOM) non ci finiscono mai: l'immagine e' sempre
  // pulita. Forza un repaint e aspetta due frame per avere i buffer aggiornati.
  // Riusato sia dallo screenshot (download) sia dalla condivisione social.
  const composeSceneBlob = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const container = containerRef.current
      const map = mapRef.current
      if (!container || !map) return resolve(null)
      map.triggerRepaint()
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const base = map.getCanvas()
          const canvases = Array.from(
            container.querySelectorAll('canvas'),
          ) as HTMLCanvasElement[]
          if (canvases.length === 0) return resolve(null)
          const out = document.createElement('canvas')
          out.width = base.width
          out.height = base.height
          const ctx = out.getContext('2d')
          if (!ctx) return resolve(null)
          for (const c of canvases) {
            try {
              ctx.drawImage(c, 0, 0, out.width, out.height)
            } catch {
              // canvas cross-origin/non leggibile: la salto
            }
          }
          out.toBlob((blob) => resolve(blob), 'image/png')
        }),
      )
    })

  const screenshotName = () =>
    `urbanscope-bologna-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, '-')}.png`

  const takeScreenshot = async () => {
    const blob = await composeSceneBlob()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = screenshotName()
    a.click()
    URL.revokeObjectURL(url)
  }

  // Condivisione "social": preferisce il Web Share API con il FILE immagine
  // (su mobile apre lo share sheet nativo -> Instagram/WhatsApp/...). Se il
  // browser non sa condividere file, ripiega sulla condivisione dell'URL, e
  // infine (desktop senza share API) scarica il PNG e copia il link.
  const shareScene = async () => {
    const blob = await composeSceneBlob()
    if (!blob) return
    const file = new File([blob], screenshotName(), { type: 'image/png' })
    const text = t('shareText', lang)
    // Sempre il link di produzione (GitHub Pages), non il localhost di sviluppo.
    const url = SHARE_URL

    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean
    }
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ title: text, text, url, files: [file] })
        return
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return // l'utente ha annullato
      }
    }
    if (nav.share) {
      try {
        await nav.share({ title: text, text, url })
        return
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
      }
    }
    // Fallback desktop: scarica l'immagine (da postare a mano) + copia il link.
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = screenshotName()
    a.click()
    URL.revokeObjectURL(objUrl)
    try {
      await navigator.clipboard?.writeText(url)
      setShareToast(true)
      window.setTimeout(() => setShareToast(false), 2000)
    } catch {
      // clipboard non disponibile (http, permessi): l'immagine e' comunque scaricata
    }
  }

  // (Qui viveva il "paesaggio sonoro" — computeSoundMix + toggle + effect di
  //  aggiornamento del mix: rimosso il 17/08/2026 su richiesta. Il motore
  //  audio resta in lib/soundscape.ts come materiale di tesi.)

  // Frazione 0..1 del download edifici (byte realmente letti / stima), bloccata
  // a 0.99 finche' il parse non e' concluso (vedi BUILDINGS_BYTES_EST).
  const buildingsFrac = buildingsReady
    ? 1
    : Math.min(0.99, buildingsBytes / BUILDINGS_BYTES_EST)
  // Tappe REALI di caricamento. La barra non e' finta: la quota edifici (il
  // file dominante, ~32 MB) avanza in CONTINUO sui byte scaricati, non a scatti.
  const loadSteps = [
    {
      done: mapLoaded,
      label: lang === 'it' ? 'Stile mappa e terreno 3D' : 'Map style & 3D terrain',
      detail: 'basemap · terrain DEM (z11–14)',
    },
    {
      done: buildingsReady,
      label:
        (lang === 'it' ? 'Edifici 3D' : '3D buildings') +
        ` · ${Math.round(buildingsFrac * 100)}%`,
      detail: '/data/processed/buildings_heights.geojson (~32 MB)',
    },
  ]
  const loadDone = loadSteps.filter((s) => s.done).length
  // Avanzamento pesato: stile/terreno 12%, edifici 88% (la parte lunga e
  // continua). Cosi' la barra riflette quanto manca davvero in base ai file.
  const loadProgress = Math.round(
    ((mapLoaded ? 0.12 : 0) + 0.88 * buildingsFrac) * 100,
  )

  return (
    <div className="relative w-full h-full">
      {loading && (
        // z-[100] + sfondo OPACO = copre mappa, menu e ogni pannello UI: durante
        // il caricamento si vede SOLO il loader (titolo, barra, lista dataset).
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-talea-panel gap-6 px-8">
          <p className="text-talea-400 text-2xl font-black uppercase tracking-[0.3em]">
            UrbanScope3D
          </p>
          <div className="w-80 max-w-[88vw] flex flex-col gap-3">
            <div className="h-2 bg-talea-panel-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-talea-400 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.max(4, loadProgress)}%` }}
              />
            </div>
            <p className="text-talea-300 tracking-widest text-xs font-mono uppercase">
              {t('loading', lang)} · {loadDone}/{loadSteps.length} · {loadProgress}%
            </p>
            <ul className="flex flex-col gap-2 mt-1">
              {loadSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs font-mono">
                  <span className="mt-0.5 w-4 flex-shrink-0 flex justify-center">
                    {s.done ? (
                      <span className="text-talea-400">✓</span>
                    ) : (
                      <span className="inline-block w-3 h-3 border-2 border-talea-400/25 border-t-talea-400 rounded-full animate-spin" />
                    )}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className={s.done ? 'text-talea-300' : 'text-[#5a7a67]'}>
                      {s.label}
                    </span>
                    <span className="text-[#7a9a87] text-[10px] break-all leading-tight">
                      {s.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      {/* Overlay scuro "buio" notturno: opacita' proporzionale a quanto
          il sole e' sotto orizzonte. Non blocca i click (pointer-events
          none); sta sopra map/deck.gl ma sotto i pannelli UI. NIENTE
          transition: trascinare il TimeSlider causava un repaint a ogni
          frame con costo proporzionale all'area dello schermo. */}
      <div
        className="absolute inset-0 pointer-events-none z-[5]"
        style={{
          backgroundColor: 'rgb(2, 6, 23)',
          opacity: nightOverlayOpacity,
        }}
      />

      {/* Tutti i pannelli/filtri: nascosti in "vista pulita" (uiHidden). */}
      {!uiHidden && (
        <>
      {/* Search bar sticky, sempre visibile in alto. A sinistra della ricerca
          il menu basemap APRIBILE (pulsante + dropdown). */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-start gap-2">
        {/* Basemap: pulsante che apre/chiude il menu stili mappa. */}
        <div className="relative shrink-0" data-help="basemap">
          <button
            type="button"
            onClick={() => setBasemapOpen((o) => !o)}
            title={t('basemap', lang)}
            aria-label={t('basemap', lang)}
            aria-expanded={basemapOpen}
            className={`h-[42px] w-[42px] flex items-center justify-center rounded border backdrop-blur-sm shadow-xl transition-colors ${
              basemapOpen
                ? 'bg-talea-400/20 border-talea-400/50 text-talea-300'
                : 'bg-talea-panel/90 border-talea-400/30 text-talea-400/80 hover:text-talea-300'
            }`}
          >
            <span className="text-base">🗺</span>
          </button>
          {basemapOpen && (
            <div className="absolute top-full mt-1 left-0 w-44 bg-talea-panel/95 border border-talea-400/30 rounded p-1.5 backdrop-blur-sm shadow-xl">
              <div className="text-talea-400 text-[10px] font-mono uppercase tracking-widest mb-1.5 px-1">
                {t('basemap', lang)}
              </div>
              <div className="flex flex-col gap-1">
                {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
                  <button
                    key={id}
                    onClick={() => {
                      setBasemap(id)
                      setBasemapOpen(false)
                    }}
                    className={`text-left text-xs font-mono px-2 py-1 rounded transition-colors ${
                      basemap === id
                        ? 'bg-talea-400/20 text-talea-300 border border-talea-400/50'
                        : 'text-talea-300 hover:text-talea-300 hover:bg-talea-400/10 border border-transparent'
                    }`}
                  >
                    {BASEMAPS[id].label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Colonna ricerca: form + risultati + chip quartiere. */}
        <div className="w-[min(420px,80vw)]">
        <form
          onSubmit={runSearch}
          data-help="search"
          className="flex items-center gap-2 bg-talea-panel/90 border border-talea-400/30 rounded px-3 py-2 backdrop-blur-sm shadow-xl"
        >
          <span className="text-talea-400/70 text-sm">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder', lang)}
            className="flex-1 bg-transparent text-sm text-talea-100 placeholder:text-[#7a9a87] outline-none font-mono"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setSearchResults([])
                searchMarkerRef.current?.remove()
                searchMarkerRef.current = null
              }}
              className="text-[#7a9a87] hover:text-talea-300 text-sm"
              aria-label={t('clearSearch', lang)}
            >
              ✕
            </button>
          )}
          <button
            type="submit"
            disabled={searching}
            className="text-talea-300 hover:text-talea-200 text-xs font-mono uppercase tracking-wider disabled:text-[#7a9a87]"
          >
            {searching ? '...' : t('go', lang)}
          </button>
        </form>
        {searchResults.length > 0 && (
          <ul className="mt-1 bg-talea-panel/95 border border-talea-400/30 rounded backdrop-blur-sm shadow-xl overflow-hidden">
            {searchResults.map((res, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => gotoResult(res)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-talea-400/10 hover:text-talea-200 transition-colors border-b border-talea-400/10 last:border-0 ${
                    res.type === 'quartiere'
                      ? 'text-talea-300 font-mono'
                      : 'text-talea-200'
                  }`}
                >
                  {res.type === 'quartiere' ? '▣ ' : ''}
                  {res.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selectedQuartiere != null && quartieri && (
          <div className="mt-1 flex items-center justify-between bg-talea-400/15 border border-talea-400/40 rounded px-3 py-1.5 text-xs font-mono text-talea-200 backdrop-blur-sm">
            <span>
              ▣ {t('quartierePrefix', lang)}:{' '}
              <b>
                {
                  quartieri.find(
                    (f) => f.properties.cod_quar === selectedQuartiere,
                  )?.properties.quartiere
                }
              </b>
            </span>
            <button
              type="button"
              onClick={() => setSelectedQuartiere(null)}
              className="text-talea-300 hover:text-talea-100 ml-2"
              aria-label={t('deselectQuartiere', lang)}
            >
              ✕
            </button>
          </div>
        )}
        </div>
      </div>

      {/* Bussola: il quadrante ruota con il bearing, click = riallinea a Nord.
          Ingrandita rispetto a prima (era w-12 h-12). 'O' (ovest) in IT,
          'W' in EN. */}
      <button
        type="button"
        onClick={resetNorth}
        data-help="compass"
        title={t('resetNorth', lang)}
        className="absolute top-4 right-2 sm:right-4 z-10 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-talea-panel/85 border border-talea-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center hover:border-talea-400/60 transition-colors"
      >
        <div
          className="relative w-12 h-12"
          style={{ transform: `rotate(${-bearing}deg)` }}
        >
          <span className="absolute top-0 left-1/2 -translate-x-1/2 text-sm font-bold text-red-400 leading-none">
            N
          </span>
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs font-mono text-talea-300 leading-none">
            S
          </span>
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-xs font-mono text-talea-300 leading-none">
            {lang === 'it' ? 'O' : 'W'}
          </span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 text-xs font-mono text-talea-300 leading-none">
            E
          </span>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-5 bg-gradient-to-b from-red-400 to-gray-500 rounded" />
        </div>
      </button>

      {/* Toggle pannello Zone, a fianco (destra) della barra di ricerca. Il
          gruppo centrato e' [bottone basemap 42px + gap 8px + colonna ricerca
          min(420px,80vw)]: il suo bordo destro sta a
          50% + min(210px,40vw) + 25px (la meta' di bottone+gap). Il vecchio
          calc ometteva quei 25px e il toggle finiva ATTACCATO alla barra. */}
      {quartieri && (
        <button
          type="button"
          onClick={() => setZonePanelOpen((v) => !v)}
          title={zonePanelOpen ? t('hideZones', lang) : t('showZones', lang)}
          style={{ left: 'calc(50% + min(210px, 40vw) + 25px + 0.75rem)' }}
          className="absolute top-4 z-20 px-2.5 py-2 rounded bg-talea-panel/90 border border-talea-400/30 backdrop-blur-sm shadow-xl text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors text-[11px] font-mono uppercase tracking-widest flex items-center gap-1.5"
          aria-label="Toggle zone panel"
        >
          <span
            className="inline-block transition-transform duration-200"
            style={{
              transform: zonePanelOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            ▸
          </span>
          {t('zone', lang)}
        </button>
      )}

      {/* Pannello Zone (collassabile), sotto il toggle accanto alla search. */}
      {quartieri && zonePanelOpen && (
        <div
          style={{ left: 'calc(50% + min(210px, 40vw) + 25px + 0.75rem)' }}
          className="absolute top-16 z-10 bg-talea-panel/85 border border-talea-400/30 rounded p-1.5 sm:p-2 backdrop-blur-sm shadow-xl max-w-[60vw] sm:max-w-[200px]"
        >
          <div className="flex flex-col gap-1">
            {/* Voce "Bologna": inquadra l'intera citta' (unione dei quartieri). */}
            <button
              onClick={jumpToCity}
              className="text-left text-xs font-mono px-2 py-1 rounded transition-colors truncate text-talea-300 font-bold hover:text-talea-100 hover:bg-talea-400/10 border-b border-talea-400/20 mb-0.5"
              title="Bologna (intera città)"
            >
              ▣ Bologna
            </button>
            {quartieri.map((f) => (
              <button
                key={f.properties.cod_quar}
                onClick={() => jumpToQuartiere(f)}
                className="text-left text-xs font-mono px-2 py-1 rounded transition-colors truncate text-talea-300 hover:text-talea-300 hover:bg-talea-400/10 border border-transparent"
                title={f.properties.quartiere}
              >
                {f.properties.quartiere}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* (Il toggle del pannello "Cosa vedere" è stato unito alla toolbar in alto
          a sinistra insieme al bottone "Arredi urbani": vedi l'IIFE piu' sotto.) */}

      <div
        className={`absolute top-32 sm:top-32 left-2 sm:left-4 z-10 bg-talea-panel/85 border border-talea-400/30 rounded p-2 sm:p-3 backdrop-blur-sm shadow-xl ${
          layerPanelOpen ? '' : 'hidden'
        }`}
      >
        {/* Cap d'altezza: i pulsanti in basso a sinistra ora sono una RIGA
            orizzontale bassa (~3rem), quindi al pannello basta lasciare poco
            spazio sotto -> molto piu' alto di prima e niente sovrapposizione. */}
        <div className="flex flex-col gap-1 min-w-[160px] sm:min-w-[220px] max-h-[calc(100vh-13rem)] overflow-y-auto">
          {CATEGORIES.map((cat) => {
            const isCollapsed = collapsed[cat.key]
            const collapseBtn = (active: number, total: number) => (
              <button
                type="button"
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [cat.key]: !c[cat.key] }))
                }
                className="w-full flex items-center justify-between text-left text-[11px] font-mono uppercase tracking-wider text-talea-300/90 hover:text-talea-200 py-1"
              >
                <span className="flex items-center gap-1.5">
                  <span className="text-talea-400/70 w-3 inline-block">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  {t(cat.labelKey, lang)}
                </span>
                <span className="text-[#7a9a87] text-[10px]">
                  {active}/{total}
                </span>
              </button>
            )

            // MICROCLIMA: lista dal REGISTRY statico (lib/envimetRegistry),
            // uno alla volta (radio). Per i cittadini mostriamo SOLO gli 8 dati
            // curati; le variabili tecniche stanno in un sotto-gruppo "Dati
            // tecnici" a scomparsa (chiuso di default), cosi' la lista resta
            // corta e chiara. Al toggle parte download+decodifica del GeoTIFF
            // nel browser: la percentuale accanto alla voce e' il progresso.
            if (cat.key === 'microclima') {
              const ovs = ENV_OVERLAYS
              const curatedOvs = ovs.filter((o) => o.curated)
              // Dati tecnici nascosti di default (SHOW_TECHNICAL_ENVIMET): il
              // cittadino vede solo i curati. Per riattivarli vedi la costante.
              const techOvs = SHOW_TECHNICAL_ENVIMET
                ? ovs.filter((o) => !o.curated)
                : []
              // Totale mostrato all'utente = curati (+ tecnici se riattivati).
              const shownOvs = [...curatedOvs, ...techOvs]
              const active = shownOvs.filter((o) => envVisible[o.key]).length
              const techActive = techOvs.filter((o) => envVisible[o.key]).length
              const ovRow = (o: EnvimetVarDef, dim = false) => {
                const st = envLoading[o.key]
                return (
                  <label
                    key={o.key}
                    className={`flex items-center gap-2 text-sm cursor-pointer hover:text-talea-300 ${
                      dim ? 'text-[#5a7a67]' : 'text-talea-200'
                    }`}
                    title={dim ? 'Dato tecnico ENVI-met' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={!!envVisible[o.key]}
                      onChange={(e) => selectEnv(o.key, e.target.checked)}
                      className="accent-talea-400 cursor-pointer"
                    />
                    <span>{envLabel(o, lang)}</span>
                    {/* Avanzamento download/decodifica del GeoTIFF nel browser. */}
                    {st === 'error' ? (
                      <span
                        className="text-red-400/80 text-[10px] font-mono"
                        title={
                          lang === 'it'
                            ? 'Dato non disponibile (file .tif assente)'
                            : 'Data unavailable (missing .tif file)'
                        }
                      >
                        !
                      </span>
                    ) : st && envVisible[o.key] ? (
                      <span className="text-talea-300/70 text-[10px] font-mono tabular-nums">
                        {st.total > 0
                          ? `${Math.min(99, Math.round((st.loaded / st.total) * 100))}%`
                          : '…'}
                      </span>
                    ) : null}
                  </label>
                )
              }
              return (
                <div key={cat.key} className="border-b border-talea-400/10 last:border-0 pb-1 mb-0.5">
                  {collapseBtn(active, shownOvs.length)}
                  {!isCollapsed && (
                    <div className="flex flex-col gap-1.5 pl-4 pt-1 pb-1">
                      {ovs.length === 0 && (
                        <span className="text-[#7a9a87] text-[11px] font-mono">
                          {lang === 'it' ? 'nessun dato' : 'no data'}
                        </span>
                      )}
                      {/* MICROCLIMA VIVO: i dati si muovono e si vedono INSIEME
                          (scie di vento + fiamme di caldo + foschia di umidita',
                          sopra l'overlay di base scelto). Motore client-side:
                          vedi lib/microlive.ts. */}
                      {ovs.length > 0 && (
                        <>
                          <label className="flex items-center gap-2 text-sm cursor-pointer hover:text-talea-300 text-talea-200 font-medium">
                            <input
                              type="checkbox"
                              checked={liveOn}
                              onChange={(e) => {
                                setLiveOn(e.target.checked)
                                if (e.target.checked) {
                                  // Base di default: temperatura, se non c'e'
                                  // gia' un dato acceso su cui animare.
                                  if (!ovs.some((o) => envVisible[o.key]))
                                    selectEnv('temperature', true)
                                  else flyToEnvDomain()
                                }
                              }}
                              className="accent-talea-400 cursor-pointer"
                            />
                            <span>
                              ✨{' '}
                              {lang === 'it'
                                ? 'Microclima vivo (animato)'
                                : 'Living microclimate (animated)'}
                            </span>
                          </label>
                          {liveOn && (
                            <div className="pl-6 -mt-0.5 text-[10px] leading-4 text-[#7a9a87] font-mono">
                              <span className="text-sky-300">〜</span>{' '}
                              {lang === 'it' ? 'scie = vento' : 'trails = wind'}
                              {' · '}
                              <span className="text-orange-400">●</span>{' '}
                              {lang === 'it'
                                ? 'fiamme = caldo percepito'
                                : 'flames = perceived heat'}
                              {' · '}
                              <span className="text-sky-200">○</span>{' '}
                              {lang === 'it'
                                ? 'foschia = umidità'
                                : 'mist = humidity'}
                            </div>
                          )}
                        </>
                      )}
                      {curatedOvs.map((o) => ovRow(o))}
                      {/* "Temperatura degli edifici": colora gli edifici per
                          temperatura percepita (MRT) ENVI-met. Vive QUI nel
                          microclima (non e' un overlay drappeggiato ma un
                          toggle `visibility`), reso a mano come riga dedicata. */}
                      <label
                        className="flex items-center gap-2 text-sm cursor-pointer hover:text-talea-300 text-talea-200"
                        title="ENVI-met"
                      >
                        <input
                          type="checkbox"
                          checked={visibility['buildings-temp']}
                          onChange={(e) => {
                            setVisibility((v) => ({
                              ...v,
                              'buildings-temp': e.target.checked,
                            }))
                            if (e.target.checked) flyToEnvDomain()
                          }}
                          className="accent-talea-400 cursor-pointer"
                        />
                        <span>{t('layer_buildings_temp', lang)}</span>
                      </label>
                      {techOvs.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setTechOpen((v) => !v)}
                            className="w-full flex items-center justify-between text-left text-[11px] font-mono uppercase tracking-wider text-talea-300/80 hover:text-talea-200 mt-1 border-t border-talea-400/10 pt-1.5"
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="text-talea-400/70 w-3 inline-block">
                                {techOpen ? '▾' : '▸'}
                              </span>
                              {lang === 'it' ? 'Dati tecnici' : 'Technical data'}
                            </span>
                            <span className="text-[#7a9a87] text-[10px]">
                              {techActive > 0 ? `${techActive} on` : techOvs.length}
                            </span>
                          </button>
                          {techOpen && (
                            <div className="flex flex-col gap-1.5 pt-1 max-h-[28vh] overflow-y-auto">
                              {techOvs.map((o) => ovRow(o, true))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            }

            const items = LAYERS.filter((l) => l.category === cat.key)
            if (items.length === 0) return null
            const activeCount = items.filter((l) => visibility[l.id]).length
            return (
              <div key={cat.key} className="border-b border-talea-400/10 last:border-0 pb-1 mb-0.5">
                {collapseBtn(activeCount, items.length)}
                {!isCollapsed && (
                  <div className="flex flex-col gap-1.5 pl-4 pt-1 pb-1">
                    {items.map((l) => {
                      const disabled =
                        (l.id === 'air-stations' && !airStations) ||
                        (l.id === 'shadows' && !visibility['buildings-3d'])
                      const label = l.rawLabel ?? (l.labelKey ? t(l.labelKey, lang) : l.id)
                      return (
                        <label
                          key={l.id}
                          className={`flex items-center gap-2 text-sm transition-colors ${
                            disabled
                              ? 'text-[#7a9a87] cursor-not-allowed'
                              : 'text-talea-200 cursor-pointer hover:text-talea-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={visibility[l.id]}
                            onChange={(e) => {
                              setVisibility((v) => ({
                                ...v,
                                [l.id]: e.target.checked,
                              }))
                              // "Edifici → temperatura" è un dato ENVI-met:
                              // porta la camera sul dominio come per gli overlay.
                              if (l.id === 'buildings-temp' && e.target.checked)
                                flyToEnvDomain()
                            }}
                            className="accent-talea-400 cursor-pointer disabled:cursor-not-allowed"
                          />
                          <span>{label}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Slider ALTEZZA per gli overlay microclima 3D: appare quando e' attivo
          un overlay con dimensione verticale e il suo cubo e' caricato.
          Verticale (in alto = piu' in alto). Col cubo GeoTIFF in memoria sono
          selezionabili TUTTE le 54 quote (0.3 -> 148.5 m), non piu' solo le 9
          con un PNG precotto: "vedi il dato a 1,5 m fino sopra i tetti". */}
      {(() => {
        const ov = ENV_OVERLAYS.find(
          (o) => envVisible[o.key] && o.agg === 'band',
        )
        const cube = ov ? getCubeSync(ov.key) : null
        if (!ov || !cube) return null
        const idx = Math.min(envHeightBand, cube.nz - 1)
        const zLabel = (b: number) => Math.round(cube.zM[b] * 10) / 10
        return (
          // A DESTRA (centrata in verticale), ma su desktop SPOSTATA a
          // sinistra della colonna InfoPanel/legenda (larga 260px a right-4):
          // prima stava sopra ai pannelli e li copriva a metà altezza.
          <div className="absolute right-2 sm:right-[calc(min(260px,100vw-1rem)+1.5rem)] top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1.5 bg-talea-panel/85 border border-talea-400/30 rounded p-2 backdrop-blur-sm shadow-xl" data-help="height">
            <div className="text-talea-400 text-[10px] font-mono uppercase tracking-widest">
              {lang === 'it' ? 'Quota' : 'Height'}
            </div>
            {/* Quota corrente in SOLA LETTURA: il valore si cambia SOLO muovendo
                lo slider (niente input digitabile/freccette, che confondevano —
                richiesta utente). Mostra la quota della banda agganciata. */}
            <div className="flex items-baseline gap-1">
              <span className="text-talea-100 text-base font-mono font-bold tabular-nums">
                {zLabel(idx)}
              </span>
              <span className="text-talea-300 text-[10px] font-mono">m</span>
            </div>
            {/* Slider per INDICE di banda (1 tacca = 1 quota), NON proporzionale
                ai metri: la griglia z e' telescopica (fitta sotto, rada sopra),
                quindi un range in metri schiacciava le quote basse — quelle che
                interessano — in fondo alla corsa. A passo costante ogni quota ha
                lo stesso spazio -> selezione affidabile. L'etichetta sopra
                mostra comunque i metri reali della banda. */}
            <input
              type="range"
              min={0}
              max={cube.nz - 1}
              step={1}
              value={idx}
              onChange={(e) => setEnvHeightBand(Number(e.target.value))}
              className="accent-talea-400 h-32 cursor-pointer"
              style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
              aria-label={lang === 'it' ? 'Altezza dal suolo' : 'Height above ground'}
            />
            <div className="text-[#7a9a87] text-[9px] font-mono leading-none text-center">
              {zLabel(0)}–{zLabel(cube.nz - 1)} m
            </div>
          </div>
        )
      })()}

      {/* TOOLBAR "Aggiungi": l'utente posa alberi/arredi in 3D (solo in
          sessione). Tool a punto = 1 clic; tool a linea = 2 clic (filari/siepi/
          ringhiere). In basso a destra, collassabile per non affollare la UI. */}
      {(() => {
        const it = lang === 'it'
        const TOOL_LABEL: Record<string, string> = it
          ? {
              tree: 'Albero', bench: 'Panchina', bin: 'Cestino',
              fountain: 'Fontanella', 'fountain-big': 'Fontana grande',
              lamp: 'Lampione', bollard: 'Dissuasore',
              'tree-row': 'Filare', hedge: 'Siepe', 'railing-line': 'Ringhiera',
            }
          : {
              tree: 'Tree', bench: 'Bench', bin: 'Bin',
              fountain: 'Drinking f.', 'fountain-big': 'Large fountain',
              lamp: 'Lamp', bollard: 'Bollard',
              'tree-row': 'Tree row', hedge: 'Hedge', 'railing-line': 'Railing',
            }
        const pointTools = INSERT_TOOLS.filter((tl) => !tl.line)
        const lineTools = INSERT_TOOLS.filter((tl) => tl.line)
        const toolBtn = (tl: InsertTool) => {
          const active = insertTool?.id === tl.id
          return (
            <button
              key={tl.id}
              type="button"
              onClick={() => {
                setLineStart(null)
                setInsertTool(active ? null : tl)
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-mono border transition-colors ${
                active
                  ? 'bg-talea-400/90 text-white border-talea-300'
                  : 'bg-talea-panel-2/70 text-talea-200 border-talea-400/20 hover:border-talea-400/60'
              }`}
            >
              <span className="shrink-0 opacity-90"><ToolIcon id={tl.id} /></span>
              <span className="truncate">{TOOL_LABEL[tl.id]}</span>
            </button>
          )
        }
        return (
          <div className="absolute top-20 left-2 sm:left-4 z-20 flex items-start gap-2">
            {/* Toggle del pannello "Cosa vedere" (ex "Layer"). */}
            <button
              type="button"
              onClick={() => setLayerPanelOpen((v) => !v)}
              data-help="layers"
              title={layerPanelOpen ? t('hideLayers', lang) : t('showLayers', lang)}
              className="px-2.5 py-1.5 rounded bg-talea-panel/85 border border-talea-400/30 backdrop-blur-sm shadow-xl text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors text-[11px] font-mono uppercase tracking-widest flex items-center gap-1.5 shrink-0"
              aria-label="Toggle layer panel"
            >
              <span
                className="inline-block transition-transform duration-200"
                style={{ transform: layerPanelOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
              >
                ▸
              </span>
              {t('layer', lang)}
            </button>

            {/* Arredi urbani (inserimento) — ACCANTO al pannello "Cosa vedere".
                Il pannello strumenti si apre SOTTO il bottone. */}
            <div className="relative shrink-0" data-help="arredi">
              <button
                type="button"
                onClick={() => {
                  const next = !insertPanelOpen
                  setInsertPanelOpen(next)
                  if (!next) {
                    setInsertTool(null) // chiudendo, esci dalla modalita'
                    setLineStart(null)
                  }
                }}
                className={`px-3 py-1.5 rounded backdrop-blur-sm shadow-xl text-[11px] font-mono uppercase tracking-widest border transition-colors flex items-center gap-1.5 ${
                  insertPanelOpen
                    ? 'bg-talea-400/90 text-white border-talea-300'
                    : 'bg-talea-panel/85 text-talea-300 border-talea-400/30 hover:text-talea-100 hover:border-talea-400/60'
                }`}
              >
                <span className="text-sm leading-none">＋</span>
                <span className="hidden sm:inline">
                  {it ? 'Arredi urbani' : 'Street furniture'}
                </span>
              </button>
              {insertPanelOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 bg-talea-panel/95 border border-talea-400/30 rounded p-2 backdrop-blur-sm shadow-xl w-[min(240px,calc(100vw-1rem))]">
                <div className="text-talea-400 text-[10px] font-mono uppercase tracking-widest mb-1.5">
                  {it ? 'Aggiungi alla scena' : 'Add to the scene'}
                </div>
                <div className="grid grid-cols-2 gap-1">{pointTools.map(toolBtn)}</div>
                <div className="text-[#7a9a87] text-[10px] font-mono uppercase tracking-wider mt-2 mb-1">
                  {it ? 'A linea (2 clic)' : 'Line (2 clicks)'}
                </div>
                <div className="grid grid-cols-2 gap-1">{lineTools.map(toolBtn)}</div>
                <div className="text-[#5a7a67] text-[10px] leading-snug mt-2 min-h-[2.2em]">
                  {insertTool
                    ? insertTool.line
                      ? lineStart
                        ? it
                          ? 'Clicca il secondo punto per chiudere la linea.'
                          : 'Click the second point to close the line.'
                        : it
                          ? 'Clicca il punto di inizio della linea.'
                          : 'Click the line start point.'
                      : it
                        ? 'Clicca sulla mappa per posare l’oggetto.'
                        : 'Click on the map to place the object.'
                    : it
                      ? 'Scegli un oggetto, poi clicca sulla mappa.'
                      : 'Pick an object, then click on the map.'}
                </div>
                <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-talea-400/15">
                  <span className="text-[#7a9a87] text-[10px] font-mono">
                    {placed.length} {it ? 'posati' : 'placed'}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={placed.length === 0}
                      onClick={() => {
                        setLineStart(null)
                        setPlaced((p) => p.slice(0, -1))
                      }}
                      className="px-2 py-0.5 rounded text-[11px] font-mono border border-talea-400/20 text-talea-200 hover:border-talea-400/60 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {it ? 'Annulla' : 'Undo'}
                    </button>
                    <button
                      type="button"
                      disabled={placed.length === 0}
                      onClick={() => {
                        setLineStart(null)
                        setSelectedPlaced(null)
                        setPlaced([])
                      }}
                      className="px-2 py-0.5 rounded text-[11px] font-mono border border-talea-400/20 text-talea-200 hover:border-red-400/60 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {it ? 'Svuota' : 'Clear'}
                    </button>
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Barretta azioni sull'oggetto INSERITO selezionato (click su di esso):
          ruota o elimina. In alto-centro, sopra la scena. */}
      {selectedPlacedObj && (() => {
        const it = lang === 'it'
        const KIND_LABEL: Record<PlaceKind, string> = it
          ? {
              tree: 'Albero', shrub: 'Cespuglio', bench: 'Panchina',
              bin: 'Cestino', fountain: 'Fontanella', 'fountain-big': 'Fontana',
              lamp: 'Lampione', bollard: 'Dissuasore', railing: 'Ringhiera',
            }
          : {
              tree: 'Tree', shrub: 'Shrub', bench: 'Bench', bin: 'Bin',
              fountain: 'Drinking f.', 'fountain-big': 'Fountain',
              lamp: 'Lamp', bollard: 'Bollard', railing: 'Railing',
            }
        const iconBtn =
          'flex items-center justify-center w-7 h-7 rounded text-talea-100 border border-talea-400/25 hover:border-talea-400/70 hover:bg-talea-panel-2/60 transition-colors'
        return (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-talea-panel/95 border border-amber-400/40 rounded-full pl-3 pr-1.5 py-1 backdrop-blur-sm shadow-xl">
            <span className="text-amber-600 text-[11px] font-mono uppercase tracking-wider mr-1">
              {KIND_LABEL[selectedPlacedObj.kind]}
            </span>
            <button type="button" onClick={() => rotateSelected(30)} className={iconBtn}
              title={it ? 'Ruota a sinistra' : 'Rotate left'} aria-label={it ? 'Ruota a sinistra' : 'Rotate left'}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8a5 5 0 1 1 1.5 3.5" /><path d="M3 5v3h3" /></svg>
            </button>
            <button type="button" onClick={() => rotateSelected(-30)} className={iconBtn}
              title={it ? 'Ruota a destra' : 'Rotate right'} aria-label={it ? 'Ruota a destra' : 'Rotate right'}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 8a5 5 0 1 0-1.5 3.5" /><path d="M13 5v3h-3" /></svg>
            </button>
            <button type="button" onClick={deleteSelected}
              className="flex items-center justify-center w-7 h-7 rounded text-red-300 border border-red-400/25 hover:border-red-400/70 hover:bg-red-500/15 transition-colors"
              title={it ? 'Elimina' : 'Delete'} aria-label={it ? 'Elimina' : 'Delete'}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M6 4V3h4v1M5 4l.7 9h4.6L11 4" /></svg>
            </button>
            <button type="button" onClick={() => setSelectedPlaced(null)}
              className={iconBtn} title={it ? 'Deseleziona' : 'Deselect'} aria-label={it ? 'Deseleziona' : 'Deselect'}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </div>
        )
      })()}

      <TimeSlider
        value={currentTime}
        onChange={setCurrentTime}
        lat={AOI_CENTER[1]}
        lon={AOI_CENTER[0]}
        lang={lang}
      />

      {/* Banner di BENVENUTO (prima visita): guida il cittadino. Centrato in
          alto, sopra ogni pannello (z-40), si chiude e non torna piu'. */}
      {showIntro && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-[min(380px,calc(100vw-2rem))] bg-talea-panel/95 border border-talea-400/40 rounded-lg p-4 backdrop-blur-sm shadow-2xl text-center">
          <div className="text-talea-300 text-sm font-bold uppercase tracking-widest mb-2">
            {lang === 'it' ? 'Benvenuto su Talea' : 'Welcome to Talea'}
          </div>
          <p className="text-talea-200 text-sm leading-relaxed mb-2">
            {lang === 'it'
              ? 'Esplora il microclima del quartiere: scopri dove fa più caldo e quanto il verde rinfresca la città.'
              : 'Explore the neighbourhood microclimate: see where it gets hottest and how greenery cools the city.'}
          </p>
          <ul className="text-talea-300 text-[13px] leading-relaxed text-left mb-3 space-y-1">
            <li>
              {lang === 'it'
                ? '① Scegli un dato dal pannello a sinistra'
                : '① Pick a layer from the left panel'}
            </li>
            <li>
              {lang === 'it'
                ? '② Clicca sulla mappa per vedere i valori del punto'
                : '② Click the map to read a point’s values'}
            </li>
            <li>
              {lang === 'it'
                ? '③ Trascina per ruotare la vista 3D'
                : '③ Drag to rotate the 3D view'}
            </li>
          </ul>
          <p className="text-[#7a9a87] text-[10px] leading-snug mb-3">
            {lang === 'it'
              ? 'I dati sono una simulazione di una giornata estiva tipo, non il meteo di oggi.'
              : 'Data is a simulation of a typical summer day, not today’s weather.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={dismissIntro}
              className="px-5 py-1.5 rounded bg-talea-400 text-white text-sm font-bold uppercase tracking-wider hover:bg-talea-300 transition-colors"
            >
              {lang === 'it' ? 'Inizia' : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => {
                dismissIntro()
                setShowGuide(true)
              }}
              className="text-talea-300 hover:text-talea-100 text-xs font-mono uppercase tracking-wider underline-offset-2 hover:underline"
            >
              {lang === 'it' ? 'Apri la guida' : 'Open the guide'}
            </button>
          </div>
        </div>
      )}

      {/* GUIDA completa del sito (tasto "?"). Spiega cos'e', i dati e come si usa,
          con parole semplici per il cittadino. Scrollabile, chiudibile. */}
      {showGuide && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-[min(760px,calc(100vw-1.5rem))] max-h-[88vh] overflow-y-auto bg-talea-panel/97 border border-talea-400/40 rounded-lg p-5 backdrop-blur-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="text-talea-300 text-base font-bold uppercase tracking-widest">
                {lang === 'it' ? 'Guida a Talea' : 'Talea guide'}
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="text-[#5a7a67] hover:text-talea-200 text-xl leading-none -mt-1"
                aria-label={lang === 'it' ? 'Chiudi' : 'Close'}
              >
                ✕
              </button>
            </div>

            <p className="text-talea-200 text-sm leading-relaxed mb-4">
              {lang === 'it'
                ? 'Questa mappa 3D mostra il microclima di un quartiere di Bologna in una giornata estiva tipo: dove fa più caldo, dove il verde e il vento rinfrescano, quanto “scotta” davvero stare al sole. I dati vengono da una simulazione scientifica (ENVI-met), non sono il meteo di oggi.'
                : 'This 3D map shows the microclimate of a Bologna neighbourhood on a typical summer day: where it gets hottest, where greenery and wind cool things down, how much the sun really “burns”. The data comes from a scientific simulation (ENVI-met), it is not today’s weather.'}
            </p>

            {(() => {
              const it = lang === 'it'
              const Section = ({
                icon,
                title,
                children,
              }: {
                icon: string
                title: string
                children: ReactNode
              }) => (
                <div className="mb-3.5">
                  <div className="text-talea-200 text-sm font-semibold mb-1 flex items-center gap-2">
                    <span aria-hidden="true">{icon}</span>
                    {title}
                  </div>
                  <div className="text-talea-300 text-[13px] leading-relaxed">
                    {children}
                  </div>
                </div>
              )
              return (
                <>
                  <Section icon="①" title={it ? 'Scegli un dato' : 'Pick a layer'}>
                    {it
                      ? 'Nel pannello a sinistra apri “Microclima” e scegli cosa vedere: temperatura dell’aria, temperatura percepita, umidità, sole, vento, verde. Si vede un dato alla volta, colorato sulla mappa. La legenda in alto a destra spiega i colori.'
                      : 'In the left panel open “Microclimate” and choose what to see: air temperature, perceived temperature, humidity, sun, wind, greenery. One layer at a time, coloured on the map. The legend on the top right explains the colours.'}
                  </Section>
                  <Section icon="②" title={it ? 'Clicca un punto' : 'Click a spot'}>
                    {it
                      ? 'Clicca sulla mappa: in alto a destra compaiono i valori esatti di quel punto (per esempio quanti gradi). Clicca su un edificio per leggere la sua temperatura, su un albero per la specie.'
                      : 'Click on the map: the exact values of that spot appear on the top right (e.g. how many degrees). Click a building to read its temperature, a tree for its species.'}
                  </Section>
                  <Section icon="③" title={it ? 'Cambia quota (slider)' : 'Change height (slider)'}>
                    {it
                      ? 'Quando un dato ha la barra verticale a destra, trascinala per salire dal livello della strada fin sopra i tetti. Il dato e il valore del punto cambiano con l’altezza: in alto il vento è più forte, il caldo si distribuisce diversamente.'
                      : 'When a layer has the vertical bar on the right, drag it to rise from street level up above the rooftops. The layer and the point value change with height: wind is stronger up high, heat spreads differently.'}
                  </Section>
                  <Section icon="④" title={it ? 'Muoviti in 3D' : 'Move in 3D'}>
                    {it
                      ? 'Trascina per ruotare, usa due dita o la rotellina per zoomare e inclinare. La bussola in alto a destra rimette il Nord in su. Cerca una via o un quartiere dalla barra di ricerca in alto.'
                      : 'Drag to rotate, use two fingers or the wheel to zoom and tilt. The compass on the top right resets North up. Search a street or district from the search bar at the top.'}
                  </Section>

                  {/* I COMANDI E I PANNELLI: una card per ogni elemento dell'UI
                      e cosa fa — come l'help dei siti Talea (historysuhi/sci):
                      "ti fa vedere i pannelli e cosa fa ognuno". */}
                  <div className="border-t border-talea-400/15 mt-1 pt-3 mb-1">
                    <div className="text-talea-200 text-sm font-semibold mb-2">
                      {it ? 'I comandi e i pannelli' : 'Controls & panels'}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(
                        [
                          [['Cosa vedere', 'What to see'], ['Pannello a sinistra: accendi i dati da mostrare — microclima, edifici, verde, ambiente.', 'Left panel: turn on the data to show — microclimate, buildings, greenery, environment.']],
                          [['Ricerca', 'Search'], ['In alto: cerca una via o un quartiere di Bologna, con suggerimenti mentre scrivi.', 'Top: search a Bologna street or district, with suggestions as you type.']],
                          [['Slider quota', 'Height slider'], ['A destra quando un dato microclima è acceso: vedi il dato dal livello strada (1,5 m) fin sopra i tetti.', 'On the right when a microclimate layer is on: see the data from street level (1.5 m) up above the rooftops.']],
                          [['Legenda', 'Legend'], ['In basso a destra: la scala dei colori del dato attivo, con i valori minimo e massimo.', 'Bottom right: the colour scale of the active layer, with min and max values.']],
                          [['Mappa di base', 'Base map'], ['Pulsante mappa in alto: cambia lo sfondo — mappa, scuro, satellite, ortofoto.', 'Map button on top: switch the background — map, dark, satellite, orthophoto.']],
                          [['Bussola', 'Compass'], ['In alto a destra: mostra l’orientamento; cliccala per rimettere il Nord in su.', 'Top right: shows orientation; click it to reset North up.']],
                          [['Sole e orario', 'Sun & time'], ['Slider in basso: sposta il sole nell’arco della giornata e guarda come cambiano le ombre.', 'Bottom slider: move the sun through the day and watch the shadows change.']],
                          [['Arredi urbani', 'Street furniture'], ['Accanto a “Cosa vedere”: aggiungi alla scena panchine, alberi, fontane e altro.', 'Next to “What to see”: add benches, trees, fountains and more to the scene.']],
                          [['Meteo', 'Weather'], ['Pulsante in basso: il meteo attuale di Bologna (3BMeteo).', 'Bottom button: Bologna’s current weather (3BMeteo).']],
                          [['Vista pulita, foto, condividi', 'Clean view, photo, share'], ['In basso a sinistra: nascondi i pannelli, scarica uno screenshot 3D o condividi la vista.', 'Bottom left: hide the panels, download a 3D screenshot or share the view.']],
                        ] as [[string, string], [string, string]][]
                      ).map(([title, desc], i) => (
                        <div
                          key={i}
                          className="border border-talea-400/20 rounded bg-talea-panel-2/40 p-2.5"
                        >
                          <strong className="text-talea-100 text-[13px] block leading-tight">
                            {it ? title[0] : title[1]}
                          </strong>
                          <p className="text-talea-300 text-[12px] leading-snug mt-1">
                            {it ? desc[0] : desc[1]}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-talea-400/15 mt-1 pt-3">
                    <div className="text-talea-200 text-sm font-semibold mb-2">
                      {it ? 'Cosa significano i dati' : 'What the data means'}
                    </div>
                    <ul className="text-talea-300 text-[13px] leading-relaxed space-y-1.5">
                      <li>
                        <b className="text-talea-100">{it ? 'Temperatura dell’aria' : 'Air temperature'}</b>{' '}
                        — {it ? 'quanto è calda l’aria all’altezza delle persone.' : 'how hot the air is at human height.'}
                      </li>
                      <li>
                        <b className="text-talea-100">{it ? 'Temperatura percepita' : 'Perceived temperature'}</b>{' '}
                        — {it ? 'il caldo che senti davvero: aria + sole + calore di muri e asfalto. È l’indice più “umano”.' : 'the heat you actually feel: air + sun + heat from walls and pavement. The most “human” index.'}
                      </li>
                      <li>
                        <b className="text-talea-100">{it ? 'Umidità' : 'Humidity'}</b>{' '}
                        — {it ? 'quanto è afosa l’aria.' : 'how muggy the air is.'}
                      </li>
                      <li>
                        <b className="text-talea-100">{it ? 'Sole e luce' : 'Sun & light'}</b>{' '}
                        — {it ? 'quanto sole diretto, diffuso o riflesso colpisce le strade.' : 'how much direct, diffuse or reflected sun hits the streets.'}
                      </li>
                      <li>
                        <b className="text-talea-100">{it ? 'Vento' : 'Wind'}</b>{' '}
                        — {it ? 'quanto soffia: porta via il caldo e rinfresca.' : 'how strong it blows: it carries heat away and cools.'}
                      </li>
                      <li>
                        <b className="text-talea-100">{it ? 'Verde' : 'Greenery'}</b>{' '}
                        — {it ? 'dove la chioma degli alberi fa ombra e frescura.' : 'where tree canopy gives shade and cooling.'}
                      </li>
                    </ul>
                  </div>

                  <p className="text-[#7a9a87] text-[11px] leading-snug mt-4">
                    {it
                      ? 'I dati microclima sono una fotografia simulata di un istante (una giornata estiva tipo), utile a confrontare le zone fra loro, non una previsione del tempo.'
                      : 'The microclimate data is a simulated snapshot of one moment (a typical summer day), useful to compare areas with each other, not a weather forecast.'}
                  </p>
                </>
              )
            })()}

            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-6 py-1.5 rounded bg-talea-400 text-white text-sm font-bold uppercase tracking-wider hover:bg-talea-300 transition-colors"
              >
                {lang === 'it' ? 'Ho capito' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODALITÀ AIUTO (annotazioni) ──────────────────────────────────────
          Come l'help di talea.comune.bologna.it/historysuhi: ogni comando
          marcato con `data-help` viene contornato da un TRATTEGGIO GIALLO e
          accanto compare una card con cosa fa, su sfondo scurito + banner in
          alto. I rettangoli sono misurati in `helpRects`. L'overlay non blocca i
          click (pointer-events-none): si esce dal banner. */}
      {helpOpen && (
        <div className="fixed inset-0 z-[60] pointer-events-none">
          <div className="absolute inset-0 bg-[#00280d]/55" />

          {helpRects.map(({ key, rect }, i) => {
            const info = HELP_INFO[key]
            if (!info) return null
            const L = lang === 'it' ? 0 : 1
            const vw = window.innerWidth
            const vh = window.innerHeight
            const CARD_W = 250
            const clamp = (x: number, lo: number, hi: number) =>
              Math.max(lo, Math.min(hi, x))
            const card: CSSProperties = { width: CARD_W }
            if (info.side === 'below') {
              card.top = rect.bottom + 10
              card.left = clamp(rect.left, 8, vw - CARD_W - 8)
            } else if (info.side === 'above') {
              card.bottom = vh - rect.top + 10
              card.left = clamp(rect.left, 8, vw - CARD_W - 8)
            } else if (info.side === 'left') {
              card.top = clamp(rect.top, 8, vh - 110)
              card.right = vw - rect.left + 10
            } else {
              card.top = clamp(rect.top, 8, vh - 110)
              card.left = clamp(rect.right + 10, 8, vw - CARD_W - 8)
            }
            return (
              <div key={key + i}>
                {/* contorno giallo tratteggiato attorno al comando */}
                <div
                  className="absolute rounded-md"
                  style={{
                    left: rect.left - 4,
                    top: rect.top - 4,
                    width: rect.width + 8,
                    height: rect.height + 8,
                    border: '2px dashed var(--talea-yellow)',
                    boxShadow: '0 0 0 2px rgba(255, 230, 4, 0.18)',
                  }}
                />
                {/* card descrittiva */}
                <div
                  className="absolute flex items-start gap-2 rounded-md border border-talea-green bg-white px-3 py-2 shadow-2xl"
                  style={card}
                >
                  <span className="shrink-0 grid place-items-center w-5 h-5 rounded-full bg-talea-green-dark text-talea-yellow text-[10px] font-bold">
                    {i + 1}
                  </span>
                  <span className="text-[12px] leading-snug text-[#1f3d2a]">
                    <b className="text-talea-green-dark">{info.label[L]}</b>
                    {' — '}
                    {info.text[L]}
                  </span>
                </div>
              </div>
            )
          })}

          {/* Banner: titolo + "Guida completa" (apre il modale) + chiudi. */}
          <div className="pointer-events-auto fixed top-3 left-1/2 -translate-x-1/2 z-[61] flex items-center gap-3 w-[min(720px,calc(100vw-1.5rem))] rounded-2xl border border-talea-green bg-[#fffbf1]/95 px-4 py-2.5 backdrop-blur-md shadow-2xl">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-[#17231a] min-w-0">
              <span aria-hidden="true">💡</span>
              <span className="truncate">
                {lang === 'it'
                  ? 'Modalità aiuto: ogni riquadro giallo spiega un comando.'
                  : 'Help mode: each yellow box explains a control.'}
              </span>
            </span>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onHelpOpenChange(false)
                  setShowGuide(true)
                }}
                className="px-3 py-1.5 rounded-full bg-talea-green-dark text-white text-[12px] font-bold hover:bg-[#0d533f] transition-colors"
              >
                {lang === 'it' ? 'Guida completa' : 'Full guide'}
              </button>
              <button
                type="button"
                onClick={() => onHelpOpenChange(false)}
                aria-label={lang === 'it' ? 'Chiudi aiuto' : 'Close help'}
                className="w-9 h-9 grid place-items-center rounded-full border border-talea-400/30 bg-white text-[#17231a] hover:border-talea-green hover:text-talea-green-dark transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Colonna in alto a destra: prima le info del punto cliccato, poi la
          legenda (overlay microclima + scala temperatura edifici) SOTTO. */}
      {(() => {
        const activeEnv = ENV_OVERLAYS.filter((o) => envVisible[o.key])
        const showBuildingTemp = visibility['buildings-temp']
        const showNoise = visibility['noise']
        const showLegend = activeEnv.length > 0 || showBuildingTemp || showNoise
        if (!probe && !showLegend) return null
        // Stesso range con cui sono colorate le facciate (percentili 5-95
        // delle MRT pedonali degli edifici): legenda e colori coincidono.
        const mrtLegendRange = mrtBuildingsRange ?? { min: 20, max: 80 }
        // Data fissa della simulazione: mostrata quando e' attivo un dato
        // ENVI-met (overlay microclima o edifici per temperatura), non per il
        // solo rumore.
        const envDate = formatEnvDate(ENV_SOURCE, lang)
        const showEnvDate = (activeEnv.length > 0 || showBuildingTemp) && !!envDate
        const NOISE_GRAD = '#22c55e, #84cc16, #eab308, #f97316, #ef4444'
        return (
          <>
            {/* Info del punto cliccato: IN ALTO a destra, sotto la bussola
                (top-24: la bussola arriva a 5rem, +1rem di aria). Il max-h
                spartisce la colonna con la legenda (35vh + 1rem di gap):
                i due pannelli scrollano ognuno per sé e non si accavallano. */}
            {probe && (
              <div className="absolute top-24 right-2 sm:right-4 z-10 w-[min(260px,calc(100vw-1rem))] max-h-[calc(65vh-8rem)] overflow-y-auto">
                <InfoPanel
                  lat={probe.lat}
                  lon={probe.lon}
                  envSamples={pointEnv}
                  heightM={(() => {
                    const o = activeEnv.find((x) => x.agg === 'band')
                    const c = o ? getCubeSync(o.key) : null
                    if (!c) return null
                    const b = Math.min(envHeightBand, c.nz - 1)
                    return Math.round(c.zM[b] * 10) / 10
                  })()}
                  profile={
                    pointProfile
                      ? {
                          unit: pointProfile.def.unit,
                          label: envLabel(pointProfile.def, lang),
                          ramp: pointProfile.def.ramp,
                          vmin: pointProfile.vmin,
                          vmax: pointProfile.vmax,
                          points: pointProfile.points,
                          currentBand: envHeightBand,
                        }
                      : null
                  }
                  lang={lang}
                  onClose={() => setProbe(null)}
                />
              </div>
            )}
            {/* Legenda: in basso a destra, a filo del fondo (bottom-4). Il
                bottone "Arredi urbani" e' stato spostato a sinistra, quindi qui
                sotto ora c'e' spazio libero e la legenda ci sta tutta. Scrolla
                se molto alta (overflow-y-auto). */}
            {showLegend && (
              <div className="absolute bottom-4 right-2 sm:right-4 z-10 w-[min(260px,calc(100vw-1rem))] max-h-[35vh] overflow-y-auto bg-talea-panel/85 border border-talea-400/30 rounded p-2 backdrop-blur-sm shadow-xl" data-help="legend">
                <div className="text-talea-400 text-[10px] font-mono uppercase tracking-widest mb-1.5 px-0.5">
                  {t('legend', lang)}
                </div>
                {showEnvDate && (
                  <div className="text-[#5a7a67] text-[10px] leading-snug mb-1.5 px-0.5 border-b border-talea-400/20 pb-1.5">
                    {lang === 'it'
                      ? `Simulazione ENVI-met · ${envDate} (dato fisso, non varia col giorno reale)`
                      : `ENVI-met simulation · ${envDate} (fixed snapshot, not the live day)`}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {showBuildingTemp && (
                    <div>
                      <div className="text-talea-200 text-[11px] font-mono mb-0.5">
                        {lang === 'it'
                          ? 'Edifici · temperatura percepita'
                          : 'Buildings · perceived temp.'}{' '}
                        (°C)
                      </div>
                      <div
                        className="h-2 rounded"
                        style={{ background: rampCssGradient('ylorrd') }}
                      />
                      <div className="flex justify-between text-[#5a7a67] text-[10px] font-mono mt-0.5">
                        <span>{Math.round(mrtLegendRange.min)}</span>
                        <span>{Math.round(mrtLegendRange.max)}</span>
                      </div>
                      <p className="text-[#5a7a67] text-[10px] leading-snug mt-1">
                        {lang === 'it'
                          ? 'Caldo percepito (MRT) a livello strada, ~1,5 m, attorno all’edificio: sole diretto + calore delle superfici — non è la temperatura dell’aria né dei muri, al sole di luglio supera i 70 °C. Grigio = fuori dall’area ENVI-met.'
                          : 'Perceived heat (MRT) at street level, ~1.5 m, around the building: direct sun + surface heat — not the air or wall temperature; in July sun it exceeds 70 °C. Grey = outside the ENVI-met area.'}
                      </p>
                    </div>
                  )}
                  {showNoise && (
                    <div>
                      <div className="text-talea-200 text-[11px] font-mono mb-0.5">
                        {lang === 'it' ? 'Rumore (stima)' : 'Noise (est.)'} (dB)
                      </div>
                      <div
                        className="h-2 rounded"
                        style={{ background: `linear-gradient(to right, ${NOISE_GRAD})` }}
                      />
                      <div className="flex justify-between text-[#5a7a67] text-[10px] font-mono mt-0.5">
                        <span>50</span>
                        <span>78</span>
                      </div>
                    </div>
                  )}
                  {activeEnv.map((o) => {
                    const cube = getCubeSync(o.key)
                    const range = envRangeOf(o)
                    const zAt =
                      o.agg === 'band' && cube
                        ? Math.round(
                            cube.zM[Math.min(envHeightBand, cube.nz - 1)] * 10,
                          ) / 10
                        : null
                    return (
                      <div key={o.key}>
                        <div className="text-talea-200 text-[11px] font-mono mb-0.5">
                          {envLabel(o, lang)} ({o.unit})
                          {zAt != null && (
                            <span className="text-talea-300"> @ {zAt} m</span>
                          )}
                        </div>
                        <div
                          className="h-2 rounded"
                          style={{ background: rampCssGradient(o.ramp) }}
                        />
                        <div className="flex justify-between text-[#5a7a67] text-[10px] font-mono mt-0.5">
                          <span>{range.min}</span>
                          <span>{range.max}</span>
                        </div>
                        {o.desc && (
                          <p className="text-[#5a7a67] text-[10px] leading-snug mt-1">
                            {o.desc[lang]}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )
      })()}
        </>
      )}

      {/* Controlli sempre visibili (anche in vista pulita): in basso a sinistra,
          in RIGA ORIZZONTALE (prima era una colonna verticale alta che finiva
          sotto il pannello layer). Cosi' occupano poca altezza e lasciano spazio.
          Vista pulita nasconde i pannelli; screenshot scarica la scena 3D. */}
      <div className="absolute bottom-4 left-2 sm:left-4 z-20 flex flex-row gap-2" data-help="controls">
        <button
          type="button"
          onClick={() => setUiHidden((v) => !v)}
          title={
            uiHidden
              ? t('showPanels', lang)
              : t('hidePanels', lang)
          }
          aria-label={uiHidden ? t('showPanels', lang) : t('hidePanels', lang)}
          className="w-10 h-10 rounded-full bg-talea-panel/85 border border-talea-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors"
        >
          {uiHidden ? (
            // occhio sbarrato = pannelli nascosti (clicca per mostrare)
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          ) : (
            // occhio = pannelli visibili (clicca per nascondere)
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={takeScreenshot}
          title={t('screenshot', lang)}
          aria-label={t('screenshot', lang)}
          className="w-10 h-10 rounded-full bg-talea-panel/85 border border-talea-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors"
        >
          {/* Icona stampante stilizzata (outline) */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9V2h12v7" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
        </button>
        <button
          type="button"
          onClick={shareScene}
          title={t('share', lang)}
          aria-label={t('share', lang)}
          className="w-10 h-10 rounded-full bg-talea-panel/85 border border-talea-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setMeteoOpen((v) => !v)}
          title={t('meteo', lang)}
          aria-label={t('meteo', lang)}
          aria-pressed={meteoOpen}
          className={`w-10 h-10 rounded-full bg-talea-panel/85 border backdrop-blur-sm shadow-xl flex items-center justify-center transition-colors ${
            meteoOpen
              ? 'border-talea-400/60 text-talea-100'
              : 'border-talea-400/30 text-talea-300 hover:text-talea-100 hover:border-talea-400/60'
          }`}
        >
          {/* Icona meteo stilizzata (outline): sole dietro una nuvola */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* raggi di sole */}
            <path d="M8 4V2.5M4.4 5.4 3.3 4.3M4 9H2.5M13.2 5.4l1.1-1.1" />
            {/* disco solare */}
            <circle cx="8" cy="9" r="2.6" />
            {/* nuvola */}
            <path d="M17.5 19H8.2a3.7 3.7 0 0 1-.4-7.38 5 5 0 0 1 9.46 1.9A3.2 3.2 0 0 1 17.5 19Z" />
          </svg>
        </button>
        {/* (Il tasto "Guida" è stato spostato nell'header — vedi
            explore/page.tsx; il tasto "Suoni della zona" è stato rimosso
            il 17/08/2026 insieme al paesaggio sonoro.) */}
      </div>

      {/* Pannello meteo: widget 3BMeteo. Nascosto in vista pulita come gli altri. */}
      {meteoOpen && !uiHidden && (
        <MeteoWidget lang={lang} onClose={() => setMeteoOpen(false)} />
      )}

      {/* Toast "link copiato": fallback di condivisione su desktop senza share API. */}
      {shareToast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-talea-panel/90 border border-talea-400/40 backdrop-blur-sm shadow-xl text-sm text-talea-100">
          {t('shareCopied', lang)}
        </div>
      )}
    </div>
  )
}
