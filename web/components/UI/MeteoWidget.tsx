'use client'

import { t, type Lang } from '@/lib/i18n'

/**
 * Pannello meteo per Bologna. Ospita il widget ufficiale **3BMeteo**
 * (scelta utente: vero brand/dati 3BMeteo invece di una fonte generica).
 *
 * 3BMeteo non espone un'API JSON gratuita: l'unico canale free e' il widget
 * embeddabile generato dal loro builder (https://www.3bmeteo.com/widgets/builder).
 * Lo snippet scelto e' un iframe puro (modulo "localita_1_giorno_compatto").
 *
 * localita 745 = **Bologna** (verificato sullo snippet ufficiale del builder;
 * 8841 era VULCANO, il vecchio commento era sbagliato). Colori brand Talea:
 * sfondo bianco + accento blu 1272b7 + testo nero. La lingua segue il prop
 * `lang` (it/en, le uniche supportate dal widget). Lo rendiamo direttamente
 * come <iframe> (niente innerHTML/script injection: non serve, ed e' SSR-safe).
 *
 * Il backlink "Meteo" -> 3bmeteo.com e' richiesto dai termini d'uso del widget
 * gratuito: NON rimuoverlo.
 */
const METEO_LOC = 745 // Bologna
const meteoIframeSrc = (lang: Lang) =>
  `https://www.3bmeteo.com/moduli_esterni/localita_1_giorno_compatto/${METEO_LOC}/ffffff/1272b7/000000/ffffff/${lang === 'en' ? 'en' : 'it'}/0/1`
const METEO_LINK = `https://www.3bmeteo.com/meteo/${METEO_LOC}`
const METEO_W = 187
const METEO_H = 268

type MeteoWidgetProps = {
  lang: Lang
  onClose: () => void
}

export default function MeteoWidget({ lang, onClose }: MeteoWidgetProps) {
  return (
    <div className="absolute bottom-4 left-14 sm:left-16 z-20 w-fit max-w-[calc(100vw-5rem)] rounded-xl bg-talea-panel/85 border border-talea-400/30 backdrop-blur-sm shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-talea-400/20">
        <span className="text-sm font-semibold text-talea-100 flex items-center gap-1.5">
          <span aria-hidden="true">⛅</span>
          {t('meteoTitle', lang)}
        </span>
        <button
          type="button"
          onClick={onClose}
          title={t('close', lang)}
          aria-label={t('close', lang)}
          className="text-talea-300 hover:text-talea-100 transition-colors leading-none text-lg ml-3"
        >
          ×
        </button>
      </div>

      <div className="p-2">
        <iframe
          src={meteoIframeSrc(lang)}
          width={METEO_W}
          height={METEO_H}
          frameBorder="0"
          title={t('meteoTitle', lang)}
          className="block rounded-md"
        />
        {/* Backlink richiesto dai termini del widget gratuito 3BMeteo. */}
        <a
          href={METEO_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-1 text-[10px] text-talea-300/70 hover:text-talea-100 text-center"
        >
          Meteo · 3BMeteo
        </a>
      </div>
    </div>
  )
}
