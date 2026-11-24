import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { gridColor, gridSampler, gridScores, weatherSurfaceGrid } from '../src/weather/grid.ts'
import { parseWeatherSnapshot } from '../src/weather/schema.ts'
import type { NativeWeatherGrid } from '../src/weather/schema.ts'
import { nativeGridFromMetrics, readNativeWeatherSnapshot } from '../scripts/weather-native.ts'
import { NATIVE_METRICS } from '../src/weather/config.ts'

const grid: NativeWeatherGrid = {
  kind: 'native-ifs', resolutionKm: 9,
  modelRuns: ['2026-11-21T12:00:00Z'], south: 24, north: 25, west: 122, east: 123,
  rows: [{ latitude: 25, west: 122, step: 1, count: 2 }, { latitude: 24, west: 122, step: 0.5, count: 3 }],
  scores: [Buffer.from([0, 100, 10, 50, 90]).toString('base64')],
}

function snapshot(nativeGrid: unknown) {
  return {
    version: 1, model: 'ecmwf_ifs', resolutionKm: 9, timezone: 'Asia/Tokyo',
    startedAt: '2026-11-22T01:00:00Z', fetchedAt: '2026-11-22T01:00:00Z', dates: ['2026-11-22'], grid: nativeGrid,
    forecasts: { '1': [{ code: 0, temperatureMin: 0, temperatureMax: 10, precipitation: 0, snowfall: 0, windMax: 0, gustMax: 0 }] },
  }
}

test('native cells are sampled without blending, respecting row order and varying widths', () => {
  const sample = gridSampler(grid, gridScores(grid, 0)!)
  assert.equal(sample(25, 122), 0)
  assert.equal(sample(24, 123), 90)
  assert.equal(sample(24.75, 122.2), 0)
  assert.equal(sample(24.75, 122.8), 100)
  assert.equal(sample(24.25, 122.5), 50)
  assert.equal(sample(24.25, 122), 10)
  assert.equal(sample(24.5, 122), 0)
  assert.equal(sample(23.9, 122.5), null)
  assert.equal(sample(24.5, 123.1), null)
})

test('unknown native cells do not become zeros or get filled by adjacent cells', () => {
  const modified = { ...grid, scores: [Buffer.from([0, 255, 10, 50, 90]).toString('base64')] }
  const scores = gridScores(modified, 0)!
  assert.deepEqual(scores, [0, null, 10, 50, 90])
  const sample = gridSampler(modified, scores)
  assert.equal(sample(25, 122), 0)
  assert.equal(sample(25, 122.5), null)
  assert.equal(sample(24.9, 122.2), 0)
  assert.equal(sample(24.9, 122.8), null)
  assert.equal(gridScores(modified, -1), null)
})

test('surface colors preserve the hiking legend thresholds', () => {
  assert.deepEqual(gridColor(0), [190, 18, 60])
  assert.deepEqual(gridColor(19), [190, 18, 60])
  assert.deepEqual(gridColor(20), [234, 88, 12])
  assert.deepEqual(gridColor(56), [202, 138, 4])
  assert.deepEqual(gridColor(60), [101, 163, 13])
  assert.deepEqual(gridColor(80), [21, 128, 61])
})

test('terrain image metadata rejects unsafe paths and invalid tile coordinates', () => {
  const surface = { source: 'gsi-dem', resolutionMetres: 250, minZoom: 5, zoom: 9,
    path: `surfaces/${'a'.repeat(32)}`, tiles: ['9/456/188', '5/28/11'] }
  assert.doesNotThrow(() => parseWeatherSnapshot({ ...snapshot(grid), surface }))
  for (const malformed of [
    { ...surface, path: '../outside' }, { ...surface, zoom: 10 },
    { ...surface, tiles: ['9/512/188'] }, { ...surface, tiles: ['4/12/8'] },
    { ...surface, tiles: [] }, { ...surface, tiles: ['9/456/188', '9/456/188'] },
  ]) assert.throws(() => parseWeatherSnapshot({ ...snapshot(grid), surface: malformed }), /Invalid terrain/)
})

test('terrain scoring pipe uses the shared rating across multiple binary frames', () => {
  function frame(records: number[][]) {
    const values = Float32Array.from(records.flat())
    const header = Buffer.alloc(4)
    header.writeUInt32LE(values.byteLength)
    return Buffer.concat([header, Buffer.from(values.buffer)])
  }
  const good = [8, 15, 15, 15, 0, 0, 0, 10, 20, 10000, 0]
  const snow = [...good]; snow[10] = 2
  const missing = [0, ...Array(10).fill(NaN)]
  const result = spawnSync(process.execPath, ['scripts/score-weather.ts'], {
    input: Buffer.concat([frame([good, snow]), frame([missing])]),
  })
  assert.equal(result.status, 0, result.stderr.toString())
  assert.deepEqual([...result.stdout], [100, 0, 255])
})

test('native dataset validation rejects corrupt data and the removed regular grid format', () => {
  assert.doesNotThrow(() => parseWeatherSnapshot(snapshot(grid)))
  for (const broken of [
    { ...grid, scores: [Buffer.from([0, 101, 10, 50, 90]).toString('base64')] },
    { ...grid, scores: ['AAAA'] },
    { ...grid, scores: [] },
    { ...grid, rows: [...grid.rows].reverse() },
    { ...grid, modelRuns: [] },
    { ...grid, kind: 'unsupported' },
    { south: 24, west: 122, step: 1, rows: 2, columns: 2, forecasts: [[null, null, null, null]] },
  ]) assert.throws(() => parseWeatherSnapshot(snapshot(broken)), /Invalid weather grid/)
})

test('native import uses the shared geometric rating and preserves exclusions and missing data', () => {
  // Existing version-1 binary layout: preserve compatibility while refactoring.
  const fields = ['hours', 'temperatureMin', 'feelsLikeMin', 'feelsLikeMax', 'precipitation', 'precipitationMax', 'snowfall', 'windMax', 'gustMax', 'visibilityMin', 'hazards']
  const manifest = { version: 1, dates: ['2026-11-22'], fields, modelRuns: grid.modelRuns, rows: grid.rows, pointCount: 5 }
  const good = [8, 15, 15, 15, 0, 0, 0, 10, 20, 10000, 0]
  const rain = [...good]; rain[4] = 25
  const missing = [0, ...Array(10).fill(NaN)]
  const thunder = [...good]; thunder[10] = 1
  const wind = [...good]; wind[7] = 50
  const binary = Buffer.alloc(5 * fields.length * 4)
  ;[good, rain, missing, thunder, wind].flat().forEach((value, index) => binary.writeFloatLE(value, index * 4))
  const result = nativeGridFromMetrics(manifest, binary, manifest.dates)
  assert.deepEqual(gridScores(result, 0), [100, 0, null, 0, 0])
  const padded = Buffer.concat([Buffer.alloc(13, 42), binary, Buffer.alloc(5, 42)])
  assert.deepEqual(nativeGridFromMetrics(manifest, padded.subarray(13, 13 + binary.length), manifest.dates), result)
  assert.throws(() => nativeGridFromMetrics(manifest, binary.subarray(0, -1), manifest.dates), /Invalid native weather metrics/)
  assert.throws(() => nativeGridFromMetrics(manifest, binary, ['2026-11-23']), /Invalid native weather metrics/)
  binary.writeFloatLE(-1, 4 * 4)
  assert.throws(() => nativeGridFromMetrics(manifest, binary, manifest.dates), /Invalid native hiking window/)
})

test('native manifest validation checks external metadata before decoding records', () => {
  const manifest = {
    version: 1, dates: ['2026-11-22'], fields: [...NATIVE_METRICS.fields],
    modelRuns: grid.modelRuns, rows: grid.rows, pointCount: 5,
  }
  const binary = Buffer.alloc(manifest.pointCount * manifest.fields.length * 4)
  assert.doesNotThrow(() => nativeGridFromMetrics(manifest, binary, manifest.dates))
  for (const malformed of [
    null,
    { ...manifest, version: 2 },
    { ...manifest, pointCount: '5' },
    { ...manifest, fields: [...manifest.fields].reverse() },
    { ...manifest, rows: [{ ...grid.rows[0], count: 2.5 }, grid.rows[1]] },
    { ...manifest, rows: [{ ...grid.rows[0], latitude: NaN }, grid.rows[1]] },
    { ...manifest, modelRuns: [123] },
    { ...manifest, modelRuns: ['not-a-date'] },
  ]) assert.throws(() => nativeGridFromMetrics(malformed, binary, manifest.dates), /Invalid native weather metrics/)
})

test('MSM uses the same row format at 5 km and falls back to IFS on uncovered days', () => {
  const dates = ['2026-11-22', '2026-11-23']
  const fields = NATIVE_METRICS.fields
  const manifest = { version: 1, dates, fields, modelRuns: [grid.modelRuns[0], null], rows: grid.rows, pointCount: 5 }
  const binary = Buffer.alloc(2 * 5 * fields.length * 4)
  const good = [8, 15, 15, 15, 0, 0, 0, 10, 20, 10000, 0]
  Array(5).fill(good).flat().forEach((value, index) => binary.writeFloatLE(value, index * 4))
  const msmGrid = nativeGridFromMetrics(manifest, binary, dates, 'native-msm')
  assert.equal(msmGrid.resolutionKm, 5)
  assert.deepEqual(gridScores(msmGrid, 0), [100, 100, 100, 100, 100])
  assert.equal(gridScores(msmGrid, 1), null)
  const data = { ...snapshot(grid), dates, msmGrid,
    grid: { ...grid, modelRuns: [...grid.modelRuns, ...grid.modelRuns], scores: [...grid.scores, ...grid.scores] },
    forecasts: { '1': [...snapshot(grid).forecasts['1'], ...snapshot(grid).forecasts['1']] },
  }
  const parsed = parseWeatherSnapshot(data)
  assert.equal(weatherSurfaceGrid(parsed, 0), msmGrid)
  assert.equal(weatherSurfaceGrid(parsed, 1), data.grid)
  assert.throws(() => parseWeatherSnapshot({ ...data, msmGrid: { ...msmGrid, resolutionKm: 9 } }), /Invalid MSM/)
  assert.throws(() => parseWeatherSnapshot({ ...data, msmGrid: { ...msmGrid, modelRuns: [null, null] } }), /Invalid MSM/)
  assert.throws(() => nativeGridFromMetrics(manifest, binary, dates), /Invalid native/)
})

test('native import validates locally calculated summit JSON before publishing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hiking-native-test-'))
  try {
    const dates = ['2026-11-22']
    const manifest = { version: 1, dates, fields: NATIVE_METRICS.fields, modelRuns: grid.modelRuns, rows: grid.rows, pointCount: 5 }
    const missing = Buffer.alloc(5 * NATIVE_METRICS.fields.length * 4)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, msm: { ...manifest, modelRuns: [null] } }))
    await writeFile(join(directory, 'metrics.bin'), missing)
    await writeFile(join(directory, 'msm-metrics.bin'), missing)
    const forecasts = { '1': [{ model: 'jma_msm', dailySupplemented: true, code: 0, temperatureMin: -3, temperatureMax: 4, precipitation: 0, snowfall: 0, windMax: 10, gustMax: 20, hiking: null }] }
    await writeFile(join(directory, 'forecasts.json'), JSON.stringify(forecasts))
    const result = await readNativeWeatherSnapshot(directory, dates, '2026-11-22T01:00:00Z')
    assert.deepEqual(result.forecasts, forecasts)
    assert.deepEqual(gridScores(result.grid!, 0), [null, null, null, null, null])
    assert.equal(weatherSurfaceGrid(result, 0), result.grid)
    forecasts['1'][0].temperatureMin = 100
    await writeFile(join(directory, 'forecasts.json'), JSON.stringify(forecasts))
    await assert.rejects(readNativeWeatherSnapshot(directory, dates, '2026-11-22T01:00:00Z'), /Invalid forecast/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
