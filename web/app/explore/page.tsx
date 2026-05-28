'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState } from 'react'
import type { Lang } from '@/lib/i18n'

const MapViewer = dynamic(
  () => import('@/components/Map/MapViewer'),
  { ssr: false }
)

export default function ExplorePage() {
  const [lang, setLang] = useState<Lang>('it')
  return (
    <main className="w-full h-screen bg-gray-950 flex flex-col">
      <div className="relative flex items-center px-3 sm:px-6 py-2 sm:py-3 bg-gray-900 border-b border-cyan-400/20 z-20">
        <Link href="/" className="text-cyan-400 text-sm sm:text-lg font-bold font-mono tracking-wider hover:opacity-80 transition-opacity">
          ← UrbanScope3D
        </Link>
        <span className="hidden sm:block pointer-events-none absolute left-1/2 -translate-x-1/2 text-gray-300 text-sm font-mono tracking-[0.4em] uppercase">
          Bologna
        </span>
        {/* Toggle lingua: angolo top-right della top bar. */}
        <div className="ml-auto flex bg-gray-800 border border-cyan-400/30 rounded overflow-hidden">
          {(['it', 'en'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={`text-[11px] font-mono font-bold uppercase px-2.5 py-1 transition-colors ${
                lang === code
                  ? 'bg-cyan-400/20 text-cyan-300'
                  : 'text-gray-400 hover:text-cyan-300'
              }`}
              aria-pressed={lang === code}
            >
              {code}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 relative">
        <MapViewer lang={lang} />
      </div>
    </main>
  )
}