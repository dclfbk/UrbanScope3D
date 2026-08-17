'use client';

import Link from 'next/link';
import { withBase } from '@/lib/basePath';
import { setPreferredLang, usePreferredLang } from '@/lib/i18n';

export default function Home() {
  // Lingua persistente e condivisa con /explore (lib/i18n): localStorage
  // prima, preferenza del browser poi. Il toggle in alto a destra permette
  // di provare l'altra lingua anche con il browser impostato diversamente.
  const lang = usePreferredLang();

  const subtitle =
    lang === 'it'
      ? 'Il microclima urbano di Bologna in 3D'
      : "Bologna's urban microclimate in 3D";
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

      {/* Toggle lingua a pillola (stesso pattern dell'header di /explore, in
          variante traslucida per il fondo video scuro). */}
      <div className="absolute top-4 right-4 z-20 grid grid-cols-2 gap-0.5 p-0.5 rounded-full bg-white/15 backdrop-blur-sm">
        {(['it', 'en'] as const).map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setPreferredLang(code)}
            className={`px-3.5 py-1 rounded-full text-xs font-semibold uppercase tracking-[0.05em] transition-colors ${
              lang === code
                ? 'bg-white text-talea-green-dark shadow-sm'
                : 'text-white/80 hover:text-white hover:bg-white/10'
            }`}
            aria-pressed={lang === code}
          >
            {code}
          </button>
        ))}
      </div>

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

        {/* Divisore: la barra accento tricolore Talea (come sotto l'header di
            /explore), al posto del vecchio azzurro fuori palette. */}
        <div
          className="w-64 h-[3px] rounded-full"
          style={{
            background:
              'linear-gradient(90deg, var(--talea-green) 0%, var(--talea-blue) 50%, var(--talea-yellow) 100%)',
          }}
        />

        <p
          className="text-white text-base md:text-lg uppercase font-semibold text-center px-6"
          style={{
            letterSpacing: '0.3em',
            textShadow: '0 2px 10px rgba(0,0,0,0.9)',
          }}
        >
          {subtitle}
        </p>

        <Link
          href="/explore"
          className="group relative mt-3 px-12 py-4 border-2 border-talea-400 bg-talea-400/15 text-white text-sm uppercase font-bold cursor-pointer overflow-hidden backdrop-blur-sm transition-all duration-300 hover:text-white hover:border-talea-green active:scale-95"
          style={{
            letterSpacing: '0.4em',
            textShadow: '0 1px 6px rgba(0,0,0,0.8)',
          }}
        >
          <span className="absolute inset-0 bg-talea-green translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out" />
          <span className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-talea-yellow" />
          <span className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-talea-yellow" />
          <span className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-talea-yellow" />
          <span className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-talea-yellow" />
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
