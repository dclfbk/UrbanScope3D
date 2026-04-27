'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function MapViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [11.343720439501553, 44.49989258707834],
      zoom: 14,
      minZoom: 12,
      maxZoom: 19,
      pitch: 45,
      bearing: 0,
      maxBounds: [
        [11.25, 44.45],
        [11.45, 44.55],
      ],
    })

    map.on('load', () => {
      // 🏠 Edifici 3D da OSM (già con altezze reali)
      map.addSource('openmaptiles', {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      })

      map.addLayer({
        id: 'buildings-3d',
        source: 'openmaptiles',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': 'rgb(70, 90, 110)',
          'fill-extrusion-height': ['get', 'render_height'],
          'fill-extrusion-base': ['get', 'render_min_height'],
          'fill-extrusion-opacity': 0.9,
        },
      })

      // 🌳 Aree verdi
      map.addSource('green', {
        type: 'geojson',
        data: '/data/green.geojson',
      })

      map.addLayer({
        id: 'green-areas',
        source: 'green',
        type: 'fill',
        paint: {
          'fill-color': 'rgba(34, 197, 94, 0.4)',
          'fill-outline-color': 'rgba(34, 197, 94, 0.8)',
        },
      })

      // 🌡️ Stazioni temperatura
      map.addSource('temperature', {
        type: 'geojson',
        data: '/data/temperature.geojson',
      })

      map.addLayer({
        id: 'temp-points',
        source: 'temperature',
        type: 'circle',
        paint: {
          'circle-radius': 8,
          'circle-color': 'rgb(251, 191, 36)',
          'circle-stroke-color': 'white',
          'circle-stroke-width': 2,
        },
      })

      setLoading(false)
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

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
    </div>
  )
}