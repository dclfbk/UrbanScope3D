'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'

const MapViewer = dynamic(
  () => import('@/components/Map/MapViewer'),
  { ssr: false }
)

export default function ExplorePage() {
  return (
    <main className="w-full h-screen bg-gray-950 flex flex-col">
      <div className="relative flex items-center px-6 py-3 bg-gray-900 border-b border-cyan-400/20 z-20">
        <Link href="/" className="text-cyan-400 text-lg font-bold font-mono tracking-wider hover:opacity-80 transition-opacity">
          ← UrbanScope3D
        </Link>
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-gray-300 text-sm font-mono tracking-[0.4em] uppercase">
          Bologna
        </span>
      </div>
      <div className="flex-1 relative">
        <MapViewer />
      </div>
    </main>
  )
}