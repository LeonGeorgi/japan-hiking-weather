import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildForecastUrl, fetchWeatherSnapshot, parseLocationForecast, writeWeatherSnapshot } from '../scripts/update-weather.ts'
import type { SummitLocation } from '../scripts/update-weather.ts'
import { addDays, dateInJapan, parseWeatherSnapshot } from '../src/weather/schema.ts'
import { defaultForecastDate, formatWeatherValue, isForecastStale, weatherCondition } from '../src/weather/presentation.ts'

const now = new Date('2026-11-19T15:05:00Z')
const dates = Array.from({ length: 7 }, (_, index) => addDays('2026-11-20', index))
const summits: SummitLocation[] = [
  { id: 396, latitude: 35.360738, longitude: 138.727373, elevation: 3776 },
  { id: 2, latitude: 44.133258, longitude: 145.16129, elevation: 1562 },
  { id: 3, latitude: 44.124615, longitude: 145.168839, elevation: 1544 },
]

function apiForecast(elevation: number) {
  return {
    timezone: 'Asia/Tokyo',
    utc_offset_seconds: 32400,
    elevation,
    daily_units: {
      weather_code: 'wmo code',
      temperature_2m_min: '°C',
      temperature_2m_max: '°C',
      precipitation_sum: 'mm',
      snowfall_sum: 'cm',
      wind_speed_10m_max: 'km/h',
      wind_gusts_10m_max: 'km/h',
    },
    daily: {
      time: [...dates],
      weather_code: [0, 3, 45, 61, 71, 95, 97],
      temperature_2m_min: Array(7).fill(-10),
      temperature_2m_max: [-4, -3, -2, -1, 0, 1, 2],
      precipitation_sum: [0, 0, 0, 2, 5, 10, 15],
      snowfall_sum: [0, 0, 0, 0, 3, 0, 0],
      wind_speed_10m_max: Array(7).fill(20),
      wind_gusts_10m_max: Array(7).fill(40),
    },
  }
}

const fetchFixture: typeof fetch = async (input) => {
  const url = new URL(String(input))
  const elevations = url.searchParams.get('elevation')!.split(',').map(Number)
  const responses = elevations.map(apiForecast)
  return Response.json(responses.length === 1 ? responses[0] : responses)
}

test('Japan dates cross midnight independently of the runner timezone', () => {
  assert.equal(dateInJapan(new Date('2026-11-19T14:59:59Z')), '2026-11-19')
  assert.equal(dateInJapan(now), '2026-11-20')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('requests pin IFS HRES, summit elevations, units and the Japanese calendar', () => {
  const url = buildForecastUrl(summits.slice(0, 2), dates)
  assert.equal(url.origin, 'https://api.open-meteo.com')
  assert.equal(url.pathname, '/v1/ecmwf')
  assert.equal(url.searchParams.get('models'), 'ecmwf_ifs')
  assert.equal(url.searchParams.get('elevation'), '3776,1562')
  assert.equal(url.searchParams.get('timezone'), 'Asia/Tokyo')
  assert.equal(url.searchParams.get('start_date'), '2026-11-20')
  assert.equal(url.searchParams.get('end_date'), '2026-11-26')
  assert.equal(url.searchParams.get('wind_speed_unit'), 'kmh')
  assert.equal(url.searchParams.has('apikey'), false)
})

test('batches preserve summit IDs and pace multi-location API calls', async () => {
  const waits: number[] = []
  const snapshot = await fetchWeatherSnapshot(summits, {
    fetchFn: fetchFixture,
    sleep: async (milliseconds) => { waits.push(milliseconds) },
    now,
    batchSize: 2,
  })
  assert.deepEqual(waits, [7500])
  assert.deepEqual(snapshot.dates, dates)
  assert.deepEqual(Object.keys(snapshot.forecasts).sort(), ['2', '3', '396'])
  assert.equal(snapshot.forecasts['396'][0].temperatureMax, -4)
  assert.equal(snapshot.forecasts['396'][4].precipitation, 5)
  assert.equal(snapshot.forecasts['396'][0].precipitation, 0)
})

test('incomplete batches, wrong days and wrong units are rejected', async () => {
  await assert.rejects(fetchWeatherSnapshot(summits.slice(0, 2), {
    now,
    fetchFn: async () => Response.json([apiForecast(3776)]),
  }), /Incomplete forecast batch/)
  const wrongDate = apiForecast(3776)
  wrongDate.daily.time[0] = '2026-11-19'
  assert.throws(() => parseLocationForecast(wrongDate, summits[0], dates), /date mismatch/)
  const wrongUnit = apiForecast(3776)
  wrongUnit.daily_units.wind_speed_10m_max = 'm/s'
  assert.throws(() => parseLocationForecast(wrongUnit, summits[0], dates), /units/)
})

test('rate limits honor Retry-After; invalid requests are not retried', async () => {
  let attempts = 0
  const waits: number[] = []
  await fetchWeatherSnapshot(summits.slice(0, 1), {
    now,
    sleep: async (milliseconds) => { waits.push(milliseconds) },
    fetchFn: async () => {
      attempts++
      return attempts === 1
        ? new Response('Rate limited', { status: 429, headers: { 'Retry-After': '60' } })
        : Response.json(apiForecast(3776))
    },
  })
  assert.equal(attempts, 2)
  assert.deepEqual(waits, [60_000])
  attempts = 0
  await assert.rejects(fetchWeatherSnapshot(summits.slice(0, 1), {
    now,
    fetchFn: async () => { attempts++; return new Response('Invalid variable', { status: 400 }) },
  }), /HTTP 400/)
  assert.equal(attempts, 1)
})

test('invalid updates leave the last valid forecast file intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hiking-weather-test-'))
  const path = join(directory, 'forecast.json')
  try {
    const snapshot = await fetchWeatherSnapshot(summits.slice(0, 1), { now, fetchFn: fetchFixture })
    await writeWeatherSnapshot(path, snapshot)
    const original = await readFile(path, 'utf8')
    assert.deepEqual(parseWeatherSnapshot(JSON.parse(original)), snapshot)
    const invalid = structuredClone(snapshot)
    invalid.forecasts['396'][0].temperatureMin = 100
    await assert.rejects(writeWeatherSnapshot(path, invalid), /Invalid forecast/)
    assert.equal(await readFile(path, 'utf8'), original)
    assert.deepEqual(await readdir(directory), ['forecast.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('missing values stay missing, while zero and freezing temperatures remain visible', async () => {
  const snapshot = await fetchWeatherSnapshot(summits.slice(0, 1), { now, fetchFn: fetchFixture })
  snapshot.forecasts['396'][0].temperatureMax = null
  assert.equal(parseWeatherSnapshot(snapshot).forecasts['396'][0].temperatureMax, null)
  assert.equal(formatWeatherValue(null, '°C'), '–')
  assert.equal(formatWeatherValue(0, 'mm'), '0 mm')
  assert.equal(formatWeatherValue(-10.5, '°C'), '-10,5 °C')
  assert.equal(weatherCondition(0).label, 'Klar / heiter')
  assert.equal(weatherCondition(null).label, 'Keine Daten')
  assert.equal(weatherCondition(97).label, 'Gewitter')
  assert.equal(weatherCondition(85).label, 'Schnee')
})

test('day selection rolls forward and stale datasets are labeled', async () => {
  const snapshot = await fetchWeatherSnapshot(summits.slice(0, 1), { now, fetchFn: fetchFixture })
  snapshot.fetchedAt = now.toISOString()
  assert.equal(defaultForecastDate(dates, now), '2026-11-20')
  assert.equal(defaultForecastDate(dates, new Date('2026-11-21T00:00:00Z')), '2026-11-21')
  assert.equal(defaultForecastDate(dates, new Date('2026-12-01T00:00:00Z')), '2026-11-26')
  assert.equal(isForecastStale(snapshot, new Date('2026-11-19T16:00:00Z')), false)
  assert.equal(isForecastStale(snapshot, new Date('2026-11-21T00:00:00Z')), true)
  assert.throws(() => parseWeatherSnapshot({ ...snapshot, model: 'best_match' }), /Unsupported/)
  assert.throws(() => parseWeatherSnapshot({ ...snapshot, dates: [...dates].reverse() }), /consecutive/)
})
