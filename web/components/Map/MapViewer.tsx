'use client'

import { useEffect, useRef, useState } from 'react'
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
import {
  loadTemperatureSeries,
  lookupTemperature,
  type TempLookup,
  type TempRecord,
} from '@/lib/temperature'
import TimeSlider from '@/components/UI/TimeSlider'
import InfoPanel from '@/components/UI/InfoPanel'
import { withBase } from '@/lib/basePath'

type LayerKey =
  | 'land-use'
  | 'buildings-particellari'
  | 'buildings-3d'
  | 'trees'
  | 'green-areas'
  | 'parks'
  | 'private-green'
  | 'air-stations'
  | 'wind'

const LAYERS: { id: LayerKey; label: string; default: boolean }[] = [
  { id: 'land-use', label: 'Uso del suolo 2020', default: false },
  { id: 'buildings-particellari', label: 'Edifici (footprint 2D)', default: false },
  { id: 'buildings-3d', label: 'Edifici 3D + ombre', default: true },
  { id: 'trees', label: 'Alberi', default: true },
  { id: 'green-areas', label: 'Aree verdi', default: true },
  { id: 'parks', label: 'Parchi pubblici', default: false },
  { id: 'private-green', label: 'Verde privato', default: false },
  { id: 'air-stations', label: 'Qualità aria', default: false },
  { id: 'wind', label: 'Velocità vento (m/s)', default: false },
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

type BasemapId = 'dark' | 'light' | 'satellite'
const BASEMAPS: Record<
  BasemapId,
  { label: string; style: maplibregl.StyleSpecification | string }
> = {
  dark: {
    label: 'Dark',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  light: {
    label: 'Light',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
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
}

type WindOverlay = {
  png: string
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ]
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

function buildShadowBuildingsLayer(
  visible: boolean,
  dataUrl: string,
): GeoJsonLayer | null {
  if (!visible) return null
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
    getFillColor: [180, 200, 230, 240],
    getLineColor: [80, 100, 130, 255],
    lineWidthMinPixels: 0.5,
    pickable: false,
    material: {
      ambient: 0.4,
      diffuse: 0.9,
      shininess: 20,
      specularColor: [60, 64, 70],
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

export default function MapViewer() {
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
  const [tempLookup, setTempLookup] = useState<TempLookup | null>(null)
  const [buildingsUrl, setBuildingsUrl] = useState<string>(
    BUILDINGS_FOOTPRINT_URL,
  )
  const [windOverlay, setWindOverlay] = useState<WindOverlay | null>(null)
  const windAddedRef = useRef(false)
  const [basemap, setBasemap] = useState<BasemapId>('dark')
  const reapplyRef = useRef<(() => void) | null>(null)

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
          meta.coordinates.length === 4
        ) {
          console.log('[wind] meta loaded, bounds', meta.bounds)
          setWindOverlay({
            png: withBase(meta.image),
            coordinates: meta.coordinates,
          })
        }
      })
      .catch((err) => console.warn('[wind] meta error', err))
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

    map.on('load', () => {
      addCustomLayers()
      reapplyRef.current = addCustomLayers

      const overlay = new MapboxOverlay({
        interleaved: false,
        effects: [buildLightingEffect(currentTime.getTime())],
        layers: [
          buildShadowBuildingsLayer(
            LAYERS.find((l) => l.id === 'buildings-3d')!.default,
            buildingsUrl,
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

      map.on('click', (e) => {
        setProbe({ lat: e.lngLat.lat, lon: e.lngLat.lng })
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

  // Aggiorna sole + ombre quando cambia currentTime.
  useEffect(() => {
    const map = mapRef.current
    const overlay = overlayRef.current
    if (!map || !overlay) return
    const sun = getSunPosition(currentTime, AOI_CENTER[1], AOI_CENTER[0])
    if (map.isStyleLoaded()) {
      map.setLight(toMapLibreLight(sun))
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
        overlay.setProps({
          layers: [
            buildShadowBuildingsLayer(
              visibility['buildings-3d'],
              buildingsUrl,
            ),
            ...buildTreesLayers(visibility['trees'], trees),
          ].filter(Boolean) as Layer[],
        })
      }
    }
    if (map.isStyleLoaded()) apply()
    else map.once('idle', apply)
  }, [visibility, trees, buildingsUrl])

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
      // Sole + luce vengono persi nello swap, ricomputo.
      const sun = getSunPosition(currentTime, AOI_CENTER[1], AOI_CENTER[0])
      map.setLight(toMapLibreLight(sun))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap])

  return (
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-950 gap-4">
          <div className="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-cyan-400 tracking-widest text-sm font-mono uppercase">
            Caricamento Bologna 3D...
          </p>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />

      <div className="absolute top-4 left-4 z-10 bg-gray-900/85 border border-cyan-400/30 rounded p-3 backdrop-blur-sm shadow-xl">
        <div className="text-cyan-400 text-xs font-mono uppercase tracking-widest mb-2">
          Layer
        </div>
        <div className="flex flex-col gap-1.5 min-w-[220px]">
          {LAYERS.map((l) => {
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
                    setVisibility((v) => ({ ...v, [l.id]: e.target.checked }))
                  }
                  className="accent-cyan-400 cursor-pointer disabled:cursor-not-allowed"
                />
                <span>{l.label}</span>
              </label>
            )
          })}
        </div>
        <div className="text-gray-500 text-[10px] font-mono mt-2 italic">
          click sulla mappa &rarr; temperatura
        </div>
      </div>

      <div className="absolute bottom-24 right-4 z-10 bg-gray-900/85 border border-cyan-400/30 rounded p-2 backdrop-blur-sm shadow-xl">
        <div className="text-cyan-400 text-[10px] font-mono uppercase tracking-widest mb-1.5 px-1">
          Basemap
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
      />

      {probe && (
        <InfoPanel
          lat={probe.lat}
          lon={probe.lon}
          date={currentTime}
          temp={tempLookup}
          loading={!tempRecords}
          onClose={() => setProbe(null)}
        />
      )}
    </div>
  )
}
