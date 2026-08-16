'use client'

import { t, type Lang } from '@/lib/i18n'
import { rampColorAt, type RampKey } from '@/lib/envimetRegistry'

type EnvSample = { key: string; label: string; unit: string; value: number | null }

// Profilo VERTICALE della variabile attiva al punto cliccato: tutte le quote
// del cubo ENVI-met (54 bande), lette dal GeoTIFF decodificato nel browser.
type EnvProfile = {
  label: string
  unit: string
  ramp: RampKey
  vmin: number
  vmax: number
  points: { zM: number; v: number | null }[]
  /** Indice banda dello slider quota: la riga evidenziata. */
  currentBand: number
}

type Props = {
  lat: number
  lon: number
  envSamples: EnvSample[]
  // Quota (m sul suolo) a cui si riferiscono i valori microclima, se il dato
  // attivo ha lo slider altezza. null = livello pedonale / dato senza quote.
  heightM?: number | null
  profile?: EnvProfile | null
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
  profile,
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
          className="text-[#5a7a67] hover:text-talea-300 text-base leading-none"
          aria-label={t('close', lang)}
        >
          &times;
        </button>
      </div>
      <div className="text-xs font-mono text-talea-300">
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
          <div className="text-talea-200 text-sm font-mono flex flex-col gap-0.5">
            {envSamples.map((s) => (
              <div key={s.key} className="flex justify-between gap-2">
                <span className="text-[#5a7a67]">{s.label}</span>
                <span className="text-talea-200 whitespace-nowrap">
                  {s.value != null ? `${s.value} ${s.unit}` : t('noData', lang)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* PROFILO VERTICALE: il valore della variabile attiva a TUTTE le quote
          del cubo ENVI-met in questo punto (barre orizzontali colorate con la
          stessa rampa dell'overlay; la quota dello slider e' evidenziata).
          Reso possibile dal cubo GeoTIFF completo in memoria nel browser. */}
      {profile && (
        <>
          <div className="text-talea-400 text-xs font-mono uppercase tracking-widest mt-3 mb-1">
            {lang === 'it' ? 'Profilo in quota' : 'Vertical profile'}
          </div>
          <div className="text-[#5a7a67] text-[10px] font-mono mb-1">
            {profile.label} ({profile.unit})
          </div>
          <div className="flex flex-col-reverse gap-px" aria-hidden>
            {profile.points.map((p, i) => {
              const span = Math.max(1e-9, profile.vmax - profile.vmin)
              const tNorm =
                p.v == null
                  ? null
                  : Math.max(0, Math.min(1, (p.v - profile.vmin) / span))
              const [r, g, b] =
                tNorm == null ? [90, 122, 103] : rampColorAt(profile.ramp, tNorm)
              const isCur = i === profile.currentBand
              // Barre sottili: 54 quote in ~120 px. Larghezza = valore
              // normalizzato; NoData = trattino corto grigio.
              return (
                <div key={i} className="flex items-center gap-1">
                  <div
                    className="h-[2px] rounded-sm"
                    style={{
                      width: `${tNorm == null ? 4 : 8 + tNorm * 82}%`,
                      background: `rgb(${r},${g},${b})`,
                      outline: isCur ? '1px solid #fff' : undefined,
                    }}
                  />
                  {isCur && (
                    <span className="text-talea-100 text-[9px] font-mono leading-none whitespace-nowrap">
                      {Math.round(p.zM * 10) / 10} m
                      {p.v != null ? ` · ${Math.round(p.v * 10) / 10}` : ''}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex justify-between text-[#5a7a67] text-[9px] font-mono mt-0.5">
            <span>{lang === 'it' ? 'suolo' : 'ground'}</span>
            <span>
              {Math.round(
                (profile.points[profile.points.length - 1]?.zM ?? 0) * 10,
              ) / 10}{' '}
              m
            </span>
          </div>
        </>
      )}
    </div>
  )
}
