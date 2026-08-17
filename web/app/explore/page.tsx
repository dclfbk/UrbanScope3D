'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useState } from 'react'
import { setPreferredLang, usePreferredLang } from '@/lib/i18n'
import { withBase } from '@/lib/basePath'

const MapViewer = dynamic(
  () => import('@/components/Map/MapViewer'),
  { ssr: false }
)

export default function ExplorePage() {
  // Lingua persistente e condivisa con la home (lib/i18n): il toggle salva la
  // scelta in localStorage, così sopravvive a reload e navigazioni.
  const lang = usePreferredLang()
  // Modalità AIUTO (annotazioni): stato sollevato qui perché il bottone "Guida"
  // vive nell'header (a sinistra del toggle lingua), mentre l'overlay che
  // contorna i comandi è dentro MapViewer. Lo passo come prop controllato.
  const [helpOpen, setHelpOpen] = useState(false)
  const subtitle = lang === 'it' ? 'Microclima urbano · Bologna' : 'Urban microclimate · Bologna'
  return (
    <main className="w-full h-screen bg-[#f7f9f7] flex flex-col">
      {/* Header in stile Talea (talea.comune.bologna.it): barra bianca con
          bordo verde 3px, logo Talea + titolo blu + sottotitolo maiuscolo, e
          toggle lingua a pillola sulla destra. */}
      <header className="relative z-20 bg-white border-b-[3px] border-talea-green">
        <div className="flex items-center justify-between gap-4 px-3 sm:px-6 py-2 sm:py-2.5">
          <Link
            href="/"
            className="group flex items-center gap-3 min-w-0"
            aria-label="UrbanScope3D — home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- export
                statico senza image optimizer: <img> su un logo piccolo va bene */}
            <img
              src={withBase('/talea-logo.png')}
              alt="Talea"
              className="h-9 sm:h-11 w-auto transition-transform duration-300 group-hover:scale-105"
            />
            <span className="flex flex-col min-w-0 leading-tight">
              <span className="text-[18px] sm:text-[22px] font-bold text-talea-blue tracking-[-0.01em]">
                UrbanScope3D
              </span>
              <span className="text-[10px] sm:text-[12px] font-semibold uppercase tracking-[0.04em] text-[#17231a] truncate">
                {subtitle}
              </span>
            </span>
          </Link>

          {/* Gruppo destro: bottone GUIDA (come historysuhi) + toggle lingua. */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Guida: pillola con bordo verde (stile bottone info Talea). Apre
                il modale guida dentro MapViewer (stato controllato). */}
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-full border-[1.5px] border-talea-green bg-white text-talea-green-dark text-xs sm:text-sm font-bold shadow-sm hover:bg-talea-green hover:text-white transition-colors"
              aria-label={lang === 'it' ? 'Apri la guida' : 'Open the guide'}
              aria-pressed={helpOpen}
              title={lang === 'it' ? 'Come si usa il sito' : 'How to use the site'}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="w-4 h-4 sm:w-[18px] sm:h-[18px] shrink-0"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{lang === 'it' ? 'Guida' : 'Guide'}</span>
            </button>

            {/* Toggle lingua a pillola, stile Talea: pillola attiva verde scuro. */}
            <div className="grid grid-cols-2 gap-0.5 p-0.5 rounded-full bg-talea-green-dark/10">
              {(['it', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setPreferredLang(code)}
                className={`px-3.5 py-1 rounded-full text-xs font-semibold uppercase tracking-[0.05em] transition-colors ${
                  lang === code
                    ? 'bg-talea-green-dark text-white shadow-sm'
                    : 'text-[#7a9a87] hover:text-talea-green-dark hover:bg-talea-green-dark/5'
                }`}
                aria-pressed={lang === code}
              >
                {code}
              </button>
            ))}
            </div>
          </div>
        </div>
        {/* Barra accento gradiente verde→blu→giallo (come Talea map-accent-bar). */}
        <div
          className="h-[3px] w-full"
          style={{
            background:
              'linear-gradient(90deg, var(--talea-green) 0%, var(--talea-blue) 50%, var(--talea-yellow) 100%)',
            opacity: 0.75,
          }}
        />
      </header>
      <div className="flex-1 relative">
        <MapViewer
          lang={lang}
          helpOpen={helpOpen}
          onHelpOpenChange={setHelpOpen}
        />
      </div>
    </main>
  )
}