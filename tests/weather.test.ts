import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { writeWeatherSnapshot } from '../scripts/update-weather.ts'
import { addDays, dateInJapan, parseWeatherSnapshot } from '../src/weather/schema.ts'
import type { WeatherSnapshot } from '../src/weather/schema.ts'
import { defaultForecastDate, formatWeatherValue, isForecastStale, weatherCondition } from '../src/weather/presentation.ts'

const now = new Date('2026-11-19T15:05:00Z')
const dates = Array.from({ length: 7 }, (_, index) => addDays('2026-11-20', index))

function snapshot(): WeatherSnapshot {
  return {
    version: 1, model: 'ecmwf_ifs', resolutionKm: 9, timezone: 'Asia/Tokyo',
    startedAt: now.toISOString(), fetchedAt: now.toISOString(), dates: [...dates],
    forecasts: { '396': dates.map(() => ({
      model: 'ecmwf_ifs', code: 0, temperatureMin: -10, temperatureMax: -4,
      precipitation: 0, snowfall: 0, windMax: 20, gustMax: 40,
      hiking: { hours: 8, temperatureMin: -8, feelsLikeMin: -12, feelsLikeMax: -8,
        precipitation: 0, precipitationMax: 0, snowfall: 0, windMax: 20, gustMax: 40, visibilityMin: 10000, codes: [0] },
    })) },
  }
}

test('Japan dates cross midnight independently of the runner timezone', () => {
  assert.equal(dateInJapan(new Date('2026-11-19T14:59:59Z')), '2026-11-19')
  assert.equal(dateInJapan(now), '2026-11-20')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
})

test('local forecast validation preserves missing inputs and rejects invalid source metadata', () => {
  const data = snapshot()
  data.forecasts['396'][0].temperatureMax = null
  data.forecasts['396'][0].hiking!.visibilityMin = null
  assert.deepEqual(parseWeatherSnapshot(data), data)
  assert.throws(() => parseWeatherSnapshot({ ...data, model: 'best_match' }), /Unsupported/)
  assert.throws(() => parseWeatherSnapshot({ ...data, dates: [...dates].reverse() }), /consecutive/)
  data.forecasts['396'][0].hiking!.windMax = -1
  assert.throws(() => parseWeatherSnapshot(data), /Invalid forecast/)
  data.forecasts['396'][0].hiking = null
  data.forecasts['396'][0].model = 'jma_msm'
  data.forecasts['396'][0].dailySupplemented = true
  assert.doesNotThrow(() => parseWeatherSnapshot(data))
  assert.throws(() => parseWeatherSnapshot({ ...data, forecasts: { '396': data.forecasts['396'].map(day => ({ ...day, dailySupplemented: 'yes' })) } }), /Invalid forecast/)
})

test('invalid updates leave the last valid forecast file intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hiking-weather-test-'))
  const path = join(directory, 'forecast.json')
  try {
    const data = snapshot()
    await writeWeatherSnapshot(path, data)
    const original = await readFile(path, 'utf8')
    assert.deepEqual(parseWeatherSnapshot(JSON.parse(original)), data)
    const invalid = structuredClone(data)
    invalid.forecasts['396'][0].temperatureMin = 100
    await assert.rejects(writeWeatherSnapshot(path, invalid), /Invalid forecast/)
    assert.equal(await readFile(path, 'utf8'), original)
    assert.deepEqual(await readdir(directory), ['forecast.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('missing values stay missing, while zero and freezing temperatures remain visible', () => {
  assert.equal(formatWeatherValue(null, '°C'), '–')
  assert.equal(formatWeatherValue(0, 'mm'), '0 mm')
  assert.equal(formatWeatherValue(-10.5, '°C'), '-10,5 °C')
  assert.equal(weatherCondition(0).label, 'Klar / heiter')
  assert.equal(weatherCondition(null).label, 'Keine Daten')
  assert.equal(weatherCondition(97).label, 'Gewitter')
  assert.equal(weatherCondition(85).label, 'Schnee')
})

test('day selection rolls forward and stale datasets are labeled', () => {
  const data = snapshot()
  assert.equal(defaultForecastDate(dates, now), '2026-11-20')
  assert.equal(defaultForecastDate(dates, new Date('2026-11-21T00:00:00Z')), '2026-11-21')
  assert.equal(defaultForecastDate(dates, new Date('2026-12-01T00:00:00Z')), '2026-11-26')
  assert.equal(isForecastStale(data, new Date('2026-11-19T16:00:00Z')), false)
  assert.equal(isForecastStale(data, new Date('2026-11-21T00:00:00Z')), true)
})
