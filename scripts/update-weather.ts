import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { addDays, dateInJapan, isRecord, parseWeatherSnapshot, WEATHER_MODEL, WEATHER_TIMEZONE } from '../src/weather/schema.ts'
import type { DailyWeather, WeatherSnapshot } from '../src/weather/schema.ts'
import { hikingWindows, HOURLY_VARIABLES } from './hiking-window.ts'

export interface SummitLocation {
  id: number
  latitude: number
  longitude: number
  elevation: number
}

const ENDPOINT = 'https://api.open-meteo.com/v1/ecmwf'
const FORECAST_DAYS = 7
const BATCH_SIZE = 50
// 16 requested variables count as ~1.6 calls per location; stay below 600/min.
const REQUEST_INTERVAL_MS = 12_000
const VARIABLES = {
  code: ['weather_code', 'wmo code'],
  temperatureMin: ['temperature_2m_min', '°C'],
  temperatureMax: ['temperature_2m_max', '°C'],
  precipitation: ['precipitation_sum', 'mm'],
  snowfall: ['snowfall_sum', 'cm'],
  windMax: ['wind_speed_10m_max', 'km/h'],
  gustMax: ['wind_gusts_10m_max', 'km/h'],
} as const

export function buildForecastUrl(summits: SummitLocation[], dates: string[]): URL {
  const url = new URL(ENDPOINT)
  url.search = new URLSearchParams({
    latitude: summits.map((summit) => summit.latitude.toFixed(6)).join(','),
    longitude: summits.map((summit) => summit.longitude.toFixed(6)).join(','),
    elevation: summits.map((summit) => summit.elevation).join(','),
    models: WEATHER_MODEL,
    daily: Object.values(VARIABLES).map(([variable]) => variable).join(','),
    hourly: Object.values(HOURLY_VARIABLES).map(([variable]) => variable).join(','),
    timezone: WEATHER_TIMEZONE,
    start_date: dates[0],
    end_date: dates.at(-1)!,
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
    cell_selection: 'land',
  }).toString()
  return url
}

export function parseLocationForecast(value: unknown, summit: SummitLocation, dates: string[]): DailyWeather[] {
  if (!isRecord(value) || value.error || value.timezone !== WEATHER_TIMEZONE || value.utc_offset_seconds !== 32_400 || value.elevation !== summit.elevation) {
    throw new Error(`Invalid location metadata for summit ${summit.id}`)
  }
  const daily = value.daily
  const units = value.daily_units
  if (!isRecord(daily) || !isRecord(units) || JSON.stringify(daily.time) !== JSON.stringify(dates)) {
    throw new Error(`Forecast date mismatch for summit ${summit.id}`)
  }
  for (const [variable, unit] of Object.values(VARIABLES)) {
    if (units[variable] !== unit || !Array.isArray(daily[variable]) || daily[variable].length !== dates.length) {
      throw new Error(`Invalid ${variable} data or units for summit ${summit.id}`)
    }
  }
  const hiking = hikingWindows(value, dates)
  return dates.map((_, index) => ({
    ...Object.fromEntries(Object.entries(VARIABLES).map(([field, [variable]]) => [field, (daily[variable] as unknown[])[index]])),
    hiking: hiking[index],
  }) as unknown as DailyWeather)
}

interface FetchOptions {
  fetchFn?: typeof fetch
  sleep?: (milliseconds: number) => Promise<unknown>
  now?: Date
  batchSize?: number
  intervalMs?: number
  onProgress?: (completed: number, total: number) => void
}

async function requestForecast(url: URL, fetchFn: typeof fetch, sleep: NonNullable<FetchOptions['sleep']>): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response
    try {
      response = await fetchFn(url, { signal: AbortSignal.timeout(45_000) })
    } catch (error) {
      if (attempt === 3) throw error
      await sleep(5_000 * 2 ** attempt)
      continue
    }
    if (response.ok) return response.json()
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = response.headers.get('retry-after')
      const seconds = retryAfter ? Number(retryAfter) : NaN
      const until = retryAfter ? Date.parse(retryAfter) - Date.now() : NaN
      const wait = Number.isFinite(seconds) ? seconds * 1_000 : Number.isFinite(until) ? until : 5_000 * 2 ** attempt
      await response.body?.cancel()
      await sleep(Math.max(wait, 5_000))
      continue
    }
    throw new Error(`Open-Meteo HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
  }
  throw new Error('Forecast request failed')
}

export async function fetchWeatherSnapshot(summits: SummitLocation[], options: FetchOptions = {}): Promise<WeatherSnapshot> {
  if (summits.length === 0 || new Set(summits.map((summit) => summit.id)).size !== summits.length) throw new Error('Summits must be nonempty and unique')
  const now = options.now ?? new Date()
  const dates = Array.from({ length: FORECAST_DAYS }, (_, index) => addDays(dateInJapan(now), index))
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ?? delay
  const batchSize = options.batchSize ?? BATCH_SIZE
  const interval = options.intervalMs ?? REQUEST_INTERVAL_MS
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > BATCH_SIZE || interval < 0) throw new Error('Invalid batching options')
  const forecasts: WeatherSnapshot['forecasts'] = {}

  for (let offset = 0; offset < summits.length; offset += batchSize) {
    if (offset > 0) await sleep(interval)
    const batch = summits.slice(offset, offset + batchSize)
    const result = await requestForecast(buildForecastUrl(batch, dates), fetchFn, sleep)
    const locations = Array.isArray(result) ? result : [result]
    if (locations.length !== batch.length) throw new Error('Incomplete forecast batch')
    batch.forEach((summit, index) => {
      forecasts[String(summit.id)] = parseLocationForecast(locations[index], summit, dates)
    })
    options.onProgress?.(Math.min(offset + batchSize, summits.length), summits.length)
  }

  return parseWeatherSnapshot({
    version: 1,
    model: WEATHER_MODEL,
    resolutionKm: 9,
    timezone: WEATHER_TIMEZONE,
    startedAt: now.toISOString(),
    fetchedAt: new Date().toISOString(),
    dates,
    forecasts,
  })
}

export async function writeWeatherSnapshot(path: string, snapshot: WeatherSnapshot): Promise<void> {
  parseWeatherSnapshot(snapshot)
  const temporaryPath = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, JSON.stringify(snapshot) + '\n')
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

async function main() {
  const source = JSON.parse(await readFile(new URL('../src/data/gsi-mountains.json', import.meta.url), 'utf8'))
  const summits: SummitLocation[] = source.features.map(({ properties, geometry }: {
    properties: { '連番': number; '標高値(m)': number }
    geometry: { coordinates: [number, number] }
  }) => ({
    id: properties['連番'],
    longitude: geometry.coordinates[0],
    latitude: geometry.coordinates[1],
    elevation: properties['標高値(m)'],
  }))
  for (const summit of summits) {
    if (!Number.isInteger(summit.id) || !Number.isFinite(summit.latitude) || !Number.isFinite(summit.longitude) || !Number.isFinite(summit.elevation)) throw new Error('Invalid source summit')
  }
  console.log(`Fetching ${WEATHER_MODEL} for ${summits.length} summits, ${FORECAST_DAYS} days, ${WEATHER_TIMEZONE}.`)
  const snapshot = await fetchWeatherSnapshot(summits, {
    onProgress: (completed, total) => console.log(`Fetched ${completed}/${total} summit forecasts.`),
  })
  const directory = new URL('../public/weather/', import.meta.url)
  await mkdir(directory, { recursive: true })
  const target = fileURLToPath(new URL('forecast.json', directory))
  await writeWeatherSnapshot(target, snapshot)
  console.log(`Wrote ${target} (${snapshot.dates[0]} to ${snapshot.dates.at(-1)}).`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
