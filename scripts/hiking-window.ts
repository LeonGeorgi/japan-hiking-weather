import { HIKING_WINDOW, isRecord } from '../src/weather/schema.ts'
import type { HikingWeather } from '../src/weather/schema.ts'

export const HOURLY_VARIABLES = {
  temperature: ['temperature_2m', '°C'],
  feelsLike: ['apparent_temperature', '°C'],
  precipitation: ['precipitation', 'mm'],
  snowfall: ['snowfall', 'cm'],
  wind: ['wind_speed_10m', 'km/h'],
  gust: ['wind_gusts_10m', 'km/h'],
  visibility: ['visibility', 'm'],
  code: ['weather_code', 'wmo code'],
  isDay: ['is_day', ''],
} as const

type HourlyKey = keyof typeof HOURLY_VARIABLES
type HourlyForecast = Record<HourlyKey, (number | null)[]>

function parseHourlyForecast(value: Record<string, unknown>, dates: string[]): HourlyForecast {
  const { hourly, hourly_units: units } = value
  const expectedTimes = dates.flatMap((date) => Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`))
  if (!isRecord(hourly) || !isRecord(units) || JSON.stringify(hourly.time) !== JSON.stringify(expectedTimes)) throw new Error('Hourly forecast date mismatch')

  return Object.fromEntries(Object.entries(HOURLY_VARIABLES).map(([key, [variable, unit]]) => {
    const values = hourly[variable]
    if (units[variable] !== unit || !Array.isArray(values) || values.length !== expectedTimes.length) throw new Error(`Invalid hourly ${variable} data or units`)
    for (const entry of values) {
      if (entry === null) continue
      if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new Error(`Invalid hourly ${variable} value`)
      if (!['temperature', 'feelsLike'].includes(key) && entry < 0) throw new Error(`Negative hourly ${variable}`)
      if (key === 'isDay' && entry !== 0 && entry !== 1) throw new Error('Invalid daylight flag')
      if (key === 'code' && (!Number.isInteger(entry) || entry > 99)) throw new Error('Invalid hourly weather code')
    }
    return [key, values]
  })) as HourlyForecast
}

function aggregate(values: (number | null)[], indices: number[], combine: (values: number[]) => number): number | null {
  const selected = indices.map((index) => values[index])
  return selected.some((value) => value === null) ? null : combine(selected as number[])
}

export function hikingWindows(value: Record<string, unknown>, dates: string[]): (HikingWeather | null)[] {
  const hourly = parseHourlyForecast(value, dates)
  return dates.map((_, dayIndex) => {
    const start = dayIndex * 24 + HIKING_WINDOW.startHour
    const end = dayIndex * 24 + HIKING_WINDOW.endHour
    const window = Array.from({ length: end - start + 1 }, (_, index) => start + index)
    if (window.some((index) => hourly.isDay[index] === null)) return null

    // Each selected interval lies wholly within the window and model daylight.
    const intervals = window.slice(0, -1).filter((index) => hourly.isDay[index] === 1 && hourly.isDay[index + 1] === 1)
    if (intervals.length === 0) return null
    const instants = [...new Set(intervals.flatMap((index) => [index, index + 1]))]
    // Precipitation at 09:00 describes 08:00–09:00, unlike instantaneous fields.
    const precedingHours = intervals.map((index) => index + 1)
    const minimum = (values: number[]) => Math.min(...values)
    const maximum = (values: number[]) => Math.max(...values)
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
    const codes = instants.map((index) => hourly.code[index])
    return {
      hours: intervals.length,
      temperatureMin: aggregate(hourly.temperature, instants, minimum),
      feelsLikeMin: aggregate(hourly.feelsLike, instants, minimum),
      feelsLikeMax: aggregate(hourly.feelsLike, instants, maximum),
      precipitation: aggregate(hourly.precipitation, precedingHours, sum),
      precipitationMax: aggregate(hourly.precipitation, precedingHours, maximum),
      snowfall: aggregate(hourly.snowfall, precedingHours, sum),
      windMax: aggregate(hourly.wind, instants, maximum),
      gustMax: aggregate(hourly.gust, instants, maximum),
      visibilityMin: aggregate(hourly.visibility, instants, minimum),
      codes: codes.includes(null) ? null : [...new Set(codes as number[])],
    }
  })
}
