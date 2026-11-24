import { HIKING_WINDOW, WEATHER_TIMEZONE } from './config.ts'

export const WEATHER_MODEL = 'ecmwf_ifs'
export { HIKING_WINDOW, WEATHER_TIMEZONE }

export interface HikingWeather {
  hours: number
  temperatureMin: number | null
  feelsLikeMin: number | null
  feelsLikeMax: number | null
  precipitation: number | null
  precipitationMax: number | null
  snowfall: number | null
  windMax: number | null
  gustMax: number | null
  visibilityMin: number | null
  codes: number[] | null
}

export interface DailyWeather {
  model?: 'ecmwf_ifs' | 'jma_msm'
  dailySupplemented?: boolean
  code: number | null
  temperatureMin: number | null
  temperatureMax: number | null
  precipitation: number | null
  snowfall: number | null
  windMax: number | null
  gustMax: number | null
  // Older snapshots still provide the daily forecast, without a hiking rating.
  hiking?: HikingWeather | null
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
  grid?: NativeWeatherGrid
  msmGrid?: NativeWeatherGrid
  surface?: TerrainWeatherSurface
}

export interface TerrainWeatherSurface {
  source: 'gsi-dem'
  resolutionMetres: 250
  minZoom: 5
  zoom: 9
  path: string
  tiles: string[]
}

export interface NativeWeatherGrid {
  kind: 'native-ifs' | 'native-msm'
  resolutionKm: 5 | 9
  modelRuns: (string | null)[]
  south: number
  north: number
  west: number
  east: number
  // Native rows, north to south. IFS longitude spacing varies per row.
  rows: { latitude: number; west: number; step: number; count: number }[]
  // One base64-encoded byte per cell: 0–100, or 255 for unknown.
  scores: (string | null)[]
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
  if (value.model !== undefined && value.model !== 'ecmwf_ifs' && value.model !== 'jma_msm') return false
  if (value.dailySupplemented !== undefined && typeof value.dailySupplemented !== 'boolean') return false
  const fields = ['code', 'temperatureMin', 'temperatureMax', 'precipitation', 'snowfall', 'windMax', 'gustMax']
  if (!fields.every((field) => isNullableNumber(value[field]))) return false
  if (value.code !== null && (!Number.isInteger(value.code) || Number(value.code) < 0 || Number(value.code) > 99)) return false
  for (const field of ['precipitation', 'snowfall', 'windMax', 'gustMax']) {
    if (value[field] !== null && Number(value[field]) < 0) return false
  }
  if (value.hiking !== undefined && value.hiking !== null && !isHikingWeather(value.hiking)) return false
  return value.temperatureMin === null || value.temperatureMax === null || Number(value.temperatureMin) <= Number(value.temperatureMax)
}

export function isHikingWeather(value: unknown): value is HikingWeather {
  if (!isRecord(value) || !Number.isInteger(value.hours) || Number(value.hours) < 1 || Number(value.hours) > HIKING_WINDOW.endHour - HIKING_WINDOW.startHour) return false
  const fields = ['temperatureMin', 'feelsLikeMin', 'feelsLikeMax', 'precipitation', 'precipitationMax', 'snowfall', 'windMax', 'gustMax', 'visibilityMin']
  if (!fields.every((field) => isNullableNumber(value[field]))) return false
  for (const field of ['precipitation', 'precipitationMax', 'snowfall', 'windMax', 'gustMax', 'visibilityMin']) {
    if (value[field] !== null && Number(value[field]) < 0) return false
  }
  if (value.feelsLikeMin !== null && value.feelsLikeMax !== null && Number(value.feelsLikeMin) > Number(value.feelsLikeMax)) return false
  return value.codes === null || (Array.isArray(value.codes) && value.codes.length > 0 && value.codes.every((code) => Number.isInteger(code) && code >= 0 && code <= 99))
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
  if (value.grid !== undefined && !isNativeWeatherGrid(value.grid, dates.length)) throw new Error('Invalid weather grid')
  if (value.msmGrid !== undefined && !isNativeWeatherGrid(value.msmGrid, dates.length, 'native-msm')) throw new Error('Invalid MSM weather grid')
  if (value.surface !== undefined && !isTerrainWeatherSurface(value.surface)) throw new Error('Invalid terrain weather surface')
  return value as unknown as WeatherSnapshot
}

function isTerrainWeatherSurface(value: unknown): value is TerrainWeatherSurface {
  if (!isRecord(value) || value.source !== 'gsi-dem' || value.resolutionMetres !== 250 || value.minZoom !== 5 || value.zoom !== 9
    || typeof value.path !== 'string' || !/^surfaces\/[a-f0-9]{32}$/.test(value.path)
    || !Array.isArray(value.tiles) || value.tiles.length === 0 || value.tiles.length > 3000) return false
  const unique = new Set(value.tiles)
  return unique.size === value.tiles.length && value.tiles.every((tile) => {
    if (typeof tile !== 'string' || !/^\d+\/\d+\/\d+$/.test(tile)) return false
    const [z, x, y] = tile.split('/').map(Number)
    return z >= 5 && z <= 9 && x < 2 ** z && y < 2 ** z
  })
}

function isNativeWeatherGrid(value: unknown, days: number, kind: NativeWeatherGrid['kind'] = 'native-ifs'): value is NativeWeatherGrid {
  if (!isRecord(value) || value.kind !== kind) return false
  if (value.resolutionKm !== (kind === 'native-msm' ? 5 : 9) || !Array.isArray(value.rows) || value.rows.length < 2 || value.rows.length > 1000) return false
  if (!['south', 'north', 'west', 'east'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))) return false
  if (Number(value.south) < -85 || Number(value.north) > 85 || Number(value.south) >= Number(value.north) || Number(value.west) < -180 || Number(value.east) > 180 || Number(value.west) >= Number(value.east)) return false
  let points = 0
  let previousLatitude = Infinity
  for (const row of value.rows) {
    if (!isRecord(row) || !['latitude', 'west', 'step', 'count'].every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]))) return false
    const { latitude, west, step, count } = row as NativeWeatherGrid['rows'][number]
    if (latitude >= previousLatitude || latitude < Number(value.south) || latitude > Number(value.north)
      || west < Number(value.west) || step <= 0 || step > 1 || !Number.isInteger(count) || count < 2
      || west + (count - 1) * step > Number(value.east) + 1e-8) return false
    previousLatitude = latitude
    points += count
  }
  const runs = value.modelRuns
  if (points > 200000 || !Array.isArray(runs) || runs.length !== days || !runs.every((run) =>
    (kind === 'native-msm' && run === null) || (typeof run === 'string' && Number.isFinite(Date.parse(run))))) return false
  if (!Array.isArray(value.scores) || value.scores.length !== days) return false
  return value.scores.every((encoded, day) => {
    if (encoded === null) return kind === 'native-msm' && runs[day] === null
    if (runs[day] === null) return false
    if (typeof encoded !== 'string' || encoded.length !== Math.ceil(points / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false
    try {
      const bytes = atob(encoded)
      return bytes.length === points && [...bytes].every((byte) => byte.charCodeAt(0) <= 100 || byte.charCodeAt(0) === 255)
    } catch {
      return false
    }
  })
}
