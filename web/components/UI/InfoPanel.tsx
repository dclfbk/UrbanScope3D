'use client'

import { t, type Lang } from '@/lib/i18n'

type EnvSample = { key: string; label: string; unit: string; value: number | null }

type Props = {
  lat: number
  lon: number
  envSamples: EnvSample[]
  // Quota (m sul suolo) a cui si riferiscono i valori microclima, se il dato
  // attivo ha lo slider altezza. null = livello pedonale / dato senza quote.
  heightM?: number | null
  lang: Lang
  onClose: () => void
}

// NB: il blocco "temperatura sulla data" (media/max/min) e' stato RIMOSSO dal
// pannello del click: era la serie cittadina di Bologna, identica ovunque si
// cliccasse (non spaziale) -> ripetitiva e poco informativa. Vento e microclima
// ENVI-met restano perche' variano col punto. La temperatura cittadina, se
// servira', va mostrata come elemento FISSO (non legato al click).
export default function InfoPanel({
  lat,
  lon,
  envSamples,
  heightM,
  lang,
  onClose,
}: Props) {
  return (
    <div className="bg-talea-panel/85 border border-talea-400/30 rounded p-2 sm:p-3 backdrop-blur-sm shadow-xl w-full">
      <div className="flex items-center justify-between mb-2">
        <div className="text-talea-400 text-xs font-mono uppercase tracking-widest">
          {t('point', lang)}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-talea-300 text-base leading-none"
          aria-label={t('close', lang)}
        >
          &times;
        </button>
      </div>
      <div className="text-xs font-mono text-gray-300">
        {lat.toFixed(5)}, {lon.toFixed(5)}
      </div>

      {envSamples.length > 0 && (
        <>
          <div className="text-talea-400 text-xs font-mono uppercase tracking-widest mt-3 mb-1 flex items-baseline justify-between gap-2">
            <span>{t('microclimaValues', lang)}</span>
            {heightM != null && (
              <span
                className="text-talea-300/80 text-[10px] normal-case tracking-normal"
                title={lang === 'it' ? 'Quota dello slider altezza' : 'Height slider level'}
              >
                @ {heightM} m
              </span>
            )}
          </div>
          <div className="text-gray-200 text-sm font-mono flex flex-col gap-0.5">
            {envSamples.map((s) => (
              <div key={s.key} className="flex justify-between gap-2">
                <span className="text-gray-400">{s.label}</span>
                <span className="text-talea-200 whitespace-nowrap">
                  {s.value != null ? `${s.value} ${s.unit}` : t('noData', lang)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
