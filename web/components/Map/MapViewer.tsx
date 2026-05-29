'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import {
  _SunLight as SunLight,
  AmbientLight,
  LightingEffect,
  type Layer,
} from '@deck.gl/core'
import { GeoJsonLayer, ColumnLayer } from '@deck.gl/layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { Geometry } from '@luma.gl/engine'
import { getSunPosition, toMapLibreLight } from '@/lib/sun'
import { computeSky, nightFactor } from '@/lib/sky'
import { buildWindSampler, type WindSampler } from '@/lib/wind'
import { buildEnvimetSampler, type EnvimetSampler } from '@/lib/envimet'
import { t, type Lang, type StringKey } from '@/lib/i18n'
import {
  loadTemperatureSeries,
  lookupTemperature,
  type TempLookup,
  type TempRecord,
} from '@/lib/temperature'
import TimeSlider from '@/components/UI/TimeSlider'
import InfoPanel from '@/components/UI/InfoPanel'
import { withBase } from '@/lib/basePath'
import {
  BOLOGNA_FOREST_DARK,
  BOLOGNA_OCRA,
  BOLOGNA_RED,
  BOLOGNA_SANGIOVESE,
  toCss,
  withAlpha,
} from '@/lib/palette'

// Chiavi degli overlay microclima ENVI-met (devono combaciare con i `key`
// in web/public/data/processed/envimet/overlays.json).
type EnvimetKey =
  | 'env-temperature'
  | 'env-humidity'
  | 'env-vegetation_lad'
  | 'env-direct_sw'
  | 'env-diffuse_sw'
  | 'env-reflected_sw'
  | 'env-mean_radiant_temp'

type LayerKey =
  | 'land-use'
  | 'buildings-particellari'
  | 'buildings-3d'
  | 'shadows'
  | 'buildings-temp'
  | 'trees'
  | 'green-areas'
  | 'parks'
  | 'private-green'
  | 'air-stations'
  | 'wind'
  | 'noise'
  | EnvimetKey

type CategoryKey = 'edifici' | 'verde' | 'ambiente' | 'microclima' | 'territorio'

// Un overlay ENVI-met: PNG georeferenziato su 4 angoli (dominio ruotato) +
// range/legenda per la UI. Caricato da envimet/overlays.json.
type EnvimetOverlay = {
  key: string
  label: string
  unit: string
  image: string
  values: string
  range: { min: number; max: number }
  bounds: { west: number; south: number; east: number; north: number }
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ]
  legend: { value: number; color: string }[]
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
  { key: 'ambiente', labelKey: 'cat_ambiente', defaultOpen: false },
  { key: 'microclima', labelKey: 'cat_microclima', defaultOpen: false },
  { key: 'territorio', labelKey: 'cat_territorio', defaultOpen: false },
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
  { id: 'shadows', labelKey: 'layer_shadows', default: true, category: 'edifici' },
  { id: 'buildings-particellari', labelKey: 'layer_buildings_2d', default: false, category: 'edifici' },
  { id: 'buildings-temp', labelKey: 'layer_buildings_temp', default: false, category: 'edifici' },
  { id: 'trees', labelKey: 'layer_trees', default: true, category: 'verde' },
  { id: 'green-areas', labelKey: 'layer_green', default: true, category: 'verde' },
  { id: 'parks', labelKey: 'layer_parks', default: false, category: 'verde' },
  { id: 'private-green', labelKey: 'layer_private_green', default: false, category: 'verde' },
  { id: 'air-stations', labelKey: 'layer_air', default: false, category: 'ambiente' },
  { id: 'wind', labelKey: 'layer_wind', default: false, category: 'ambiente' },
  { id: 'noise', labelKey: 'layer_noise', default: false, category: 'ambiente' },
  // Overlay microclima ENVI-met (PNG 3x3 m sul dominio Talea). rawLabel
  // allineato ai `label` di overlays.json.
  { id: 'env-temperature', rawLabel: 'Temperatura aria', default: false, category: 'microclima' },
  { id: 'env-mean_radiant_temp', rawLabel: 'Mean Radiant Temp.', default: false, category: 'microclima' },
  { id: 'env-humidity', rawLabel: 'Umidità relativa', default: false, category: 'microclima' },
  { id: 'env-direct_sw', rawLabel: 'Radiazione diretta', default: false, category: 'microclima' },
  { id: 'env-diffuse_sw', rawLabel: 'Radiazione diffusa', default: false, category: 'microclima' },
  { id: 'env-reflected_sw', rawLabel: 'Radiazione riflessa', default: false, category: 'microclima' },
  { id: 'env-vegetation_lad', rawLabel: 'Vegetazione (LAD)', default: false, category: 'microclima' },
  { id: 'land-use', labelKey: 'layer_landuse', default: false, category: 'territorio' },
]

// URL del meta unico degli overlay ENVI-met.
const ENVIMET_OVERLAYS_URL = withBase('/data/processed/envimet/overlays.json')

// Mappa key overlay -> id layer/source MapLibre.
const envLayerId = (key: string) => `env-${key}`

const BUILDINGS_FOOTPRINT_URL = withBase('/data/1)Buildings/1.1_Edifici_Particellari.geojson')
const BUILDINGS_HEIGHTS_URL = withBase('/data/processed/buildings_heights.geojson')
const WIND_META_URL = withBase('/data/processed/wind_overlay.json')
const TREES_DBTR_URL = withBase('/data/2)Vegetation/2.1_trees_aoi.geojson')
const TREES_OSM_URL = withBase('/data/processed/trees_osm.geojson')
const LANDUSE_URL = withBase('/data/4)LandUse-GroundSurface/4.1_uso_suolo_2020_ed2023_aoi.geojson')
const GREEN_URL = withBase('/data/green.geojson')
const PARKS_URL = withBase('/data/2)Vegetation/2.1_Aree_Verdi_In_Manutenzione.geojson')
const PRIVATE_GREEN_URL = withBase('/data/2)Vegetation/2.2_Verde_Privato_Urbanizzato.geojson')
const AIR_STATIONS_URL = withBase('/data/processed/air_stations.geojson')
const NOISE_URL = withBase('/data/processed/noise_roads.geojson')
const QUARTIERI_URL = withBase('/data/processed/quartieri.geojson')

type BasemapId = 'dark' | 'satellite' | 'ortofoto'
const BASEMAPS: Record<
  BasemapId,
  { label: string; style: maplibregl.StyleSpecification | string }
> = {
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

type WindOverlay = {
  png: string
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ]
  bounds: { west: number; south: number; east: number; north: number }
  range: { min: number; max: number }
}

const AOI_CENTER: [number, number] = [11.343720439501553, 44.49989258707834]
const DEFAULT_BUILDING_HEIGHT = 15

// Albero stilizzato: tronco cilindrico + chioma a CONI sovrapposti (abete
// low-poly), generata proceduralmente (nessun asset esterno copiato).
const TRUNK_HEIGHT = 3.2
const TRUNK_RADIUS = 0.32
const CANOPY_RADIUS = 2.6

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
const TREE_MESH = makeFirMesh()

type TreePoint = { position: [number, number]; seed: number }

// Hash deterministico per dare un po' di variazione (scala + tonalita') a
// ogni albero senza fare flicker tra render.
function hashSeed(lon: number, lat: number): number {
  const x = Math.sin(lon * 12.9898 + lat * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function buildLightingEffect(
  timestamp: number,
  shadowsOn: boolean,
): LightingEffect {
  // Di notte (sole sotto l'orizzonte) spengo sole + ombre: altrimenti
  // deck.gl proietta ombre lunghissime/assurde da una sorgente che e'
  // sotto il terreno. Lascio solo un ambient piu' alto per leggibilita'.
  // `shadowsOn` e' il toggle "Ombre" (richiede "Edifici 3D").
  const sunPos = getSunPosition(
    new Date(timestamp),
    AOI_CENTER[1],
    AOI_CENTER[0],
  )
  const isDay = sunPos.altitudeDeg > 0
  const shadowsActive = isDay && shadowsOn
  // IMPORTANTE: `_shadow` dipende SOLO dal giorno/notte, NON dal toggle
  // "Ombre". Cambiare `_shadow` a runtime ricostruisce il modulo ombre di
  // deck.gl e su alcune GPU lascia la scena vuota (edifici spariti). Tenendolo
  // costante (sempre acceso di giorno) il modulo non si ricostruisce mai;
  // il toggle "Ombre" agisce solo sulla TRASPARENZA dell'ombra (shadowColor
  // alpha 0..1), che e' un semplice cambio di uniform.
  const sun = new SunLight({
    timestamp,
    color: [255, 255, 255],
    intensity: isDay ? 1.5 : 0,
    _shadow: isDay,
  })
  const ambient = new AmbientLight({
    color: [255, 255, 255],
    intensity: isDay ? 1.0 : 0.6,
  })
  const effect = new LightingEffect({ sun, ambient })
  ;(effect as unknown as { shadowColor: number[] }).shadowColor = shadowsActive
    ? [0, 0, 0, 0.5]
    : [0, 0, 0, 0]
  return effect
}

type QuartiereFeature = {
  type: 'Feature'
  properties: {
    cod_quar: number
    quartiere: string
    bbox: [number, number, number, number]
  }
  geometry: {
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

const QUARTIERE_BLOCK_HEIGHT = 80 // m, altezza del blocco pseudo-3D
const QUARTIERE_BLOCK_COLOR = withAlpha(BOLOGNA_RED, 130)
const QUARTIERE_LINE_COLOR = withAlpha(BOLOGNA_RED, 230)

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

// Rampa giallo -> rosso (YlOrRd) per la temperatura, normalizzata su [min,max].
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

type BuildingTempFeature = {
  properties?: { height?: number; air_temp?: number } | null
}

function buildShadowBuildingsLayer(
  visible: boolean,
  dataUrl: string,
  // Se valorizzato, gli edifici sono colorati per `air_temp` (ENVI-met)
  // normalizzata su questo range; chi non ha il dato resta grigio.
  tempRange: { min: number; max: number } | null,
): GeoJsonLayer | null {
  if (!visible) return null
  const solidOcra = withAlpha(BOLOGNA_OCRA, 240)
  const getFillColor = tempRange
    ? (f: BuildingTempFeature): [number, number, number, number] => {
        const tC = f.properties?.air_temp
        if (typeof tC !== 'number')
          return [...BUILDING_GREY, 235] as [number, number, number, number]
        const tNorm = (tC - tempRange.min) / (tempRange.max - tempRange.min || 1)
        return [...ylOrRd(tNorm), 245] as [number, number, number, number]
      }
    : solidOcra
  return new GeoJsonLayer({
    id: 'buildings-shadow',
    data: dataUrl,
    stroked: true,
    filled: true,
    extruded: true,
    getElevation: (f: BuildingTempFeature) => {
      const h = f.properties?.height
      return typeof h === 'number' && h > 0 ? h : DEFAULT_BUILDING_HEIGHT
    },
    getFillColor,
    getLineColor: withAlpha(BOLOGNA_SANGIOVESE, 255),
    lineWidthMinPixels: 0.5,
    pickable: false,
    updateTriggers: {
      getFillColor: [tempRange?.min, tempRange?.max],
    },
    material: {
      ambient: 0.4,
      diffuse: 0.9,
      shininess: 20,
      specularColor: [80, 60, 50],
    },
  })
}

function buildTreesLayers(
  visible: boolean,
  data: TreePoint[] | null,
): Layer[] {
  if (!visible || !data || data.length === 0) return []
  const trunk = new ColumnLayer<TreePoint>({
    id: 'trees-trunk',
    data,
    diskResolution: 10,
    radius: TRUNK_RADIUS,
    extruded: true,
    pickable: false,
    getPosition: (d) => d.position,
    getElevation: (d) => TRUNK_HEIGHT * (0.85 + d.seed * 0.4),
    getFillColor: [82, 58, 38, 255],
    material: {
      ambient: 0.45,
      diffuse: 0.7,
      shininess: 3,
      specularColor: [40, 30, 20],
    },
  })
  // Chioma a DUE lobi (sfere) per evitare la "palla su stecco": un lobo
  // principale ovale che scende a coprire la cima del tronco + un lobo
  // secondario piu' piccolo sfalsato. Tutto con SphereGeometry (simmetrica,
  // nessun problema di orientamento del mesh).
  const trunkTopOf = (d: TreePoint) => TRUNK_HEIGHT * (0.85 + d.seed * 0.4)
  const canopyColor = (d: TreePoint): [number, number, number, number] => {
    const g = 110 + Math.round(d.seed * 50)
    const r = 50 + Math.round(d.seed * 30)
    const b = 55 + Math.round((1 - d.seed) * 35)
    return [r, g, b, 245]
  }
  const canopyMaterial = {
    ambient: 0.35,
    diffuse: 0.9,
    shininess: 6,
    specularColor: [50, 80, 50] as [number, number, number],
  }
  // Chioma: abete low-poly a coni (TREE_MESH), base sulla cima del tronco.
  // getScale [s, s, sz]: s = raggio chioma, sz = altezza (il mesh va da z=0
  // a ~1.3, quindi l'altezza reale e' ~1.3*sz).
  const canopy = new SimpleMeshLayer<TreePoint>({
    id: 'trees-canopy',
    data,
    mesh: TREE_MESH,
    pickable: false,
    getPosition: (d) => d.position,
    getTranslation: (d) => [0, 0, trunkTopOf(d) - 0.3],
    getScale: (d) => {
      const s = CANOPY_RADIUS * (0.8 + d.seed * 0.45)
      return [s, s, s * (1.9 + d.seed * 0.7)]
    },
    getColor: canopyColor,
    material: canopyMaterial,
  })
  return [trunk, canopy]
}

type MapViewerProps = {
  lang: Lang
}

export default function MapViewer({ lang }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [loading, setLoading] = useState(true)
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
  const [tempRecords, setTempRecords] = useState<TempRecord[] | null>(null)
  const [probe, setProbe] = useState<{ lat: number; lon: number } | null>(null)
  // Valori campionati al punto cliccato, derivati da `probe` + layer attivi:
  // vento solo se il layer 'wind' e' acceso, microclima per ogni overlay
  // ENVI-met spuntato.
  const [pointWind, setPointWind] = useState<number | null>(null)
  const [pointEnv, setPointEnv] = useState<
    { key: string; label: string; unit: string; value: number | null }[]
  >([])
  const windSamplerRef = useRef<WindSampler | null>(null)
  // Sampler ENVI-met per variabile (lazy: caricati quando l'overlay e'
  // acceso). `requested` evita fetch doppi; `samplersReady` ri-triggera il
  // calcolo dei valori quando un sampler finisce di caricare.
  const envSamplersRef = useRef<Record<string, EnvimetSampler>>({})
  const envRequestedRef = useRef<Set<string>>(new Set())
  const [samplersReady, setSamplersReady] = useState(0)
  // Segnaposto "Google Maps" del punto cliccato sulla mappa.
  const probeMarkerRef = useRef<maplibregl.Marker | null>(null)
  // Stazioni qualita' aria (marker DOM, sempre sopra agli edifici 3D).
  const [airStations, setAirStations] = useState<AirStation[] | null>(null)
  const airMarkersRef = useRef<maplibregl.Marker[]>([])
  // Rumore: tooltip che segue il mouse + audio Web Audio (hiss proporzionale
  // ai dB della strada sotto al cursore).
  const noiseTipRef = useRef<maplibregl.Popup | null>(null)
  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null)
  const [tempLookup, setTempLookup] = useState<TempLookup | null>(null)
  const [buildingsUrl, setBuildingsUrl] = useState<string>(
    BUILDINGS_FOOTPRINT_URL,
  )
  const [windOverlay, setWindOverlay] = useState<WindOverlay | null>(null)
  const windAddedRef = useRef(false)
  // Overlay microclima ENVI-met: stato per la UI (legenda, toggle abilitati),
  // ref per le callback registrate al mount (addCustomLayers).
  const [envimetOverlays, setEnvimetOverlays] = useState<EnvimetOverlay[] | null>(
    null,
  )
  const envimetRef = useRef<EnvimetOverlay[] | null>(null)
  const [basemap, setBasemap] = useState<BasemapId>('dark')
  const reapplyRef = useRef<(() => void) | null>(null)
  const [collapsed, setCollapsed] = useState<Record<CategoryKey, boolean>>(
    () =>
      Object.fromEntries(
        CATEGORIES.map((c) => [c.key, !c.defaultOpen]),
      ) as Record<CategoryKey, boolean>,
  )
  const [bearing, setBearing] = useState(-20)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [quartieri, setQuartieri] = useState<QuartiereFeature[] | null>(null)
  const [selectedQuartiere, setSelectedQuartiere] = useState<number | null>(
    null,
  )
  const [layerPanelOpen, setLayerPanelOpen] = useState(true)
  const [zonePanelOpen, setZonePanelOpen] = useState(false)
  // Ref aggiornato a `currentTime`: serve dentro callback registrate al
  // mount (basemap switch, addCustomLayers) per leggere SEMPRE l'ora
  // corrente senza ricreare la mappa.
  const currentTimeRef = useRef<Date>(new Date(2026, 5, 21, 12, 0, 0))

  // Carica gli alberi una volta sola: prova prima il dataset OSM (Overpass),
  // fallback al DBTR clippato all'AOI.
  useEffect(() => {
    let cancelled = false
    const tryFetch = async (url: string) => {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<{
        features: { geometry: { coordinates: [number, number] } }[]
      }>
    }
    tryFetch(TREES_OSM_URL)
      .catch(() => tryFetch(TREES_DBTR_URL))
      .then((fc) => {
        if (cancelled) return
        setTrees(
          fc.features.map((f) => ({
            position: f.geometry.coordinates,
            seed: hashSeed(f.geometry.coordinates[0], f.geometry.coordinates[1]),
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setTrees([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Carica la serie temperatura una volta sola.
  useEffect(() => {
    let cancelled = false
    loadTemperatureSeries().then((records) => {
      if (!cancelled) setTempRecords(records)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Probe asset processati (altezze edifici da DSM, overlay vento). Se i file
  // non esistono ancora -- l'utente non ha lanciato gli script di build --
  // i layer ricadono sul footprint base / niente overlay.
  useEffect(() => {
    let cancelled = false
    fetch(BUILDINGS_HEIGHTS_URL, { method: 'HEAD' })
      .then((r) => {
        if (!cancelled && r.ok) setBuildingsUrl(BUILDINGS_HEIGHTS_URL)
      })
      .catch(() => {})
    // Stazioni qualita' aria: carico il geojson (se esiste) e lo metto in
    // stato; i marker DOM vengono creati da un effect dedicato.
    fetch(AIR_STATIONS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (cancelled || !fc || !Array.isArray(fc.features)) return
        setAirStations(fc.features as AirStation[])
      })
      .catch(() => {})
    // Overlay microclima ENVI-met (output di build_envimet_overlays.py). Se il
    // file non c'e' ancora, i toggle 'Microclima' restano disabilitati.
    fetch(ENVIMET_OVERLAYS_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (cancelled || !meta || !Array.isArray(meta.overlays)) return
        envimetRef.current = meta.overlays as EnvimetOverlay[]
        setEnvimetOverlays(meta.overlays as EnvimetOverlay[])
        const map = mapRef.current
        if (map && map.isStyleLoaded()) reapplyRef.current?.()
      })
      .catch(() => {})
    fetch(WIND_META_URL)
      .then((r) => {
        if (!r.ok) {
          console.warn('[wind] meta fetch', r.status, WIND_META_URL)
          return null
        }
        return r.json()
      })
      .then((meta) => {
        if (cancelled || !meta) return
        if (
          meta.image &&
          Array.isArray(meta.coordinates) &&
          meta.coordinates.length === 4 &&
          meta.bounds &&
          typeof meta.minmax_observed === 'string'
        ) {
          const [lo, hi] = meta.minmax_observed.split(',').map(Number)
          console.log(
            '[wind] meta loaded, bounds',
            meta.bounds,
            'range',
            lo,
            hi,
          )
          setWindOverlay({
            png: withBase(meta.image),
            coordinates: meta.coordinates,
            bounds: meta.bounds,
            range: { min: lo, max: hi },
          })
        }
      })
      .catch((err) => console.warn('[wind] meta error', err))
    return () => {
      cancelled = true
    }
  }, [])

  // Costruisce il sampler del vento appena windOverlay (meta + PNG) e' carico.
  // Una volta sola; sopravvive ai re-render via ref.
  useEffect(() => {
    if (!windOverlay) return
    let cancelled = false
    buildWindSampler({
      bounds: windOverlay.bounds,
      range: windOverlay.range,
      imageUrl: windOverlay.png,
    })
      .then((s) => {
        if (!cancelled) {
          windSamplerRef.current = s
          setSamplersReady((v) => v + 1)
        }
      })
      .catch((err) => console.warn('[wind] sampler build', err))
    return () => {
      cancelled = true
      windSamplerRef.current = null
    }
  }, [windOverlay])

  // Carica (lazy) i sampler ENVI-met per gli overlay attualmente accesi, e
  // calcola i valori al punto cliccato. Vedi lib/envimet.ts per il
  // posizionamento sul dominio ruotato.
  useEffect(() => {
    const overlays = envimetOverlays ?? []
    let cancelled = false
    for (const o of overlays) {
      const on = visibility[envLayerId(o.key) as LayerKey]
      if (!on || envRequestedRef.current.has(o.key)) continue
      envRequestedRef.current.add(o.key)
      fetch(withBase(o.values))
        .then((r) => (r.ok ? r.json() : null))
        .then((grid) => {
          if (cancelled || !grid) return
          envSamplersRef.current[o.key] = buildEnvimetSampler(
            o.coordinates,
            grid,
          )
          setSamplersReady((v) => v + 1)
        })
        .catch(() => {
          envRequestedRef.current.delete(o.key)
        })
    }
    return () => {
      cancelled = true
    }
  }, [visibility, envimetOverlays])

  // Deriva i valori al punto cliccato dai layer attivi + sampler pronti.
  useEffect(() => {
    if (!probe) {
      setPointWind(null)
      setPointEnv([])
      return
    }
    const { lat, lon } = probe
    setPointWind(
      visibility['wind'] && windSamplerRef.current
        ? windSamplerRef.current(lon, lat)
        : null,
    )
    const active = (envimetRef.current ?? []).filter(
      (o) => visibility[envLayerId(o.key) as LayerKey],
    )
    setPointEnv(
      active.map((o) => ({
        key: o.key,
        label: o.label,
        unit: o.unit,
        value: envSamplersRef.current[o.key]?.(lon, lat) ?? null,
      })),
    )
  }, [probe, visibility, envimetOverlays, samplersReady])

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
        'width:15px;height:15px;border-radius:50%;background:#22d3ee;' +
        'border:2px solid #0e7490;box-shadow:0 0 8px 3px rgba(34,211,238,.45);' +
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

  // Aggiorna la lookup temperatura quando cambia il punto cliccato o la data.
  useEffect(() => {
    if (!probe || !tempRecords) {
      setTempLookup(null)
      return
    }
    setTempLookup(lookupTemperature(tempRecords, currentTime))
  }, [probe, tempRecords, currentTime])

  // Segnaposto del punto cliccato (stile Google Maps): un pin ambra sul
  // punto selezionato. Si sposta al click successivo e sparisce alla
  // chiusura dell'InfoPanel (probe -> null).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!probe) {
      probeMarkerRef.current?.remove()
      probeMarkerRef.current = null
      return
    }
    if (!probeMarkerRef.current) {
      // Colore del brand UrbanScope3D (text-cyan-400 = #22d3ee).
      const marker = new maplibregl.Marker({ color: '#22d3ee' })
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
  }, [probe])

  // Costruzione mappa.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAPS[basemap].style,
      center: AOI_CENTER,
      zoom: 14,
      minZoom: 12,
      maxZoom: 19,
      pitch: 60,
      bearing: -20,
      // Stile streets.gl: LMB pan, RMB drag yaw+pitch (default MapLibre,
      // ribadito esplicitamente). 75 e' il sweet spot: taglio cinematico
      // senza il costo extra del sky fog vicino orizzonte (85 lag su
      // GPU integrate).
      maxPitch: 75,
      dragRotate: true,
      pitchWithRotate: true,
      maxBounds: [
        [11.25, 44.45],
        [11.45, 44.55],
      ],
    })

    // Aggiunge tutti i layer custom alla mappa. Idempotente (controlla
    // map.getLayer prima di addLayer) cosi' puo' essere richiamata dopo
    // map.setStyle() per re-installare i layer sul nuovo stile.
    const addCustomLayers = () => {
      const initialVis = (id: LayerKey) =>
        visibility[id] ? 'visible' : 'none'

      if (!map.getSource('landuse')) {
        map.addSource('landuse', { type: 'geojson', data: LANDUSE_URL })
      }
      if (!map.getLayer('land-use')) {
        map.addLayer({
          id: 'land-use',
          source: 'landuse',
          type: 'fill',
          paint: {
            'fill-color': 'rgba(180, 130, 80, 0.25)',
            'fill-outline-color': 'rgba(220, 170, 110, 0.6)',
          },
          layout: { visibility: initialVis('land-use') },
        })
      }

      if (!map.getSource('buildings-particellari')) {
        map.addSource('buildings-particellari', {
          type: 'geojson',
          data: BUILDINGS_FOOTPRINT_URL,
        })
      }
      if (!map.getLayer('buildings-particellari')) {
        map.addLayer({
          id: 'buildings-particellari',
          source: 'buildings-particellari',
          type: 'fill',
          paint: {
            'fill-color': 'rgba(120, 160, 200, 0.35)',
            'fill-outline-color': 'rgba(150, 200, 240, 0.9)',
          },
          layout: { visibility: initialVis('buildings-particellari') },
        })
      }

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

      // Parchi pubblici (DBTR / Open Data Bologna 2.1)
      if (!map.getSource('parks')) {
        map.addSource('parks', { type: 'geojson', data: PARKS_URL })
      }
      if (!map.getLayer('parks')) {
        map.addLayer({
          id: 'parks',
          source: 'parks',
          type: 'fill',
          paint: {
            'fill-color': 'rgba(56, 175, 90, 0.55)',
            'fill-outline-color': 'rgba(20, 100, 50, 0.9)',
          },
          layout: { visibility: initialVis('parks') },
        })
      }

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

      // Overlay microclima ENVI-met: una image source per variabile, sul
      // dominio ruotato (4 angoli). Stanno sotto agli edifici 3D (beforeId),
      // resampling 'nearest' per non sfumare i blocchi 3x3 m. Visibilita'
      // iniziale 'none', gestita dal toggle effect.
      const envBeforeId = map.getLayer('osm-buildings-context')
        ? 'osm-buildings-context'
        : undefined
      for (const o of envimetRef.current ?? []) {
        const id = envLayerId(o.key)
        if (!map.getSource(id)) {
          map.addSource(id, {
            type: 'image',
            url: withBase(o.image),
            coordinates: o.coordinates,
          })
        }
        if (!map.getLayer(id)) {
          map.addLayer(
            {
              id,
              source: id,
              type: 'raster',
              paint: {
                'raster-opacity': 0.82,
                'raster-resampling': 'nearest',
              },
              layout: {
                visibility: visibility[id as LayerKey] ? 'visible' : 'none',
              },
            },
            envBeforeId,
          )
        }
      }

      // Stazioni qualita' aria: NON sono piu' layer MapLibre (verrebbero
      // occluse dagli edifici 3D deck.gl, che disegnano sopra tutto). Sono
      // marker DOM (vedi effect dedicato), sempre in primo piano.
    }

    // Lo stile dark-matter (CartoCDN) ha background nero: sui bordi dei
    // tile / aree senza dati l'orizzonte si confonde col cielo notturno
    // e col buio overlay. Lo sovrascriviamo con un verde "campagna"
    // dark, cosi' il terreno arriva fino allo skybox. Negli altri stili
    // (light, satellite, ortofoto) non tocchiamo.
    const tintBackgroundIfDark = (id: BasemapId) => {
      if (id !== 'dark') return
      if (map.getLayer('background')) {
        map.setPaintProperty(
          'background',
          'background-color',
          toCss(BOLOGNA_FOREST_DARK),
        )
      }
    }

    map.on('load', () => {
      addCustomLayers()
      tintBackgroundIfDark(basemap)
      reapplyRef.current = addCustomLayers

      const overlay = new MapboxOverlay({
        interleaved: false,
        effects: [
          buildLightingEffect(
            currentTime.getTime(),
            visibility['shadows'] && visibility['buildings-3d'],
          ),
        ],
        layers: [
          buildShadowBuildingsLayer(
            LAYERS.find((l) => l.id === 'buildings-3d')!.default,
            buildingsUrl,
            null,
          ),
          ...buildTreesLayers(
            LAYERS.find((l) => l.id === 'trees')!.default,
            trees,
          ),
        ].filter(Boolean) as Layer[],
      })
      map.addControl(overlay as unknown as maplibregl.IControl)
      overlayRef.current = overlay

      const sun0 = getSunPosition(currentTime, AOI_CENTER[1], AOI_CENTER[0])
      map.setLight(toMapLibreLight(sun0))
      map.setSky(computeSky(sun0.altitudeDeg))

      map.on('click', (e) => {
        // I valori (vento / microclima) sono derivati in un effect dai layer
        // attivi: qui registro solo il punto.
        setProbe({ lat: e.lngLat.lat, lon: e.lngLat.lng })
      })

      // Rumore: hover su una strada -> tooltip con i dB + hiss audio
      // proporzionale (Web Audio). L'AudioContext si crea/riprende solo
      // all'hover (serve un gesto utente per la policy autoplay).
      const ensureNoiseAudio = () => {
        if (audioRef.current) return audioRef.current
        try {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext
          const ctx = new Ctx()
          const n = 2 * ctx.sampleRate
          const buffer = ctx.createBuffer(1, n, ctx.sampleRate)
          const ch = buffer.getChannelData(0)
          let last = 0
          for (let i = 0; i < n; i++) {
            const white = Math.random() * 2 - 1
            last = (last + 0.02 * white) / 1.02 // rumore "rosa" approssimato
            ch[i] = last * 3.5
          }
          const src = ctx.createBufferSource()
          src.buffer = buffer
          src.loop = true
          const gain = ctx.createGain()
          gain.gain.value = 0
          src.connect(gain)
          gain.connect(ctx.destination)
          src.start(0)
          audioRef.current = { ctx, gain }
        } catch {
          return null
        }
        return audioRef.current
      }

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
        const a = ensureNoiseAudio()
        if (a) {
          if (a.ctx.state === 'suspended') a.ctx.resume()
          const g = Math.max(0, Math.min(1, (db - 42) / 36)) * 0.32
          a.gain.gain.setTargetAtTime(g, a.ctx.currentTime, 0.05)
        }
      })
      map.on('mouseleave', 'noise', () => {
        map.getCanvas().style.cursor = ''
        noiseTipRef.current?.remove()
        const a = audioRef.current
        if (a) a.gain.gain.setTargetAtTime(0, a.ctx.currentTime, 0.1)
      })

      const syncBearing = () => setBearing(map.getBearing())
      map.on('rotate', syncBearing)
      map.on('moveend', syncBearing)
      syncBearing()

      setLoading(false)
    })

    mapRef.current = map

    return () => {
      noiseTipRef.current?.remove()
      noiseTipRef.current = null
      audioRef.current?.ctx.close().catch(() => {})
      audioRef.current = null
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

  // Aggiunge il source/layer del vento quando arriva la meta (one-shot).
  // Uso 'idle' (non 'load') perche' load si emette una volta sola: se questo
  // effect monta dopo che la map ha gia' caricato, once('load') non parte mai.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !windOverlay || windAddedRef.current) return
    const register = () => {
      if (windAddedRef.current || map.getSource('wind')) return
      map.addSource('wind', {
        type: 'image',
        url: windOverlay.png,
        coordinates: windOverlay.coordinates,
      })
      // Lo metto sotto agli edifici 3D OSM: il vento e' una mappa di sfondo,
      // gli edifici 3D restano in primo piano.
      const beforeId = map.getLayer('osm-buildings-context')
        ? 'osm-buildings-context'
        : undefined
      map.addLayer(
        {
          id: 'wind',
          source: 'wind',
          type: 'raster',
          paint: {
            'raster-opacity': 0.85,
            // Boost contrast/saturation: il raster ha range 0-3 m/s a Bologna,
            // tutti i pixel sono nella fascia viola scura della colormap viridis
            // e su una basemap dark-matter si vedono poco. Saturazione +
            // brightness rendono le sfumature percepibili.
            'raster-saturation': 0.5,
            'raster-contrast': 0.3,
          },
          layout: { visibility: visibility['wind'] ? 'visible' : 'none' },
        },
        beforeId,
      )
      console.log('[wind] layer added, opacity 0.85, beforeId', beforeId)
      windAddedRef.current = true
    }
    if (map.isStyleLoaded()) register()
    else map.once('idle', register)
  }, [windOverlay, visibility])

  // Toggle layer + propagazione dati alberi/altezze quando cambiano.
  useEffect(() => {
    const map = mapRef.current
    const overlay = overlayRef.current
    if (!map) return
    const apply = () => {
      const maplibre3d = visibility['buildings-3d'] ? 'visible' : 'none'
      const envIds = (envimetRef.current ?? []).map((o) =>
        envLayerId(o.key),
      ) as LayerKey[]
      for (const id of [
        'land-use',
        'buildings-particellari',
        'green-areas',
        'parks',
        'private-green',
        'wind',
        'noise',
        ...envIds,
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
      if (overlay) {
        // Se 'buildings-temp' e' attivo, coloro ogni edificio per la sua
        // `air_temp` (campionata da ENVI-met dalla pipeline) normalizzata sul
        // range dell'overlay temperatura. Spaziale, non piu' city-wide:
        // edifici dentro al dominio ENVI-met colorati giallo->rosso, gli
        // altri grigi.
        let tempRange: { min: number; max: number } | null = null
        if (visibility['buildings-temp']) {
          const tempOv = (envimetRef.current ?? []).find(
            (o) => o.key === 'temperature',
          )
          tempRange = tempOv ? tempOv.range : { min: 29, max: 37 }
        }
        overlay.setProps({
          // Effetti (sole+ombre) e layer settati INSIEME: un solo redraw,
          // niente edifici che spariscono quando si spengono le ombre.
          effects: [
            buildLightingEffect(
              currentTime.getTime(),
              visibility['shadows'] && visibility['buildings-3d'],
            ),
          ],
          layers: [
            buildShadowBuildingsLayer(
              // Mostro gli edifici estrusi se e' attivo il 3D OPPURE la
              // colorazione per temperatura (cosi' 'buildings-temp' funziona
              // anche da solo).
              visibility['buildings-3d'] || visibility['buildings-temp'],
              buildingsUrl,
              tempRange,
            ),
            ...buildTreesLayers(visibility['trees'], trees),
          ].filter(Boolean) as Layer[],
        })
        // Cambiare `_shadow` ri-inizializza il modulo ombre di deck.gl senza
        // ridisegnare da solo: senza questo redraw forzato gli edifici
        // sparivano (frame vuoto) finche' non muovevi la mappa.
        map.triggerRepaint()
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once('idle', apply)
  }, [visibility, trees, buildingsUrl, tempRecords, currentTime, envimetOverlays])

  // Basemap switcher: setStyle distrugge i source/layer custom, quindi dopo
  // 'style.load' ri-eseguo addCustomLayers (registrata in reapplyRef).
  // Il flag windAddedRef viene resettato cosi' anche l'overlay vento viene
  // ricreato sul nuovo stile.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(BASEMAPS[basemap].style)
    map.once('style.load', () => {
      reapplyRef.current?.()
      windAddedRef.current = false
      // Sole + luce + cielo vengono persi nello swap, ricomputo
      // sull'ora corrente letta dal ref (potrebbe essere cambiata dopo
      // il mount).
      const now = currentTimeRef.current
      const sun = getSunPosition(now, AOI_CENTER[1], AOI_CENTER[0])
      map.setLight(toMapLibreLight(sun))
      map.setSky(computeSky(sun.altitudeDeg))
      // Vedi `tintBackgroundIfDark` nel mount effect: stesso motivo,
      // qui rieseguito perche' setStyle ricarica il background nero
      // originale di dark-matter.
      if (basemap === 'dark' && map.getLayer('background')) {
        map.setPaintProperty(
          'background',
          'background-color',
          toCss(BOLOGNA_FOREST_DARK),
        )
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const jumpToQuartiere = (f: QuartiereFeature) => {
    const map = mapRef.current
    if (!map) return
    const [minlon, minlat, maxlon, maxlat] = f.properties.bbox
    const cx = (minlon + maxlon) / 2
    const cy = (minlat + maxlat) / 2
    map.flyTo({ center: [cx, cy], zoom: 15, bearing: 0, duration: 1500 })
    setSelectedQuartiere(f.properties.cod_quar)
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
  const nightOverlayOpacity = currentNightFactor * 0.55

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
      const url =
        'https://nominatim.openstreetmap.org/search?format=jsonv2' +
        '&limit=5&bounded=1&viewbox=11.25,44.55,11.45,44.45&q=' +
        encodeURIComponent(`${q}, Bologna, Italia`)
      const r = await fetch(url, { headers: { 'Accept-Language': 'it' } })
      const data: { display_name: string; lat: string; lon: string }[] =
        await r.json()
      const addresses: SearchResult[] = data.map((d) => ({
        type: 'address' as const,
        label: d.display_name,
        lat: Number(d.lat),
        lon: Number(d.lon),
      }))
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
      const [minlon, minlat, maxlon, maxlat] = res.bbox
      map.fitBounds(
        [
          [minlon, minlat],
          [maxlon, maxlat],
        ],
        { padding: 80, pitch: 55, duration: 1200 },
      )
      setSelectedQuartiere(res.cod_quar)
      searchMarkerRef.current?.remove()
      searchMarkerRef.current = null
    } else {
      map.flyTo({ center: [res.lon, res.lat], zoom: 16, duration: 1200 })
      searchMarkerRef.current?.remove()
      searchMarkerRef.current = new maplibregl.Marker({ color: '#22d3ee' })
        .setLngLat([res.lon, res.lat])
        .addTo(map)
    }
    setSearchResults([])
    setSearch(res.label.split(',')[0])
  }

  return (
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-950 gap-4">
          <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-cyan-400 tracking-widest text-sm font-mono uppercase">
            {t('loading', lang)}
          </p>
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

      {/* Search bar sticky, sempre visibile in alto */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-[min(420px,80vw)]">
        <form
          onSubmit={runSearch}
          className="flex items-center gap-2 bg-gray-900/90 border border-cyan-400/30 rounded px-3 py-2 backdrop-blur-sm shadow-xl"
        >
          <span className="text-cyan-400/70 text-sm">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder', lang)}
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder:text-gray-500 outline-none font-mono"
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
              className="text-gray-500 hover:text-cyan-300 text-sm"
              aria-label={t('clearSearch', lang)}
            >
              ✕
            </button>
          )}
          <button
            type="submit"
            disabled={searching}
            className="text-cyan-300 hover:text-cyan-200 text-xs font-mono uppercase tracking-wider disabled:text-gray-600"
          >
            {searching ? '...' : t('go', lang)}
          </button>
        </form>
        {searchResults.length > 0 && (
          <ul className="mt-1 bg-gray-900/95 border border-cyan-400/30 rounded backdrop-blur-sm shadow-xl overflow-hidden">
            {searchResults.map((res, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => gotoResult(res)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-cyan-400/10 hover:text-cyan-200 transition-colors border-b border-cyan-400/10 last:border-0 ${
                    res.type === 'quartiere'
                      ? 'text-cyan-300 font-mono'
                      : 'text-gray-200'
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
          <div className="mt-1 flex items-center justify-between bg-cyan-400/15 border border-cyan-400/40 rounded px-3 py-1.5 text-xs font-mono text-cyan-200 backdrop-blur-sm">
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
              className="text-cyan-300 hover:text-cyan-100 ml-2"
              aria-label={t('deselectQuartiere', lang)}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Bussola: il quadrante ruota con il bearing, click = riallinea a Nord.
          Ingrandita rispetto a prima (era w-12 h-12). 'O' (ovest) in IT,
          'W' in EN. */}
      <button
        type="button"
        onClick={resetNorth}
        title={t('resetNorth', lang)}
        className="absolute top-4 right-2 sm:right-4 z-10 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gray-900/85 border border-cyan-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center hover:border-cyan-400/60 transition-colors"
      >
        <div
          className="relative w-12 h-12"
          style={{ transform: `rotate(${-bearing}deg)` }}
        >
          <span className="absolute top-0 left-1/2 -translate-x-1/2 text-sm font-bold text-red-400 leading-none">
            N
          </span>
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs font-mono text-gray-300 leading-none">
            S
          </span>
          <span className="absolute left-0 top-1/2 -translate-y-1/2 text-xs font-mono text-gray-300 leading-none">
            {lang === 'it' ? 'O' : 'W'}
          </span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 text-xs font-mono text-gray-300 leading-none">
            E
          </span>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-5 bg-gradient-to-b from-red-400 to-gray-500 rounded" />
        </div>
      </button>

      {/* Toggle pannello Zone, a fianco (destra) della barra di ricerca. Il
          `left` e' calcolato dal bordo destro della search bar centrata
          (meta' larghezza = min(210px,40vw)) + un gap. */}
      {quartieri && (
        <button
          type="button"
          onClick={() => setZonePanelOpen((v) => !v)}
          title={zonePanelOpen ? t('hideZones', lang) : t('showZones', lang)}
          style={{ left: 'calc(50% + min(210px, 40vw) + 0.5rem)' }}
          className="absolute top-4 z-20 px-2.5 py-2 rounded bg-gray-900/90 border border-cyan-400/30 backdrop-blur-sm shadow-xl text-cyan-300 hover:text-cyan-100 hover:border-cyan-400/60 transition-colors text-[11px] font-mono uppercase tracking-widest flex items-center gap-1.5"
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
          style={{ left: 'calc(50% + min(210px, 40vw) + 0.5rem)' }}
          className="absolute top-16 z-10 bg-gray-900/85 border border-cyan-400/30 rounded p-1.5 sm:p-2 backdrop-blur-sm shadow-xl max-w-[60vw] sm:max-w-[200px]"
        >
          <div className="flex flex-col gap-1">
            {/* Voce "Bologna": inquadra l'intera citta' (unione dei quartieri). */}
            <button
              onClick={jumpToCity}
              className="text-left text-xs font-mono px-2 py-1 rounded transition-colors truncate text-cyan-300 font-bold hover:text-cyan-100 hover:bg-cyan-400/10 border-b border-cyan-400/20 mb-0.5"
              title="Bologna (intera città)"
            >
              ▣ Bologna
            </button>
            {quartieri.map((f) => (
              <button
                key={f.properties.cod_quar}
                onClick={() => jumpToQuartiere(f)}
                className="text-left text-xs font-mono px-2 py-1 rounded transition-colors truncate text-gray-300 hover:text-cyan-300 hover:bg-cyan-400/10 border border-transparent"
                title={f.properties.quartiere}
              >
                {f.properties.quartiere}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toggle del pannello layer: stesso pattern di Zone, chevron
          rotante a 90°. Sempre visibile, utile soprattutto su mobile
          dove il pannello aperto coprirebbe meta' schermo. */}
      <button
        type="button"
        onClick={() => setLayerPanelOpen((v) => !v)}
        title={layerPanelOpen ? t('hideLayers', lang) : t('showLayers', lang)}
        className="absolute top-20 left-2 sm:left-4 z-20 px-2.5 py-1.5 rounded bg-gray-900/85 border border-cyan-400/30 backdrop-blur-sm shadow-xl text-cyan-300 hover:text-cyan-100 hover:border-cyan-400/60 transition-colors text-[11px] font-mono uppercase tracking-widest flex items-center gap-1.5"
        aria-label="Toggle layer panel"
      >
        <span
          className="inline-block transition-transform duration-200"
          style={{
            transform: layerPanelOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▸
        </span>
        {t('layer', lang)}
      </button>

      <div
        className={`absolute top-32 sm:top-32 left-2 sm:left-4 z-10 bg-gray-900/85 border border-cyan-400/30 rounded p-2 sm:p-3 backdrop-blur-sm shadow-xl ${
          layerPanelOpen ? '' : 'hidden'
        }`}
      >
        <div className="flex flex-col gap-1 min-w-[160px] sm:min-w-[220px] max-h-[55vh] sm:max-h-[60vh] overflow-y-auto">
          {CATEGORIES.map((cat) => {
            const items = LAYERS.filter((l) => l.category === cat.key)
            if (items.length === 0) return null
            const isCollapsed = collapsed[cat.key]
            const activeCount = items.filter((l) => visibility[l.id]).length
            return (
              <div key={cat.key} className="border-b border-cyan-400/10 last:border-0 pb-1 mb-0.5">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [cat.key]: !c[cat.key] }))
                  }
                  className="w-full flex items-center justify-between text-left text-[11px] font-mono uppercase tracking-wider text-cyan-300/90 hover:text-cyan-200 py-1"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-cyan-400/70 w-3 inline-block">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    {t(cat.labelKey, lang)}
                  </span>
                  <span className="text-gray-500 text-[10px]">
                    {activeCount}/{items.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="flex flex-col gap-1.5 pl-4 pt-1 pb-1">
                    {items.map((l) => {
                      const isEnv = l.id.startsWith('env-')
                      const disabled =
                        (l.id === 'wind' && !windOverlay) ||
                        (isEnv && !envimetOverlays) ||
                        (l.id === 'air-stations' && !airStations) ||
                        (l.id === 'shadows' && !visibility['buildings-3d'])
                      const label = l.rawLabel ?? (l.labelKey ? t(l.labelKey, lang) : l.id)
                      return (
                        <label
                          key={l.id}
                          title={
                            disabled
                              ? isEnv
                                ? 'Lancia scripts/build_envimet_overlays.py per generare gli overlay'
                                : 'Lancia scripts/build_wind_overlay.sh per generare l’overlay'
                              : undefined
                          }
                          className={`flex items-center gap-2 text-sm transition-colors ${
                            disabled
                              ? 'text-gray-500 cursor-not-allowed'
                              : 'text-gray-200 cursor-pointer hover:text-cyan-300'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={visibility[l.id]}
                            onChange={(e) =>
                              setVisibility((v) => ({
                                ...v,
                                [l.id]: e.target.checked,
                              }))
                            }
                            className="accent-cyan-400 cursor-pointer disabled:cursor-not-allowed"
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
        <div className="text-gray-500 text-[10px] font-mono mt-2 italic">
          {lang === 'it'
            ? 'click sulla mappa → temperatura / vento'
            : 'click on the map → temperature / wind'}
        </div>
      </div>

      <div className="absolute bottom-24 right-2 sm:right-4 z-10 bg-gray-900/85 border border-cyan-400/30 rounded p-1.5 sm:p-2 backdrop-blur-sm shadow-xl">
        <div className="text-cyan-400 text-[10px] font-mono uppercase tracking-widest mb-1.5 px-1">
          {t('basemap', lang)}
        </div>
        <div className="flex flex-col gap-1">
          {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
            <button
              key={id}
              onClick={() => setBasemap(id)}
              className={`text-left text-xs font-mono px-2 py-1 rounded transition-colors ${
                basemap === id
                  ? 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/50'
                  : 'text-gray-300 hover:text-cyan-300 hover:bg-cyan-400/10 border border-transparent'
              }`}
            >
              {BASEMAPS[id].label}
            </button>
          ))}
        </div>
      </div>

      <TimeSlider
        value={currentTime}
        onChange={setCurrentTime}
        lat={AOI_CENTER[1]}
        lon={AOI_CENTER[0]}
        lang={lang}
      />

      {/* Colonna in alto a destra: prima le info del punto cliccato, poi la
          legenda (overlay microclima + scala temperatura edifici) SOTTO. */}
      {(() => {
        const activeEnv = (envimetOverlays ?? []).filter(
          (o) => visibility[envLayerId(o.key) as LayerKey],
        )
        const tempOv = (envimetOverlays ?? []).find((o) => o.key === 'temperature')
        const showBuildingTemp = visibility['buildings-temp']
        const showNoise = visibility['noise']
        const showLegend = activeEnv.length > 0 || showBuildingTemp || showNoise
        if (!probe && !showLegend) return null
        const NOISE_GRAD = '#22c55e, #84cc16, #eab308, #f97316, #ef4444'
        const gradient = (stops: { color: string }[]) =>
          `linear-gradient(to right, ${stops.map((s) => s.color).join(', ')})`
        return (
          <div className="absolute top-20 right-2 sm:right-4 z-10 flex flex-col gap-2 w-[min(260px,calc(100vw-1rem))] max-h-[calc(100vh-7rem)] overflow-y-auto">
            {probe && (
              <InfoPanel
                lat={probe.lat}
                lon={probe.lon}
                date={currentTime}
                temp={tempLookup}
                loading={!tempRecords}
                windSpeed={pointWind}
                envSamples={pointEnv}
                lang={lang}
                onClose={() => setProbe(null)}
              />
            )}
            {showLegend && (
              <div className="bg-gray-900/85 border border-cyan-400/30 rounded p-2 backdrop-blur-sm shadow-xl">
                <div className="text-cyan-400 text-[10px] font-mono uppercase tracking-widest mb-1.5 px-0.5">
                  {t('legend', lang)}
                </div>
                <div className="flex flex-col gap-2">
                  {showBuildingTemp && tempOv && (
                    <div>
                      <div className="text-gray-200 text-[11px] font-mono mb-0.5">
                        {lang === 'it' ? 'Edifici · temperatura' : 'Buildings · temperature'} ({tempOv.unit})
                      </div>
                      <div
                        className="h-2 rounded"
                        style={{ background: gradient(tempOv.legend) }}
                      />
                      <div className="flex justify-between text-gray-400 text-[10px] font-mono mt-0.5">
                        <span>{tempOv.range.min}</span>
                        <span>{tempOv.range.max}</span>
                      </div>
                      <div className="flex items-center gap-1 text-gray-500 text-[10px] font-mono mt-0.5">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm"
                          style={{ background: 'rgb(120,124,130)' }}
                        />
                        {lang === 'it' ? 'fuori dominio ENVI-met' : 'outside ENVI-met domain'}
                      </div>
                    </div>
                  )}
                  {showNoise && (
                    <div>
                      <div className="text-gray-200 text-[11px] font-mono mb-0.5">
                        {lang === 'it' ? 'Rumore (stima)' : 'Noise (est.)'} (dB)
                      </div>
                      <div
                        className="h-2 rounded"
                        style={{ background: `linear-gradient(to right, ${NOISE_GRAD})` }}
                      />
                      <div className="flex justify-between text-gray-400 text-[10px] font-mono mt-0.5">
                        <span>50</span>
                        <span>78</span>
                      </div>
                    </div>
                  )}
                  {activeEnv.map((o) => (
                    <div key={o.key}>
                      <div className="text-gray-200 text-[11px] font-mono mb-0.5">
                        {o.label} ({o.unit})
                      </div>
                      <div
                        className="h-2 rounded"
                        style={{ background: gradient(o.legend) }}
                      />
                      <div className="flex justify-between text-gray-400 text-[10px] font-mono mt-0.5">
                        <span>{o.range.min}</span>
                        <span>{o.range.max}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
