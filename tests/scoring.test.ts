import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HikingWeather } from '../src/weather/schema.ts'
import { assessHikingWeather, geometricHikingScore } from '../src/weather/scoring.ts'
import { formatHikingFactor, hikingCondition } from '../src/weather/presentation.ts'

const ideal: HikingWeather = {
  hours: 8,
  temperatureMin: 15,
  feelsLikeMin: 15,
  feelsLikeMax: 18,
  precipitation: 0,
  precipitationMax: 0,
  snowfall: 0,
  windMax: 5,
  gustMax: 10,
  visibilityMin: 20000,
  codes: [0],
}

test('the weighted geometric mean matches the agreed examples, including true zero', () => {
  for (const [rain, expected] of [[100, 100], [20, 57], [5, 35], [0, 0]]) {
    assert.equal(geometricHikingScore({ wind: 100, rain, temperature: 100, visibility: 100 }), expected)
  }
  assert.equal(geometricHikingScore({ wind: 0, rain: null, temperature: 100, visibility: 100 }), null)
  assert.equal(geometricHikingScore({ wind: NaN, rain: 100, temperature: 100, visibility: 100 }), null)
  assert.equal(geometricHikingScore({ wind: 101, rain: 100, temperature: 100, visibility: 100 }), null)
})

test('ideal weather is 100, while extreme rain or gusts cannot be offset by comfort', () => {
  assert.equal(assessHikingWeather(ideal).score, 100)
  const deluge = assessHikingWeather({ ...ideal, precipitation: 10, precipitationMax: 10 })
  assert.equal(deluge.factors.rain, 0)
  assert.equal(deluge.factors.temperature, 100)
  assert.equal(deluge.factors.wind, 100)
  assert.equal(deluge.score, 0)
  assert.equal(assessHikingWeather({ ...ideal, precipitation: 25, precipitationMax: 4 }).score, 0)
  assert.equal(assessHikingWeather({ ...ideal, gustMax: 80 }).score, 0)
})

test('stronger rain, wind and reduced visibility cannot improve the rating', () => {
  let previous = 100
  for (const precipitation of [0, 0.2, 0.5, 1, 2, 5, 10]) {
    const score = assessHikingWeather({ ...ideal, precipitation, precipitationMax: precipitation }).score!
    assert.ok(score <= previous)
    previous = score
  }
  previous = 100
  for (const windMax of [5, 10, 20, 30, 40, 50]) {
    const score = assessHikingWeather({ ...ideal, windMax }).score!
    assert.ok(score <= previous)
    previous = score
  }
  previous = 100
  for (const visibilityMin of [20000, 10000, 5000, 1000, 200, 50]) {
    const score = assessHikingWeather({ ...ideal, visibilityMin }).score!
    assert.ok(score <= previous)
    previous = score
  }
})

test('cold, heat and wet cold are evaluated within the hiking profile', () => {
  assert.equal(assessHikingWeather({ ...ideal, feelsLikeMin: -20 }).score, 0)
  assert.equal(assessHikingWeather({ ...ideal, feelsLikeMax: 35 }).score, 0)
  const dry = assessHikingWeather({ ...ideal, temperatureMin: 4, feelsLikeMin: 4 })
  const wet = assessHikingWeather({ ...ideal, temperatureMin: 4, feelsLikeMin: 4, precipitation: 1, precipitationMax: 0.5 })
  assert.ok(wet.factors.temperature! < dry.factors.temperature!)
  assert.ok(wet.warnings.includes('wetCold'))
})

test('thunderstorms, freezing rain and fresh snow exclude ordinary hiking', () => {
  for (const code of [56, 57, 66, 67, 71, 73, 75, 77, 85, 86, 95, 96, 97, 99]) {
    const result = assessHikingWeather({ ...ideal, codes: [0, code] })
    assert.equal(result.score, 0, `weather code ${code}`)
    assert.ok(result.warnings.length > 0)
  }
  assert.equal(assessHikingWeather({ ...ideal, snowfall: 0.1 }).score, 0)
})

test('missing required inputs never become a partial high score', () => {
  assert.equal(assessHikingWeather(undefined).score, null)
  for (const field of ['temperatureMin', 'feelsLikeMin', 'feelsLikeMax', 'precipitation', 'precipitationMax', 'snowfall', 'windMax', 'gustMax', 'visibilityMin', 'codes'] as const) {
    assert.equal(assessHikingWeather({ ...ideal, [field]: null }).score, null, field)
  }
  assert.equal(hikingCondition(null).label, 'Nicht bewertbar')
  assert.equal(hikingCondition(0).label, 'Sehr ungünstig')
  assert.equal(hikingCondition(100).label, 'Sehr günstig')
  assert.equal(formatHikingFactor(0), '0')
  assert.equal(formatHikingFactor(0.25), '0,3')
  assert.equal(formatHikingFactor(0.001), '< 0,1')
  assert.equal(formatHikingFactor(null), '–')
})
