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
import {
  GeoJsonLayer,
  ColumnLayer,
  ScatterplotLayer,
  TextLayer,
} from '@deck.gl/layers'
import { SimpleMeshLayer } from '@deck.gl/mesh-layers'
import { Geometry } from '@luma.gl/engine'
import { getSunPosition, toMapLibreLight } from '@/lib/sun'
import { computeSky, nightFactor } from '@/lib/sky'
import { buildWindSampler, type WindSampler } from '@/lib/wind'
import { buildEnvimetSampler, type EnvimetSampler } from '@/lib/envimet'
import { t, type Lang, type StringKey } from '@/lib/i18n'
import TimeSlider from '@/components/UI/TimeSlider'
import InfoPanel from '@/components/UI/InfoPanel'
import MeteoWidget from '@/components/UI/MeteoWidget'
import { withBase } from '@/lib/basePath'
import {
  BOLOGNA_FOREST_DARK,
  BOLOGNA_OCRA,
  BOLOGNA_RED,
  BOLOGNA_SANGIOVESE,
  toCss,
  withAlpha,
  type RGB,
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
  // Range EFFETTIVO dei dati (min/max osservati), piu' stretto del `range`
  // fisso usato per il PNG: lo usiamo per colorare gli edifici cosi' la rampa
  // si spalma sui valori reali e caldi/freddi si distinguono bene.
  observed?: { min: number; max: number }
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
  // Ombre: OFF di default; il toggle le accende. Con interleaved il cambio
  // ricrea l'overlay deck (vedi effect "ricrea overlay al cambio ombre").
  { id: 'shadows', labelKey: 'layer_shadows', default: false, category: 'edifici' },
  { id: 'buildings-particellari', labelKey: 'layer_buildings_2d', default: false, category: 'edifici' },
  { id: 'buildings-temp', labelKey: 'layer_buildings_temp', default: false, category: 'edifici' },
  { id: 'trees', labelKey: 'layer_trees', default: true, category: 'verde' },
  { id: 'green-areas', labelKey: 'layer_green', default: true, category: 'verde' },
  { id: 'parks', labelKey: 'layer_parks', default: true, category: 'verde' },
  { id: 'private-green', labelKey: 'layer_private_green', default: true, category: 'verde' },
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
// Stacco verticale del tetto rosso sopra la cima dell'estrusione: piccolo, per
// vincere il depth test (tetto sopra le facciate) senza gap visibile. Combinato
// col depth-bias (polygon offset) sul layer tetti elimina lo sfarfallio.
const ROOF_LIFT_M = 0.06

// Albero stilizzato: tronco cilindrico + chioma. Due forme di chioma generate
// proceduralmente (nessun asset esterno): coni sovrapposti per le conifere,
// sfera per le latifoglie. La forma si sceglie dal tag OSM leaf_type.
const TRUNK_RADIUS = 0.32

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
function treeHeightM(d: TreePoint): number {
  // 1) altezza reale dal tag OSM se c'e'.
  const real = parseHeightM(d.props.height)
  if (real != null) return real
  // 2) stima per genere (tipologia), variata ±18% per albero (seed) cosi' un
  //    filare non e' un muro perfetto.
  const genus = genusOf(d.props)
  const base = genus ? GENUS_HEIGHT_M[genus] : undefined
  if (base != null) return Math.round(base * (0.82 + d.seed * 0.36) * 10) / 10
  // 3) fallback: conifere un filo piu' slanciate, resto come prima (6..13 m).
  return treeKind(d) === 'conifer' ? 9 + d.seed * 8 : 6 + d.seed * 7
}
function trunkHeightOf(d: TreePoint): number {
  return Math.max(1.5, treeHeightM(d) * 0.28)
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
  const sun = new SunLight({
    timestamp,
    color: [255, 255, 255],
    intensity: isDay ? 1.5 : 0,
    _shadow: shadow,
  })
  const ambient = new AmbientLight({
    color: [255, 255, 255],
    intensity: isDay ? 1.0 : 1.15,
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
// Foschia MOLTO leggera e lontana: tutte le case della citta' restano piene;
// solo quelle davvero lontane (oltre NEAR) sfumano dolcemente verso l'orizzonte,
// sparendo a FAR. Distanze alzate (prima 2.5/6 km, troppa nebbia) cosi' l'AOI e
// i quartieri restano sempre nitidi e l'effetto e' appena un accenno all'orizzonte.
const BUILDINGS_FADE_NEAR_M = 5000
const BUILDINGS_FADE_FAR_M = 11000
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

type BuildingFeature = Centroidable & {
  properties?: { height?: number; air_temp?: number } | null
}

function buildShadowBuildingsLayer(
  visible: boolean,
  dataUrl: string,
  // Se valorizzato, gli edifici sono colorati per `air_temp` (ENVI-met)
  // normalizzata su questo range; chi non ha il dato resta grigio.
  tempRange: { min: number; max: number } | null,
  // Dissolvenza per distanza (null = nessuna).
  fade: FadeCfg | null,
  // Chiamata quando il GeoJSON edifici ha finito di caricare (per il loader).
  onDataLoad?: () => void,
): GeoJsonLayer | null {
  if (!visible) return null
  const ocra = withAlpha(BOLOGNA_OCRA, 240) as [number, number, number, number]
  const lineBase = withAlpha(BOLOGNA_SANGIOVESE, 255) as [
    number,
    number,
    number,
    number,
  ]
  const baseColor = (f: BuildingFeature): [number, number, number, number] => {
    if (tempRange) {
      const tC = f.properties?.air_temp
      if (typeof tC !== 'number')
        return [...BUILDING_GREY, 235] as [number, number, number, number]
      const tNorm = (tC - tempRange.min) / (tempRange.max - tempRange.min || 1)
      return [...ylOrRd(tNorm), 245] as [number, number, number, number]
    }
    return ocra
  }
  return new GeoJsonLayer({
    id: 'buildings-shadow',
    data: dataUrl,
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
// ocra. deck.gl colora top+lati di un edificio estruso con UN solo colore,
// quindi per avere il tetto di colore diverso si disegna un layer a parte: le
// stesse impronte ELEVATE a z = altezza (+ROOF_LIFT_M, stacco minimo per stare
// appena sopra la cima dell'estrusione ed evitare z-fighting), poligoni piatti.
type RoofFC = {
  features: {
    properties?: { height?: number } | null
    geometry: {
      type: string
      coordinates: number[][][] | number[][][][]
    }
  }[]
}
// IMPORTANTE: PURO, non muta l'input. deck.gl condivide il GeoJSON scaricato
// tra layer con lo STESSO url (qui edifici estrusi e tetti). Se qui mutassimo
// in-place le coordinate (come prima), solleveremmo la base ANCHE degli edifici
// estrusi -> tutta la palazzina "vola". Quindi cloniamo features/geometry e
// restituiamo una FC nuova, lasciando intatta quella degli edifici.
function elevateRoofs(fc: RoofFC): RoofFC {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const h = f.properties?.height
      // +ROOF_LIFT_M: stacco MINIMO sopra la cima dell'estrusione. Prima era
      // 0.3 m = un gap costante visibile (tetti "rialzati tutti uguale"). Ora
      // 0.03 m: il rosso resta appena sopra il cappello ocra (vince il depth
      // test, niente z-fighting) ma il distacco e' impercettibile -> tetto
      // "attaccato".
      const height =
        (typeof h === 'number' && h > 0 ? h : DEFAULT_BUILDING_HEIGHT) +
        ROOF_LIFT_M
      const g = f.geometry
      // c[2] = quota di base del terreno cotta nell'impronta (0 se assente):
      // il tetto va a base + altezza, cosi' segue il terreno come l'estrusione.
      const lift = (ring: number[][]) =>
        ring.map((c) => [c[0], c[1], (c[2] ?? 0) + height])
      const coordinates =
        g.type === 'Polygon'
          ? (g.coordinates as number[][][]).map(lift)
          : g.type === 'MultiPolygon'
            ? (g.coordinates as number[][][][]).map((poly) => poly.map(lift))
            : g.coordinates
      return { ...f, geometry: { ...g, coordinates } }
    }),
  }
}
function buildRoofLayer(
  visible: boolean,
  dataUrl: string,
  fade: FadeCfg | null,
): GeoJsonLayer | null {
  if (!visible) return null
  const red = withAlpha(BOLOGNA_RED, 255) as [number, number, number, number]
  return new GeoJsonLayer({
    id: 'buildings-roof',
    // Dato ISOLATO: stesso file ma URL distinto (il frammento #roofs viene
    // ignorato dal server). Cosi' deck.gl carica una copia SEPARATA per i tetti
    // e il nostro dataTransform non puo' MAI toccare la geometria condivisa
    // degli edifici estrusi (che altrimenti si solleverebbero -> palazzi che
    // volano). Questo elimina alla radice la condivisione dati tra i due layer.
    data: dataUrl + '#roofs',
    // @ts-expect-error dataTransform restituisce la nostra FC elevata
    dataTransform: (d: unknown) => elevateRoofs(d as RoofFC),
    stroked: false,
    filled: true,
    extruded: false,
    // DEPTH-BIAS (polygon offset): il tetto e' quasi complanare al "cappello"
    // ocra in cima all'estrusione; a grande distanza, col terreno che dilata il
    // range di profondita', 0.03 m non bastano e i pixel sfarfallano (z-fighting).
    // depthBias/SlopeScale negativi (forti) spostano il tetto PIU' VICINO nel
    // depth buffer -> vince sempre il confronto col "cappello" ocra, niente
    // sfarfallio, senza alzarlo visibilmente. (luma.gl: gl.polygonOffset +
    // POLYGON_OFFSET_FILL.) Lo sfarfallio si vede solo di giorno perche' il
    // contrasto rosso/ocra lo rende evidente (di notte i due sono entrambi
    // scuri), ma la causa e' geometrica, non la luce.
    parameters: { depthBias: -8, depthBiasSlopeScale: -8 },
    // Stessa dissolvenza delle facciate cosi' i tetti spariscono in sincrono.
    getFillColor: (f: Centroidable) => withFade(red, fadeFactor(f, fade)),
    pickable: false,
    // Tetti piatti: niente ombra propria -> fuori dallo shadow pass.
    shadowEnabled: false,
    updateTriggers: {
      getFillColor: [fade?.lon, fade?.lat, fade?.near, fade?.far],
    },
    material: {
      ambient: 0.45,
      diffuse: 0.85,
      shininess: 10,
      specularColor: [60, 30, 25],
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
    diskResolution: 6,
    radius: TRUNK_RADIUS,
    extruded: true,
    pickable: true,
    // Gli alberi NON entrano nello shadow pass: con 100k+ istanze raddoppiare
    // il rendering nella shadow map li rendeva lentissimi (e le ombre degli
    // alberi sarebbero comunque caotiche). Solo gli edifici proiettano ombre.
    // shadowEnabled e' una prop runtime letta da ShadowPass, non nei tipi TS.
    // @ts-expect-error deck.gl runtime prop assente dai types
    shadowEnabled: false,
    getPosition: (d) => d.position,
    getElevation: trunkHeightOf,
    getFillColor: [82, 58, 38, 255],
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
      makeCanopy('trees-canopy-conifer', conifers, CONIFER_MESH, CONIFER_ZMAX, 'conifer', 0.16, 1.0, 3.5),
    )
  }
  if (broadleaves.length) {
    layers.push(
      makeCanopy('trees-canopy-broadleaf', broadleaves, BROADLEAF_MESH, BROADLEAF_ZMAX, 'broadleaf', 0.26, 1.3, 5.5),
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

type MapViewerProps = {
  lang: Lang
}

export default function MapViewer({ lang }: MapViewerProps) {
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
  // Prontezza dei dati pesanti caricati all'avvio (edifici GeoJSON ~MB, alberi
  // ~18 MB): il loader resta finche' NON sono pronti, poi si svela tutto.
  const [mapLoaded, setMapLoaded] = useState(false)
  const [buildingsReady, setBuildingsReady] = useState(false)
  // Verde (aree verdi + parchi + verde privato): fonti MapLibre, pronte al
  // primo 'idle' della mappa dopo il caricamento.
  const [greenReady, setGreenReady] = useState(false)
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
  const [probe, setProbe] = useState<{ lat: number; lon: number } | null>(null)
  // Albero cliccato (picking deck.gl): mostra un popup con le sue info.
  const [selectedTree, setSelectedTree] = useState<{
    lon: number
    lat: number
    z: number
    props: TreeProps
  } | null>(null)
  const treePopupRef = useRef<maplibregl.Popup | null>(null)
  // air_temp dell'edificio sotto l'ultimo click (null = nessun edificio o fuori
  // dominio ENVI-met). Usato dal pannello del punto in modalita' temperatura.
  const probeBuildingTempRef = useRef<number | null>(null)
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
  // Parto SUBITO dal file con le altezze (esiste): gli edifici 3D giusti si
  // caricano dall'inizio, senza il flash del footprint piatto (z=0, sepolto
  // sotto il terreno). Se il file processato mancasse, si ripiega sul footprint.
  const [buildingsUrl, setBuildingsUrl] = useState<string>(
    BUILDINGS_HEIGHTS_URL,
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
  // Centro vista per la dissolvenza degli edifici lontani: aggiornato a
  // 'moveend' (non a ogni frame). Vedi BUILDINGS_FADE_*.
  const [fadeCenter, setFadeCenter] = useState<{ lon: number; lat: number } | null>(
    null,
  )
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null)
  // Vista pulita: nasconde tutti i pannelli/filtri per uno screenshot o una
  // vista 3D senza ingombri. Lo screenshot cattura comunque solo le canvas
  // (mappa + deck), mai il DOM dei pannelli.
  const [uiHidden, setUiHidden] = useState(false)
  // Pannello meteo (widget 3BMeteo). Si nasconde anche in vista pulita.
  const [meteoOpen, setMeteoOpen] = useState(false)
  // Toast "link copiato" dopo il fallback di condivisione su desktop.
  const [shareToast, setShareToast] = useState(false)
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
  // Ref aggiornato a `currentTime`: serve dentro callback registrate al
  // mount (basemap switch, addCustomLayers) per leggere SEMPRE l'ora
  // corrente senza ricreare la mappa.
  const currentTimeRef = useRef<Date>(new Date(2026, 5, 21, 12, 0, 0))

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
    tryFetch(TREES_OSM_URL)
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

  // Loader iniziale: si chiude quando i dati pesanti dell'avvio sono pronti —
  // edifici (onDataLoad del layer deck) E alberi (stato `trees` valorizzato,
  // anche [] se il fetch fallisce). Aree verdi/parchi/verde privato sono fonti
  // MapLibre leggere, gia' caricate per allora.
  useEffect(() => {
    if (mapLoaded && buildingsReady && trees !== null && greenReady)
      setLoading(false)
  }, [mapLoaded, buildingsReady, trees, greenReady])
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
      // Carico il sampler se l'overlay e' acceso OPPURE, per la temperatura, se
      // e' attivo 'Edifici -> temperatura' (cosi' il click mostra la temp aria
      // anche senza l'overlay raster acceso).
      const on =
        visibility[envLayerId(o.key) as LayerKey] ||
        (o.key === 'temperature' && visibility['buildings-temp'])
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
    // Se 'Edifici -> temperatura' e' attivo, mostra comunque la temperatura
    // dell'aria al punto cliccato (anche con l'overlay raster spento).
    if (visibility['buildings-temp']) {
      const tempOv = (envimetRef.current ?? []).find((o) => o.key === 'temperature')
      if (tempOv && !active.some((o) => o.key === 'temperature')) {
        active.unshift(tempOv)
      }
    }
    setPointEnv(
      active.map((o) => ({
        key: o.key,
        label: o.label,
        unit: o.unit,
        // Per la temperatura preferisco la air_temp dell'edificio cliccato
        // (esatta, = colore dell'edificio); altrimenti campiono il raster.
        value:
          o.key === 'temperature' && probeBuildingTempRef.current != null
            ? probeBuildingTempRef.current
            : (envSamplersRef.current[o.key]?.(lon, lat) ?? null),
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
    if (!probe) {
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
  }, [probe])

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
      whitenMapLabels(map)
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
          setProbe(null)
          return
        }
        // Click sul vuoto/edificio: i valori (vento / microclima) sono derivati
        // in un effect dai layer attivi, qui registro solo il punto. In piu',
        // se ho cliccato un edificio, leggo la sua air_temp (la temperatura che
        // lo colora) cosi' il pannello la mostra esatta, anche dove il raster
        // non campiona bene.
        const pb = ov?.pickObject?.({
          x: e.point.x,
          y: e.point.y,
          radius: 2,
          layerIds: ['buildings-shadow'],
        }) as unknown as
          | { object?: { properties?: { air_temp?: number } } }
          | null
        const at = pb?.object?.properties?.air_temp
        probeBuildingTempRef.current = typeof at === 'number' ? at : null
        setSelectedTree(null)
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

      // NB: il loader NON si chiude qui (map 'load' = solo stile pronto). Si
      // chiude quando edifici + alberi sono caricati (effect dedicato sotto),
      // cosi' la scena appare gia' completa. Qui segnalo solo la tappa "stile".
      setMapLoaded(true)
      // Primo 'idle' = tutte le fonti MapLibre (verde/parchi/...) caricate.
      map.once('idle', () => setGreenReady(true))
    })

    mapRef.current = map

    return () => {
      noiseTipRef.current?.remove()
      noiseTipRef.current = null
      treePopupRef.current?.remove()
      treePopupRef.current = null
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
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
      if (overlay && overlayReadyRef.current) {
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
          // Coloro sul range REALE osservato (piu' stretto del fisso 24-40):
          // cosi' la rampa si usa tutta e le case calde/fredde si distinguono.
          tempRange = tempOv
            ? (tempOv.observed ?? tempOv.range)
            : { min: 29, max: 37 }
        }
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
        overlay.setProps({
          // Stessa istanza persistente: deck fa deepEqual e non la sostituisce
          // (le mutazioni sopra sono gia' attive); se invece il deck e' stato
          // ricreato — es. cambio basemap — la re-installa con i valori giusti.
          effects: lightingRef.current ? [lightingRef.current] : [],
          layers: [
            buildShadowBuildingsLayer(
              // Mostro gli edifici estrusi se e' attivo il 3D OPPURE la
              // colorazione per temperatura (cosi' 'buildings-temp' funziona
              // anche da solo).
              visibility['buildings-3d'] || visibility['buildings-temp'],
              buildingsUrl,
              tempRange,
              fade,
              () => setBuildingsReady(true),
            ),
            // Tetti rosso mattone: solo col 3D acceso e NON in modalita'
            // temperatura (li' i tetti rossi coprirebbero la scala cromatica).
            buildRoofLayer(
              visibility['buildings-3d'] && !visibility['buildings-temp'],
              buildingsUrl,
              fade,
            ),
            ...treeLayers,
            buildSelectedTreeLayer(selectedTree),
            buildQuartiereFlashLayer(quartieri, flashQuartiere, flashFading),
            buildQuartiereLabelsLayer(quartieri),
          ].filter(Boolean) as Layer[],
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
    selectedTree,
    quartieri,
    flashQuartiere,
    flashFading,
    overlayReady,
    buildingsUrl,
    currentTime,
    envimetOverlays,
    fadeCenter,
  ])

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
      whitenMapLabels(map)
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
    setSearch(res.label.split(',')[0])
  }

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
    const url = typeof window !== 'undefined' ? window.location.href : ''

    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean
    }
    if (nav.share && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ title: text, text, files: [file] })
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

  // Tappe REALI di caricamento, ognuna col suo dataset/percorso. La barra non e'
  // finta: avanza quando una tappa finisce davvero (onDataLoad / fetch / idle).
  const loadSteps = [
    {
      done: mapLoaded,
      label: lang === 'it' ? 'Stile mappa e terreno 3D' : 'Map style & 3D terrain',
      detail: 'basemap · terrain DEM (z11–14)',
    },
    {
      done: buildingsReady,
      label: lang === 'it' ? 'Edifici 3D' : '3D buildings',
      detail: '/data/processed/buildings_heights.geojson',
    },
    {
      done: trees !== null,
      label: lang === 'it' ? 'Alberi (~18 MB)' : 'Trees (~18 MB)',
      detail: '/data/processed/trees_osm.geojson',
    },
    {
      done: greenReady,
      label:
        lang === 'it'
          ? 'Aree verdi · parchi · verde privato'
          : 'Green areas · parks · private green',
      detail: 'green.geojson · 2.1_Aree_Verdi · 2.2_Verde_Privato',
    },
  ]
  const loadDone = loadSteps.filter((s) => s.done).length
  const loadProgress = Math.round((loadDone / loadSteps.length) * 100)

  return (
    <div className="relative w-full h-full">
      {loading && (
        // z-[100] + sfondo OPACO = copre mappa, menu e ogni pannello UI: durante
        // il caricamento si vede SOLO il loader (titolo, barra, lista dataset).
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-gray-950 gap-6 px-8">
          <p className="text-talea-400 text-2xl font-black uppercase tracking-[0.3em]">
            UrbanScope3D
          </p>
          <div className="w-80 max-w-[88vw] flex flex-col gap-3">
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
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
                      <span className="inline-block w-3 h-3 border-2 border-gray-700 border-t-talea-400 rounded-full animate-spin" />
                    )}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className={s.done ? 'text-gray-300' : 'text-gray-400'}>
                      {s.label}
                    </span>
                    <span className="text-gray-600 text-[10px] break-all leading-tight">
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
      {/* Search bar sticky, sempre visibile in alto */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-[min(420px,80vw)]">
        <form
          onSubmit={runSearch}
          className="flex items-center gap-2 bg-gray-900/90 border border-talea-400/30 rounded px-3 py-2 backdrop-blur-sm shadow-xl"
        >
          <span className="text-talea-400/70 text-sm">⌕</span>
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
              className="text-gray-500 hover:text-talea-300 text-sm"
              aria-label={t('clearSearch', lang)}
            >
              ✕
            </button>
          )}
          <button
            type="submit"
            disabled={searching}
            className="text-talea-300 hover:text-talea-200 text-xs font-mono uppercase tracking-wider disabled:text-gray-600"
          >
            {searching ? '...' : t('go', lang)}
          </button>
        </form>
        {searchResults.length > 0 && (
          <ul className="mt-1 bg-gray-900/95 border border-talea-400/30 rounded backdrop-blur-sm shadow-xl overflow-hidden">
            {searchResults.map((res, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => gotoResult(res)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-talea-400/10 hover:text-talea-200 transition-colors border-b border-talea-400/10 last:border-0 ${
                    res.type === 'quartiere'
                      ? 'text-talea-300 font-mono'
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

      {/* Bussola: il quadrante ruota con il bearing, click = riallinea a Nord.
          Ingrandita rispetto a prima (era w-12 h-12). 'O' (ovest) in IT,
          'W' in EN. */}
      <button
        type="button"
        onClick={resetNorth}
        title={t('resetNorth', lang)}
        className="absolute top-4 right-2 sm:right-4 z-10 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gray-900/85 border border-talea-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center hover:border-talea-400/60 transition-colors"
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
          className="absolute top-4 z-20 px-2.5 py-2 rounded bg-gray-900/90 border border-talea-400/30 backdrop-blur-sm shadow-xl text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors text-[11px] font-mono uppercase tracking-widest flex items-center gap-1.5"
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
          className="absolute top-16 z-10 bg-gray-900/85 border border-talea-400/30 rounded p-1.5 sm:p-2 backdrop-blur-sm shadow-xl max-w-[60vw] sm:max-w-[200px]"
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
                className="text-left text-xs font-mono px-2 py-1 rounded transition-colors truncate text-gray-300 hover:text-talea-300 hover:bg-talea-400/10 border border-transparent"
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
        className="absolute top-20 left-2 sm:left-4 z-20 px-2.5 py-1.5 rounded bg-gray-900/85 border border-talea-400/30 backdrop-blur-sm shadow-xl text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors text-[11px] font-mono uppercase tracking-widest flex items-center gap-1.5"
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
        className={`absolute top-32 sm:top-32 left-2 sm:left-4 z-10 bg-gray-900/85 border border-talea-400/30 rounded p-2 sm:p-3 backdrop-blur-sm shadow-xl ${
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
              <div key={cat.key} className="border-b border-talea-400/10 last:border-0 pb-1 mb-0.5">
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
                              : 'text-gray-200 cursor-pointer hover:text-talea-300'
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
        <div className="text-gray-500 text-[10px] font-mono mt-2 italic">
          {lang === 'it'
            ? 'click sulla mappa → temperatura / vento'
            : 'click on the map → temperature / wind'}
        </div>
      </div>

      <div className="absolute bottom-24 right-2 sm:right-4 z-10 bg-gray-900/85 border border-talea-400/30 rounded p-1.5 sm:p-2 backdrop-blur-sm shadow-xl">
        <div className="text-talea-400 text-[10px] font-mono uppercase tracking-widest mb-1.5 px-1">
          {t('basemap', lang)}
        </div>
        <div className="flex flex-col gap-1">
          {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
            <button
              key={id}
              onClick={() => setBasemap(id)}
              className={`text-left text-xs font-mono px-2 py-1 rounded transition-colors ${
                basemap === id
                  ? 'bg-talea-400/20 text-talea-300 border border-talea-400/50'
                  : 'text-gray-300 hover:text-talea-300 hover:bg-talea-400/10 border border-transparent'
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
                windSpeed={pointWind}
                envSamples={pointEnv}
                lang={lang}
                onClose={() => setProbe(null)}
              />
            )}
            {showLegend && (
              <div className="bg-gray-900/85 border border-talea-400/30 rounded p-2 backdrop-blur-sm shadow-xl">
                <div className="text-talea-400 text-[10px] font-mono uppercase tracking-widest mb-1.5 px-0.5">
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
                        <span>
                          {Math.round((tempOv.observed ?? tempOv.range).min)}
                        </span>
                        <span>
                          {Math.round((tempOv.observed ?? tempOv.range).max)}
                        </span>
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
        </>
      )}

      {/* Controlli sempre visibili (anche in vista pulita): in basso a sinistra.
          Vista pulita nasconde i pannelli; screenshot scarica la scena 3D. */}
      <div className="absolute bottom-4 left-2 sm:left-4 z-20 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setUiHidden((v) => !v)}
          title={
            uiHidden
              ? t('showPanels', lang)
              : t('hidePanels', lang)
          }
          aria-label={uiHidden ? t('showPanels', lang) : t('hidePanels', lang)}
          className="w-10 h-10 rounded-full bg-gray-900/85 border border-talea-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors"
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
          className="w-10 h-10 rounded-full bg-gray-900/85 border border-talea-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors"
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
          className="w-10 h-10 rounded-full bg-gray-900/85 border border-talea-400/30 backdrop-blur-sm shadow-xl flex items-center justify-center text-talea-300 hover:text-talea-100 hover:border-talea-400/60 transition-colors"
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
          className={`w-10 h-10 rounded-full bg-gray-900/85 border backdrop-blur-sm shadow-xl flex items-center justify-center transition-colors text-base ${
            meteoOpen
              ? 'border-talea-400/60 text-talea-100'
              : 'border-talea-400/30 text-talea-300 hover:text-talea-100 hover:border-talea-400/60'
          }`}
        >
          ⛅
        </button>
      </div>

      {/* Pannello meteo: widget 3BMeteo. Nascosto in vista pulita come gli altri. */}
      {meteoOpen && !uiHidden && (
        <MeteoWidget lang={lang} onClose={() => setMeteoOpen(false)} />
      )}

      {/* Toast "link copiato": fallback di condivisione su desktop senza share API. */}
      {shareToast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-gray-900/90 border border-talea-400/40 backdrop-blur-sm shadow-xl text-sm text-talea-100">
          {t('shareCopied', lang)}
        </div>
      )}
    </div>
  )
}
