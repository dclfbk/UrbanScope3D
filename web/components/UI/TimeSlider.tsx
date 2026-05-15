'use client'

import { getSunPosition } from '@/lib/sun'

type Props = {
  value: Date
  onChange: (d: Date) => void
  lat: number
  lon: number
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function TimeSlider({ value, onChange, lat, lon }: Props) {
  const totalMin = value.getHours() * 60 + value.getMinutes()
  const sun = getSunPosition(value, lat, lon)

  const setMinutes = (m: number) => {
    const d = new Date(value)
    d.setHours(Math.floor(m / 60))
    d.setMinutes(m % 60)
    d.setSeconds(0)
    onChange(d)
  }

  const setDate = (iso: string) => {
    const [y, m, day] = iso.split('-').map(Number)
    if (!y || !m || !day) return
    const d = new Date(value)
    d.setFullYear(y)
    d.setMonth(m - 1)
    d.setDate(day)
    onChange(d)
  }

  const fmt = value.toLocaleString('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-gray-900/85 border border-cyan-400/30 rounded p-3 backdrop-blur-sm shadow-xl min-w-[460px]">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-cyan-400 text-xs font-mono uppercase tracking-widest">
          Sole
        </div>
        <input
          type="date"
          value={isoDate(value)}
          onChange={(e) => setDate(e.target.value)}
          className="bg-gray-800 border border-cyan-400/30 text-cyan-300 text-xs font-mono rounded px-2 py-1 cursor-pointer"
        />
        <div className="text-gray-200 text-xs font-mono">{fmt}</div>
      </div>

      <input
        type="range"
        min={0}
        max={1439}
        step={15}
        value={totalMin}
        onChange={(e) => setMinutes(Number(e.target.value))}
        className={`sun-moon-slider w-full cursor-pointer ${
          sun.isDay ? 'is-day' : 'is-night'
        }`}
      />

      <div className="flex justify-between mt-1 text-[10px] font-mono text-gray-400">
        <span>az {sun.azimuthDeg.toFixed(0)}&deg;</span>
        <span>alt {sun.altitudeDeg.toFixed(0)}&deg;</span>
        <span className={sun.isDay ? 'text-amber-400' : 'text-blue-400'}>
          {sun.isDay ? 'giorno' : 'notte'}
        </span>
      </div>
    </div>
  )
}
