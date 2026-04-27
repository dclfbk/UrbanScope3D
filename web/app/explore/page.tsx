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
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-cyan-400/20 z-20">
        <Link href="/" className="text-cyan-400 text-lg font-bold font-mono tracking-wider hover:opacity-80 transition-opacity">
          ← UrbanScope3D
        </Link>
        <span className="text-gray-400 text-sm font-mono tracking-widest uppercase">
          Bologna
        </span>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-cyan-400 text-xs font-mono">LIVE</span>
        </div>
      </div>
      <div className="flex-1 relative">
        <MapViewer />
      </div>
    </main>
  )
}