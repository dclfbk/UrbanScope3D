'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { withBase } from '@/lib/basePath';

type Lang = 'it' | 'en';

export default function Home() {
  // Lingua dalla preferenza del browser: 'it' se l'utente ha l'italiano,
  // altrimenti inglese. Parte da 'it' (anche lato server) e si aggiorna dopo il
  // mount per evitare disallineamenti di hydration.
  const [lang, setLang] = useState<Lang>('it');
  useEffect(() => {
    const nav =
      navigator.language || (navigator.languages && navigator.languages[0]);
    setLang(nav?.toLowerCase().startsWith('it') ? 'it' : 'en');
  }, []);

  const subtitle =
    lang === 'it' ? 'Esplora gli ambienti urbani' : 'Exploring urban environments';
  const explore = lang === 'it' ? 'ESPLORA' : 'EXPLORE';

  return (
    <main className="relative w-full h-screen overflow-hidden">
      <video
        autoPlay
        muted
        loop
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src={withBase('/BolognaLowQuality.mp4')} type="video/mp4" />
      </video>

      {/* Velo scuro + gradiente: alza il contrasto delle scritte sul video. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/55 to-black/80" />

      <div className="relative z-10 flex flex-col items-center justify-center h-full gap-8">
        <h1
          className="text-8xl md:text-9xl font-black text-white uppercase text-center"
          style={{
            textShadow:
              '0 2px 24px rgba(0,0,0,0.9), 0 0 28px rgba(18,114,183,0.9), 0 0 56px rgba(18,114,183,0.5)',
            letterSpacing: '0.4em',
            paddingLeft: '0.4em',
          }}
        >
          BOLOGNA
        </h1>

        <div className="flex items-center gap-4 w-64">
          <div className="flex-1 h-px bg-talea-300" />
          <div className="w-2 h-2 rotate-45 bg-talea-300" />
          <div className="flex-1 h-px bg-talea-300" />
        </div>

        <p
          className="text-white text-base md:text-lg uppercase font-semibold text-center"
          style={{
            letterSpacing: '0.45em',
            fontFamily: 'monospace',
            textShadow: '0 2px 10px rgba(0,0,0,0.9)',
          }}
        >
          {subtitle}
        </p>

        <Link
          href="/explore"
          className="group relative mt-3 px-12 py-4 border-2 border-talea-300 bg-talea-400/15 text-white text-sm uppercase font-bold cursor-pointer overflow-hidden backdrop-blur-sm transition-all duration-300 hover:text-black hover:border-talea-200 active:scale-95"
          style={{
            fontFamily: 'monospace',
            letterSpacing: '0.4em',
            textShadow: '0 1px 6px rgba(0,0,0,0.8)',
          }}
        >
          <span className="absolute inset-0 bg-talea-300 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out" />
          <span className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-talea-200" />
          <span className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-talea-200" />
          <span className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-talea-200" />
          <span className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-talea-200" />
          <span className="relative z-10">{explore}</span>
        </Link>
      </div>

      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 2px)',
        }}
      />
    </main>
  );
}
