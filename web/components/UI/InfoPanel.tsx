'use client'

import type { TempLookup } from '@/lib/temperature'
import { t, tFmt, type Lang } from '@/lib/i18n'

type EnvSample = { key: string; label: string; unit: string; value: number | null }

type Props = {
  lat: number
  lon: number
  date: Date
  temp: TempLookup | null
  loading: boolean
  windSpeed: number | null
  envSamples: EnvSample[]
  lang: Lang
  onClose: () => void
}

export default function InfoPanel({
  lat,
  lon,
  date,
  temp,
  loading,
  windSpeed,
  envSamples,
  lang,
  onClose,
}: Props) {
  const dateStr = date.toLocaleDateString(
    lang === 'it' ? 'it-IT' : 'en-GB',
    { dateStyle: 'medium' },
  )
  return (
    <div className="bg-gray-900/85 border border-cyan-400/30 rounded p-2 sm:p-3 backdrop-blur-sm shadow-xl w-full">
      <div className="flex items-center justify-between mb-2">
        <div className="text-cyan-400 text-xs font-mono uppercase tracking-widest">
          {t('point', lang)}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-cyan-300 text-base leading-none"
          aria-label={t('close', lang)}
        >
          &times;
        </button>
      </div>
      <div className="text-xs font-mono text-gray-300 mb-2">
        {lat.toFixed(5)}, {lon.toFixed(5)}
      </div>
      <div className="text-cyan-400 text-xs font-mono uppercase tracking-widest mb-1">
        {t('temperatureOn', lang)} &middot; {dateStr}
      </div>
      {loading && (
        <div className="text-gray-400 text-sm">{t('loadingShort', lang)}</div>
      )}
      {!loading && temp?.exact && (
        <div className="text-gray-200 text-sm font-mono">
          <div>
            {t('avg', lang)}{' '}
            <span className="text-amber-300">
              {temp.exact.avg.toFixed(1)}&deg;C
            </span>
          </div>
          <div>
            {t('max', lang)}{' '}
            <span className="text-red-300">
              {temp.exact.max.toFixed(1)}&deg;C
            </span>
          </div>
          <div>
            {t('min', lang)}{' '}
            <span className="text-blue-300">
              {temp.exact.min.toFixed(1)}&deg;C
            </span>
          </div>
        </div>
      )}
      {!loading && !temp?.exact && temp?.climatology && (
        <div className="text-gray-200 text-sm font-mono">
          <div>
            {t('avg', lang)}{' '}
            <span className="text-amber-300">
              {temp.climatology.avg.toFixed(1)}&deg;C
            </span>
          </div>
          <div>
            {t('max', lang)}{' '}
            <span className="text-red-300">
              {temp.climatology.max.toFixed(1)}&deg;C
            </span>
          </div>
          <div>
            {t('min', lang)}{' '}
            <span className="text-blue-300">
              {temp.climatology.min.toFixed(1)}&deg;C
            </span>
          </div>
          <div className="text-gray-500 text-[10px] mt-1">
            {tFmt('climatologyNote', lang, { n: temp.climatology.samples })}
          </div>
        </div>
      )}
      {!loading && !temp?.exact && !temp?.climatology && (
        <div className="text-gray-400 text-sm">{t('noData', lang)}</div>
      )}
      <div className="text-gray-500 text-[10px] mt-2 italic">
        {t('tempSource', lang)}
      </div>

      {windSpeed != null && (
        <>
          <div className="text-cyan-400 text-xs font-mono uppercase tracking-widest mt-3 mb-1">
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
          <div className="text-cyan-400 text-xs font-mono uppercase tracking-widest mt-3 mb-1">
            {t('microclimaValues', lang)}
          </div>
          <div className="text-gray-200 text-sm font-mono flex flex-col gap-0.5">
            {envSamples.map((s) => (
              <div key={s.key} className="flex justify-between gap-2">
                <span className="text-gray-400">{s.label}</span>
                <span className="text-cyan-200 whitespace-nowrap">
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
