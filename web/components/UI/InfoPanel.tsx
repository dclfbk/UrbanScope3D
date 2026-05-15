'use client'

import type { TempLookup } from '@/lib/temperature'

type Props = {
  lat: number
  lon: number
  date: Date
  temp: TempLookup | null
  loading: boolean
  onClose: () => void
}

export default function InfoPanel({
  lat,
  lon,
  date,
  temp,
  loading,
  onClose,
}: Props) {
  const dateStr = date.toLocaleDateString('it-IT', { dateStyle: 'medium' })
  return (
    <div className="absolute top-4 right-4 z-10 bg-gray-900/85 border border-cyan-400/30 rounded p-3 backdrop-blur-sm shadow-xl min-w-[260px]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-cyan-400 text-xs font-mono uppercase tracking-widest">
          Punto
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-cyan-300 text-base leading-none"
          aria-label="Chiudi"
        >
          &times;
        </button>
      </div>
      <div className="text-xs font-mono text-gray-300 mb-2">
        {lat.toFixed(5)}, {lon.toFixed(5)}
      </div>
      <div className="text-cyan-400 text-xs font-mono uppercase tracking-widest mb-1">
        Temperatura &middot; {dateStr}
      </div>
      {loading && (
        <div className="text-gray-400 text-sm">caricamento...</div>
      )}
      {!loading && temp?.exact && (
        <div className="text-gray-200 text-sm font-mono">
          <div>
            media{' '}
            <span className="text-amber-300">
              {temp.exact.avg.toFixed(1)}&deg;C
            </span>
          </div>
          <div>
            max{' '}
            <span className="text-red-300">
              {temp.exact.max.toFixed(1)}&deg;C
            </span>
          </div>
          <div>
            min{' '}
            <span className="text-blue-300">
              {temp.exact.min.toFixed(1)}&deg;C
            </span>
          </div>
        </div>
      )}
      {!loading && !temp?.exact && temp?.climatology && (
        <div className="text-gray-200 text-sm font-mono">
          <div>
            media{' '}
            <span className="text-amber-300">
              {temp.climatology.avg.toFixed(1)}&deg;C
            </span>
          </div>
          <div>
            max{' '}
            <span className="text-red-300">
              {temp.climatology.max.toFixed(1)}&deg;C
            </span>
          </div>
          <div>
            min{' '}
            <span className="text-blue-300">
              {temp.climatology.min.toFixed(1)}&deg;C
            </span>
          </div>
          <div className="text-gray-500 text-[10px] mt-1">
            climatologia, media su {temp.climatology.samples} anni
          </div>
        </div>
      )}
      {!loading && !temp?.exact && !temp?.climatology && (
        <div className="text-gray-400 text-sm">Nessun dato</div>
      )}
      <div className="text-gray-500 text-[10px] mt-2 italic">
        sorgente: Open Data Bologna (citta&apos;-wide)
      </div>
    </div>
  )
}
