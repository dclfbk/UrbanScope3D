import SunCalc from 'suncalc'

export type SunPosition = {
  azimuthDeg: number
  altitudeDeg: number
  isDay: boolean
}

export function getSunPosition(
  date: Date,
  lat: number,
  lon: number,
): SunPosition {
  const p = SunCalc.getPosition(date, lat, lon)
  const compassRad = p.azimuth + Math.PI
  const compassDeg = ((compassRad * 180) / Math.PI + 360) % 360
  const altDeg = (p.altitude * 180) / Math.PI
  return {
    azimuthDeg: compassDeg,
    altitudeDeg: altDeg,
    isDay: altDeg > 0,
  }
}

export function toMapLibreLight(sun: SunPosition) {
  const polar = Math.max(0, Math.min(180, 90 - sun.altitudeDeg))
  return {
    anchor: 'map' as const,
    position: [1.5, sun.azimuthDeg, polar] as [number, number, number],
    color: '#ffffff',
    intensity: sun.isDay ? 0.5 : 0.15,
  }
}
