import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessHikingWeather } from '../src/weather/scoring.ts'
import { FORECAST_DAYS, NATIVE_GRID_BOUNDS, NATIVE_METRICS } from '../src/weather/config.ts'
import { addDays, dateInJapan, isHikingWeather, isRecord, parseWeatherSnapshot, WEATHER_MODEL, WEATHER_TIMEZONE } from '../src/weather/schema.ts'
import type { HikingWeather, NativeWeatherGrid, WeatherSnapshot } from '../src/weather/schema.ts'
import { gridColor } from '../src/weather/grid.ts'

type NativeManifest = Pick<NativeWeatherGrid, 'rows' | 'modelRuns'> & { pointCount: number }
const recordBytes = NATIVE_METRICS.fields.length * Float32Array.BYTES_PER_ELEMENT
const hazards = Object.values(NATIVE_METRICS.hazards)
const allowedHazards = hazards.reduce((mask, hazard) => mask | hazard.mask, 0)

function isNativeManifest(value: unknown, dates: string[], kind: NativeWeatherGrid['kind']): value is NativeManifest {
  if (!isRecord(value) || value.version !== NATIVE_METRICS.version
    || JSON.stringify(value.dates) !== JSON.stringify(dates)
    || JSON.stringify(value.fields) !== JSON.stringify(NATIVE_METRICS.fields)
    || !Array.isArray(value.rows) || value.rows.length === 0
    || !Array.isArray(value.modelRuns) || value.modelRuns.length !== dates.length
    || typeof value.pointCount !== 'number' || !Number.isInteger(value.pointCount)
    || value.pointCount < 1 || value.pointCount > 200000) return false

  let points = 0
  for (const row of value.rows) {
    if (!isRecord(row)) return false
    const { latitude, west, step, count } = row
    if (typeof latitude !== 'number' || !Number.isFinite(latitude)
      || typeof west !== 'number' || !Number.isFinite(west)
      || typeof step !== 'number' || !Number.isFinite(step) || step <= 0
      || typeof count !== 'number' || !Number.isInteger(count) || count < 2) return false
    points += count
  }
  return points === value.pointCount && value.modelRuns.every((run) =>
    (kind === 'native-msm' && run === null) || (typeof run === 'string' && Number.isFinite(Date.parse(run))))
}

function readHikingWeather(data: DataView, offset: number): HikingWeather | null {
  // Python writes little-endian float32 records in the shared field order.
  const metrics = Object.fromEntries(NATIVE_METRICS.fields.map((field, index) =>
    [field, data.getFloat32(offset + index * Float32Array.BYTES_PER_ELEMENT, true)]))
  if (metrics.hours === 0) return null
  const { hazards: mask, ...values } = metrics
  const codes = hazards.filter((hazard) => (mask & hazard.mask) !== 0).map((hazard) => hazard.weatherCode)
  const weather = { ...values, codes: codes.length > 0 ? codes : [0] }
  if (!Object.values(metrics).every(Number.isFinite)
    || !Number.isInteger(mask) || mask < 0 || mask > allowedHazards || (mask & ~allowedHazards) !== 0
    || !isHikingWeather(weather)) throw new Error('Invalid native hiking window')
  return weather
}

export function scoreNativeMetrics(data: Uint8Array): Uint8Array {
  if (data.byteLength % recordBytes !== 0) throw new Error('Invalid native weather metrics')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return Uint8Array.from({ length: data.byteLength / recordBytes }, (_, point) =>
    assessHikingWeather(readHikingWeather(view, point * recordBytes)).score ?? 255)
}

export function nativeGridFromMetrics(input: unknown, data: Uint8Array, dates: string[], kind: NativeWeatherGrid['kind'] = 'native-ifs'): NativeWeatherGrid {
  if (!isNativeManifest(input, dates, kind) || data.byteLength !== dates.length * input.pointCount * recordBytes) throw new Error('Invalid native weather metrics')
  const scores = dates.map((_, day) => {
    if (input.modelRuns[day] === null) return null
    const offset = day * input.pointCount * recordBytes
    return Buffer.from(scoreNativeMetrics(data.subarray(offset, offset + input.pointCount * recordBytes))).toString('base64')
  })
  return { kind, resolutionKm: kind === 'native-msm' ? 5 : 9, modelRuns: input.modelRuns, ...NATIVE_GRID_BOUNDS, rows: input.rows, scores }
}

export async function readNativeWeatherSnapshot(directory: string, dates: string[], startedAt: string): Promise<WeatherSnapshot> {
  const manifest: unknown = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  if (!isRecord(manifest)) throw new Error('Invalid native weather manifest')
  return parseWeatherSnapshot({
    version: 1, model: WEATHER_MODEL, resolutionKm: 9, timezone: WEATHER_TIMEZONE,
    startedAt, fetchedAt: new Date().toISOString(), dates,
    forecasts: JSON.parse(await readFile(join(directory, 'forecasts.json'), 'utf8')),
    grid: nativeGridFromMetrics(manifest, await readFile(join(directory, 'metrics.bin')), dates),
    msmGrid: nativeGridFromMetrics(manifest.msm, await readFile(join(directory, 'msm-metrics.bin')), dates, 'native-msm'),
    ...(manifest.surface === undefined ? {} : { surface: manifest.surface }),
  })
}

export async function fetchWeatherSnapshot(publicDirectory: string, now = new Date()): Promise<WeatherSnapshot> {
  const dates = Array.from({ length: FORECAST_DAYS }, (_, index) => addDays(dateInJapan(now), index))
  const directory = await mkdtemp(join(tmpdir(), 'hiking-weather-'))
  try {
    const palette = Array.from({ length: 256 }, (_, score) => score <= 100 ? [...gridColor(score), 255] : [0, 0, 0, 0])
    await writeFile(join(directory, 'palette.json'), JSON.stringify(palette))
    const script = fileURLToPath(new URL('update-weather-native.py', import.meta.url))
    const args = ['run', '--python', '3.13', script, '--start', dates[0], '--output', directory]
    if (process.env.ECMWF_SEED_CACHE) args.push('--seed-cache', process.env.ECMWF_SEED_CACHE)
    await new Promise<void>((resolve, reject) => {
      const child = spawn('uv', args, { stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Native weather import exited with ${code}`)))
    })
    const snapshot = await readNativeWeatherSnapshot(directory, dates, now.toISOString())
    if (!snapshot.surface) throw new Error('Terrain weather tiles are missing')
    await mkdir(join(publicDirectory, 'surfaces'), { recursive: true })
    await rename(join(directory, 'surface'), join(publicDirectory, snapshot.surface.path))
    return snapshot
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
