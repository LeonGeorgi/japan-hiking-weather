export const WEATHER_MODEL = 'ecmwf_ifs'
export const WEATHER_TIMEZONE = 'Asia/Tokyo'

export interface DailyWeather {
  code: number | null
  temperatureMin: number | null
  temperatureMax: number | null
  precipitation: number | null
  snowfall: number | null
  windMax: number | null
  gustMax: number | null
}

export interface WeatherSnapshot {
  version: 1
  model: typeof WEATHER_MODEL
  resolutionKm: 9
  timezone: typeof WEATHER_TIMEZONE
  startedAt: string
  fetchedAt: string
  dates: string[]
  forecasts: Record<string, DailyWeather[]>
}

export function dateInJapan(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: WEATHER_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isDailyWeather(value: unknown): value is DailyWeather {
  if (!isRecord(value)) return false
  const fields = ['code', 'temperatureMin', 'temperatureMax', 'precipitation', 'snowfall', 'windMax', 'gustMax']
  if (!fields.every((field) => isNullableNumber(value[field]))) return false
  if (value.code !== null && (!Number.isInteger(value.code) || Number(value.code) < 0 || Number(value.code) > 99)) return false
  for (const field of ['precipitation', 'snowfall', 'windMax', 'gustMax']) {
    if (value[field] !== null && Number(value[field]) < 0) return false
  }
  return value.temperatureMin === null || value.temperatureMax === null || Number(value.temperatureMin) <= Number(value.temperatureMax)
}

export function parseWeatherSnapshot(value: unknown): WeatherSnapshot {
  if (!isRecord(value) || value.version !== 1 || value.model !== WEATHER_MODEL || value.resolutionKm !== 9 || value.timezone !== WEATHER_TIMEZONE) {
    throw new Error('Unsupported weather dataset')
  }
  if (typeof value.startedAt !== 'string' || typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.fetchedAt))) {
    throw new Error('Invalid weather timestamps')
  }
  const dates = value.dates
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > 15 || !dates.every((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('Invalid forecast dates')
  }
  if (!dates.every((date, index) => date === addDays(dates[0], index))) {
    throw new Error('Forecast dates must be consecutive')
  }
  if (!isRecord(value.forecasts) || Object.keys(value.forecasts).length === 0) throw new Error('Missing summit forecasts')
  for (const [id, daily] of Object.entries(value.forecasts)) {
    if (!/^\d+$/.test(id) || !Array.isArray(daily) || daily.length !== dates.length || !daily.every(isDailyWeather)) {
      throw new Error(`Invalid forecast for summit ${id}`)
    }
  }
  return value as unknown as WeatherSnapshot
}
