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
import { SphereGeometry } from '@luma.gl/engine'
import { getSunPosition, toMapLibreLight } from '@/lib/sun'
import { computeSky, nightFactor } from '@/lib/sky'
import { buildWindSampler, type WindSampler } from '@/lib/wind'
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

type LayerKey =
  | 'land-use'
  | 'buildings-particellari'
  | 'buildings-3d'
  | 'buildings-temp'
  | 'trees'
  | 'green-areas'
  | 'parks'
  | 'private-green'
  | 'air-stations'
  | 'wind'

type CategoryKey = 'edifici' | 'verde' | 'ambiente' | 'territorio'

const CATEGORIES: {
  key: CategoryKey
  labelKey: StringKey
  defaultOpen: boolean
}[] = [
  { key: 'edifici', labelKey: 'cat_edifici', defaultOpen: true },
  { key: 'verde', labelKey: 'cat_verde', defaultOpen: true },
  { key: 'ambiente', labelKey: 'cat_ambiente', defaultOpen: false },
  { key: 'territorio', labelKey: 'cat_territorio', defaultOpen: false },
]

const LAYERS: {
  id: LayerKey
  labelKey: StringKey
  default: boolean
  category: CategoryKey
}[] = [
  { id: 'buildings-3d', labelKey: 'layer_buildings_3d', default: true, category: 'edifici' },
  { id: 'buildings-particellari', labelKey: 'layer_buildings_2d', default: false, category: 'edifici' },
  { id: 'buildings-temp', labelKey: 'layer_buildings_temp', default: false, category: 'edifici' },
  { id: 'trees', labelKey: 'layer_trees', default: true, category: 'verde' },
  { id: 'green-areas', labelKey: 'layer_green', default: true, category: 'verde' },
  { id: 'parks', labelKey: 'layer_parks', default: false, category: 'verde' },
  { id: 'private-green', labelKey: 'layer_private_green', default: false, category: 'verde' },
  { id: 'air-stations', labelKey: 'layer_air', default: false, category: 'ambiente' },
  { id: 'wind', labelKey: 'layer_wind', default: false, category: 'ambiente' },
  { id: 'land-use', labelKey: 'layer_landuse', default: false, category: 'territorio' },
]

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

// Albero stilizzato: tronco cilindrico + chioma sferica (no asset esterni).
const TRUNK_HEIGHT = 3.2
const TRUNK_RADIUS = 0.32
const CANOPY_RADIUS = 2.6
const CANOPY_GEOMETRY = new SphereGeometry({
  radius: 1,
  nlat: 14,
  nlong: 14,
})

type TreePoint = { position: [number, number]; seed: number }

// Hash deterministico per dare un po' di variazione (scala + tonalita') a
// ogni albero senza fare flicker tra render.
function hashSeed(lon: number, lat: number): number {
  const x = Math.sin(lon * 12.9898 + lat * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function buildLightingEffect(timestamp: number): LightingEffect {
  const sun = new SunLight({
    timestamp,
    color: [255, 255, 255],
    intensity: 1.5,
    _shadow: true,
  })
  const ambient = new AmbientLight({
    color: [255, 255, 255],
    intensity: 1.0,
  })
  const effect = new LightingEffect({ sun, ambient })
  ;(effect as unknown as { shadowColor: number[] }).shadowColor = [
    0, 0, 0, 0.45,
  ]
  return effect
}

type BuildingFeature = {
  properties?: { height?: number } | null
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

// Mappatura temperatura aria -> RGB. 3 stop (cool/temperate/hot)
// con interpolazione lineare. Range scelto per Bologna (storico ~5-35 C).
function tempToColor(tempC: number): [number, number, number] {
  const COOL: [number, number, number] = [56, 132, 220] // blue-500ish
  const MILD: [number, number, number] = [234, 200, 100] // warm gold
  const HOT: [number, number, number] = [220, 60, 50] // tomato red
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)
  const lerp3 = (
    A: [number, number, number],
    B: [number, number, number],
    t: number,
  ): [number, number, number] => [
    lerp(A[0], B[0], t),
    lerp(A[1], B[1], t),
    lerp(A[2], B[2], t),
  ]
  if (tempC <= 5) return COOL
  if (tempC >= 35) return HOT
  if (tempC <= 22) return lerp3(COOL, MILD, (tempC - 5) / 17)
  return lerp3(MILD, HOT, (tempC - 22) / 13)
}

function buildShadowBuildingsLayer(
  visible: boolean,
  dataUrl: string,
  tempColorize: number | null,
): GeoJsonLayer | null {
  if (!visible) return null
  const fill =
    tempColorize != null
      ? ([...tempToColor(tempColorize), 240] as [number, number, number, number])
      : withAlpha(BOLOGNA_OCRA, 240)
  return new GeoJsonLayer({
    id: 'buildings-shadow',
    data: dataUrl,
    stroked: true,
    filled: true,
    extruded: true,
    getElevation: (f: BuildingFeature) => {
      const h = f.properties?.height
      return typeof h === 'number' && h > 0 ? h : DEFAULT_BUILDING_HEIGHT
    },
    getFillColor: fill,
    getLineColor: withAlpha(BOLOGNA_SANGIOVESE, 255),
    lineWidthMinPixels: 0.5,
    pickable: false,
    updateTriggers: {
      getFillColor: [tempColorize],
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
  const canopy = new SimpleMeshLayer<TreePoint>({
    id: 'trees-canopy',
    data,
    mesh: CANOPY_GEOMETRY,
    pickable: false,
    getPosition: (d) => d.position,
    // Translation in metri sull'asse z (up): la chioma sta sopra al tronco.
    getTranslation: (d) => [
      0,
      0,
      TRUNK_HEIGHT * (0.85 + d.seed * 0.4) + CANOPY_RADIUS * 0.75,
    ],
    getScale: (d) => {
      const s = CANOPY_RADIUS * (0.8 + d.seed * 0.55)
      return [s, s, s * (0.85 + d.seed * 0.2)]
    },
    getColor: (d) => {
      // Verdi un po' diversi per albero, tono caldo o freddo a seconda del seed.
      const g = 110 + Math.round(d.seed * 50)
      const r = 50 + Math.round(d.seed * 30)
      const b = 55 + Math.round((1 - d.seed) * 35)
      return [r, g, b, 245]
    },
    material: {
      ambient: 0.35,
      diffuse: 0.9,
      shininess: 6,
      specularColor: [50, 80, 50],
    },
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
  const [probe, setProbe] = useState<{
    lat: number
    lon: number
    windSpeed: number | null
  } | null>(null)
  const windSamplerRef = useRef<WindSampler | null>(null)
  const [tempLookup, setTempLookup] = useState<TempLookup | null>(null)
  const [buildingsUrl, setBuildingsUrl] = useState<string>(
    BUILDINGS_FOOTPRINT_URL,
  )
  const [windOverlay, setWindOverlay] = useState<WindOverlay | null>(null)
  const windAddedRef = useRef(false)
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
        if (!cancelled) windSamplerRef.current = s
      })
      .catch((err) => console.warn('[wind] sampler build', err))
    return () => {
      cancelled = true
      windSamplerRef.current = null
    }
  }, [windOverlay])

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

      if (!map.getSource('openmaptiles')) {
        map.addSource('openmaptiles', {
          type: 'vector',
          url: 'https://tiles.openfreemap.org/planet',
        })
      }
      if (!map.getLayer('osm-buildings-context')) {
        map.addLayer({
          id: 'osm-buildings-context',
          source: 'openmaptiles',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': 'rgb(60, 75, 95)',
            'fill-extrusion-height': ['get', 'render_height'],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.85,
          },
          layout: { visibility: visibility['buildings-3d'] ? 'visible' : 'none' },
        })
      }

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

      // Stazioni qualita' aria (output di scripts/join_air_stations.py).
      // Se il file non esiste ancora, MapLibre logga un fetch error ma il
      // viewer continua a funzionare.
      if (!map.getSource('air-stations')) {
        map.addSource('air-stations', {
          type: 'geojson',
          data: AIR_STATIONS_URL,
        })
      }
      if (!map.getLayer('air-stations-glow')) {
        map.addLayer({
          id: 'air-stations-glow',
          source: 'air-stations',
          type: 'circle',
          paint: {
            'circle-radius': 18,
            'circle-color': '#22d3ee',
            'circle-opacity': 0.25,
            'circle-blur': 0.6,
          },
          layout: { visibility: initialVis('air-stations') },
        })
      }
      if (!map.getLayer('air-stations')) {
        map.addLayer({
          id: 'air-stations',
          source: 'air-stations',
          type: 'circle',
          paint: {
            'circle-radius': 6,
            'circle-color': '#22d3ee',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#0e7490',
          },
          layout: { visibility: initialVis('air-stations') },
        })
      }
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
        effects: [buildLightingEffect(currentTime.getTime())],
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
        const lat = e.lngLat.lat
        const lon = e.lngLat.lng
        const windSpeed = windSamplerRef.current
          ? windSamplerRef.current(lon, lat)
          : null
        setProbe({ lat, lon, windSpeed })
      })

      // Popup centraline qualita' aria.
      map.on('click', 'air-stations', (e) => {
        const f = e.features?.[0]
        if (!f) return
        const p = f.properties as Record<string, unknown>
        const fmt = (k: string, unit: string) =>
          p[k] != null ? `<div><b>${k.replace('_avg', '')}</b>: ${p[k]} ${unit}</div>` : ''
        const html = `
          <div style="font-family: ui-monospace, monospace; font-size: 12px;">
            <div style="color:#0e7490; font-weight: 700; margin-bottom: 4px;">${p.name ?? p.id ?? 'Stazione'}</div>
            ${p.type ? `<div style="color:#555;">${p.type}</div>` : ''}
            <div style="margin-top: 6px; color: #333;">
              ${fmt('no2_avg', 'µg/m³')}
              ${fmt('pm10_avg', 'µg/m³')}
              ${fmt('pm25_avg', 'µg/m³')}
              ${fmt('ozone_avg', 'µg/m³')}
              ${p.samples ? `<div style="color:#888; margin-top: 4px;">${p.samples} campioni</div>` : ''}
            </div>
          </div>
        `
        new maplibregl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map)
      })
      map.on('mouseenter', 'air-stations', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'air-stations', () => {
        map.getCanvas().style.cursor = ''
      })

      const syncBearing = () => setBearing(map.getBearing())
      map.on('rotate', syncBearing)
      map.on('moveend', syncBearing)
      syncBearing()

      setLoading(false)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Aggiorna sole + ombre + cielo quando cambia currentTime.
  useEffect(() => {
    currentTimeRef.current = currentTime
    const map = mapRef.current
    const overlay = overlayRef.current
    if (!map || !overlay) return
    const sun = getSunPosition(currentTime, AOI_CENTER[1], AOI_CENTER[0])
    if (map.isStyleLoaded()) {
      map.setLight(toMapLibreLight(sun))
      map.setSky(computeSky(sun.altitudeDeg))
    }
    overlay.setProps({
      effects: [buildLightingEffect(currentTime.getTime())],
    })
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
      for (const id of [
        'land-use',
        'buildings-particellari',
        'green-areas',
        'parks',
        'private-green',
        'wind',
      ] as LayerKey[]) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(
            id,
            'visibility',
            visibility[id] ? 'visible' : 'none',
          )
        }
      }
      // Air stations sono due layer maplibre (cerchio + glow) sotto un solo
      // toggle 'air-stations'.
      const airVis = visibility['air-stations'] ? 'visible' : 'none'
      for (const id of ['air-stations', 'air-stations-glow']) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', airVis)
        }
      }
      if (map.getLayer('osm-buildings-context')) {
        map.setLayoutProperty('osm-buildings-context', 'visibility', maplibre3d)
      }
      if (overlay) {
        // Se 'buildings-temp' e' attivo, calcolo la temp media del
        // giorno corrente dalla serie storica Open Data. Tutti gli
        // edifici prendono lo stesso colore (la serie non e' spaziale
        // -- e' city-wide). Quando avremo Envimet temp come PNG passero'
        // al sample per pixel come per il vento.
        let tempColorize: number | null = null
        if (visibility['buildings-temp'] && tempRecords) {
          const lookup = lookupTemperature(tempRecords, currentTime)
          tempColorize =
            lookup.exact?.avg ?? lookup.climatology?.avg ?? null
        }
        overlay.setProps({
          layers: [
            buildShadowBuildingsLayer(
              visibility['buildings-3d'],
              buildingsUrl,
              tempColorize,
            ),
            ...buildTreesLayers(visibility['trees'], trees),
          ].filter(Boolean) as Layer[],
        })
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once('idle', apply)
  }, [visibility, trees, buildingsUrl, tempRecords, currentTime])

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
    map.flyTo({ center: [cx, cy], zoom: 15, duration: 1500 })
    setSelectedQuartiere(f.properties.cod_quar)
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

      {/* Toggle pannello Zone sotto la bussola. Stesso pattern del
          toggle Layer: chevron ▸ che ruota di 90° (transition-transform)
          quando il pannello e' aperto. */}
      {quartieri && (
        <button
          type="button"
          onClick={() => setZonePanelOpen((v) => !v)}
          title={zonePanelOpen ? t('hideZones', lang) : t('showZones', lang)}
          className="absolute top-20 sm:top-24 right-2 sm:right-4 z-20 px-2.5 py-1.5 rounded bg-gray-900/85 border border-cyan-400/30 backdrop-blur-sm shadow-xl text-cyan-300 hover:text-cyan-100 hover:border-cyan-400/60 transition-colors text-[11px] font-mono uppercase tracking-widest flex items-center gap-1.5"
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

      {/* Pannello Zone (collassabile). Posizionato a destra sotto il
          toggle. */}
      {quartieri && zonePanelOpen && (
        <div className="absolute top-32 sm:top-36 right-2 sm:right-4 z-10 bg-gray-900/85 border border-cyan-400/30 rounded p-1.5 sm:p-2 backdrop-blur-sm shadow-xl max-w-[60vw]">
          <div className="flex flex-col gap-1">
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
                      const disabled = l.id === 'wind' && !windOverlay
                      return (
                        <label
                          key={l.id}
                          title={
                            disabled
                              ? 'Lancia scripts/build_wind_overlay.sh per generare l’overlay'
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
                          <span>{t(l.labelKey, lang)}</span>
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

      {probe && (
        <InfoPanel
          lat={probe.lat}
          lon={probe.lon}
          date={currentTime}
          temp={tempLookup}
          loading={!tempRecords}
          windSpeed={probe.windSpeed}
          lang={lang}
          onClose={() => setProbe(null)}
        />
      )}
    </div>
  )
}
