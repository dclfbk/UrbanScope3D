import { withBase } from './basePath'

export type TempRecord = {
  date: string
  avg: number
  max: number
  min: number
  stagione: string
}

export type TempLookup = {
  exact?: TempRecord
  climatology?: {
    avg: number
    max: number
    min: number
    samples: number
  }
}

let cache: Promise<TempRecord[]> | null = null

export function loadTemperatureSeries(): Promise<TempRecord[]> {
  if (cache) return cache
  cache = fetch(withBase('/data/5)EnvironmentalData/5.1_temperature_bologna.csv'))
    .then((r) => r.text())
    .then((text) => {
      const out: TempRecord[] = []
      const lines = text.split('\n')
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue
        const [date, avg, max, min, stagione] = line.split(';')
        if (!date || !avg) continue
        const a = Number(avg)
        const mx = Number(max)
        const mn = Number(min)
        if (Number.isNaN(a) || Number.isNaN(mx) || Number.isNaN(mn)) continue
        out.push({ date, avg: a, max: mx, min: mn, stagione: stagione || '' })
      }
      return out
    })
  return cache
}

export function lookupTemperature(
  records: TempRecord[],
  date: Date,
): TempLookup {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const iso = `${y}-${m}-${d}`
  const exact = records.find((r) => r.date === iso)
  if (exact) return { exact }

  const md = `${m}-${d}`
  const same = records.filter((r) => r.date.slice(5) === md)
  if (!same.length) return {}

  const round1 = (v: number) => Math.round(v * 10) / 10
  return {
    climatology: {
      avg: round1(same.reduce((s, r) => s + r.avg, 0) / same.length),
      max: round1(same.reduce((s, r) => s + r.max, 0) / same.length),
      min: round1(same.reduce((s, r) => s + r.min, 0) / same.length),
      samples: same.length,
    },
  }
}
