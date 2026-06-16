'use client'

import { t, type Lang } from '@/lib/i18n'

type EnvSample = { key: string; label: string; unit: string; value: number | null }

type Props = {
  lat: number
  lon: number
  windSpeed: number | null
  envSamples: EnvSample[]
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
  windSpeed,
  envSamples,
  lang,
  onClose,
}: Props) {
  return (
    <div className="bg-gray-900/85 border border-talea-400/30 rounded p-2 sm:p-3 backdrop-blur-sm shadow-xl w-full">
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

      {windSpeed != null && (
        <>
          <div className="text-talea-400 text-xs font-mono uppercase tracking-widest mt-3 mb-1">
            {t('windSpeed', lang)}
          </div>
          <div className="text-gray-200 text-sm font-mono">
            <span className="text-emerald-300">
              {windSpeed.toFixed(2)} m/s
            </span>
          </div>
          <div className="text-gray-500 text-[10px] mt-1 italic">
            {t('windSource', lang)}
          </div>
        </>
      )}

      {envSamples.length > 0 && (
        <>
          <div className="text-talea-400 text-xs font-mono uppercase tracking-widest mt-3 mb-1">
            {t('microclimaValues', lang)}
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
