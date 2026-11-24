import { dateInJapan, WEATHER_TIMEZONE } from './schema.ts'
import type { WeatherSnapshot } from './schema.ts'
import { HIKING_WINDOW } from './config.ts'

const conditions = {
  clear: { label: 'Klar / heiter', color: '#d49a00' },
  clouds: { label: 'Bewölkt', color: '#64748b' },
  fog: { label: 'Nebel', color: '#a78bfa' },
  rain: { label: 'Regen / Niesel', color: '#2563eb' },
  snow: { label: 'Schnee', color: '#06b6d4' },
  storm: { label: 'Gewitter', color: '#be123c' },
  unavailable: { label: 'Keine Daten', color: '#c2410c' },
}

export const hikingLegend = [
  { minimum: 80, range: '80–100', label: 'Sehr günstig', color: '#15803d' },
  { minimum: 60, range: '60–79', label: 'Günstig', color: '#65a30d' },
  { minimum: 40, range: '40–59', label: 'Gemischt', color: '#ca8a04' },
  { minimum: 20, range: '20–39', label: 'Ungünstig', color: '#ea580c' },
  { minimum: 0, range: '0–19', label: 'Sehr ungünstig', color: '#be123c' },
]

export function hikingCondition(score: number | null) {
  return hikingLegend.find(({ minimum }) => score !== null && score >= minimum)
    ?? { label: 'Nicht bewertbar', color: '#94a3b8' }
}

export function formatHikingFactor(score: number | null): string {
  if (score === null) return '–'
  if (score > 0 && score < 0.1) return '< 0,1'
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(score)
}

export function formatHikingWindow(): string {
  const start = String(HIKING_WINDOW.startHour).padStart(2, '0')
  const end = String(HIKING_WINDOW.endHour).padStart(2, '0')
  return `${start}–${end} Uhr JST`
}

export function weatherCondition(code: number | null | undefined) {
  if (code === 0 || code === 1) return conditions.clear
  if (code === 2 || code === 3) return conditions.clouds
  if (code === 45 || code === 48) return conditions.fog
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code ?? -1)) return conditions.rain
  if ([71, 73, 75, 77, 85, 86].includes(code ?? -1)) return conditions.snow
  if ([95, 96, 97, 99].includes(code ?? -1)) return conditions.storm
  return conditions.unavailable
}

export function defaultForecastDate(dates: string[], now = new Date()): string {
  const today = dateInJapan(now)
  return dates.find((date) => date >= today) ?? dates.at(-1) ?? ''
}

export function formatForecastDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: WEATHER_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T12:00:00+09:00`))
}

export function formatFetchedAt(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: WEATHER_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatWeatherValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return '–'
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value)} ${unit}`
}

export function isForecastStale(snapshot: WeatherSnapshot, now = new Date()): boolean {
  return now.getTime() - Date.parse(snapshot.fetchedAt) > 18 * 60 * 60 * 1_000 || !snapshot.dates.includes(dateInJapan(now))
}
