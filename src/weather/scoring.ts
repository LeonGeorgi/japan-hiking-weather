import type { HikingWeather } from './schema.ts'

export const hikingFactors = [
  { key: 'wind', label: 'Wind und Böen', weight: 0.35 },
  { key: 'rain', label: 'Niederschlag', weight: 0.35 },
  { key: 'temperature', label: 'Temperatur', weight: 0.2 },
  { key: 'visibility', label: 'Sicht', weight: 0.1 },
] as const

export type HikingFactor = typeof hikingFactors[number]['key']
export type HikingWarning = 'thunderstorm' | 'freezingRain' | 'snow' | 'wetCold'
export interface HikingAssessment {
  score: number | null
  factors: Record<HikingFactor, number | null>
  warnings: HikingWarning[]
}

type Curve = readonly (readonly [value: number, score: number])[]

// Product heuristics for ordinary hiking without winter equipment. See README.
const curves = {
  wind: [[10, 100], [20, 80], [30, 50], [40, 20], [50, 0]],
  gust: [[20, 100], [35, 80], [50, 50], [65, 20], [80, 0]],
  rainTotal: [[0.2, 100], [1, 85], [3, 65], [8, 40], [15, 10], [25, 0]],
  rainPeak: [[0.1, 100], [0.5, 85], [1, 65], [2, 40], [5, 10], [10, 0]],
  temperature: [[-20, 0], [-10, 25], [0, 65], [10, 100], [20, 100], [25, 80], [30, 40], [35, 0]],
  visibility: [[50, 0], [200, 10], [1000, 50], [5000, 85], [10000, 100]],
} satisfies Record<string, Curve>

function interpolate(value: number | null, curve: Curve): number | null {
  if (value === null) return null
  if (value <= curve[0][0]) return curve[0][1]
  for (let index = 1; index < curve.length; index++) {
    const [x, y] = curve[index]
    const [previousX, previousY] = curve[index - 1]
    if (value <= x) return previousY + (y - previousY) * (value - previousX) / (x - previousX)
  }
  return curve.at(-1)![1]
}

function minimum(...scores: (number | null)[]): number | null {
  return scores.some((score) => score === null) ? null : Math.min(...scores as number[])
}

export function geometricHikingScore(factors: HikingAssessment['factors']): number | null {
  if (hikingFactors.some(({ key }) => factors[key] === null || !Number.isFinite(factors[key]) || factors[key]! < 0 || factors[key]! > 100)) return null
  if (hikingFactors.some(({ key }) => factors[key] === 0)) return 0
  const score = hikingFactors.reduce((product, { key, weight }) => product * (factors[key]! / 100) ** weight, 1) * 100
  // Reserve zero for an actual exclusion; round positive values to at least one.
  return Math.max(1, Math.round(score))
}

export function assessHikingWeather(weather: HikingWeather | null | undefined): HikingAssessment {
  if (!weather) return { score: null, factors: { wind: null, rain: null, temperature: null, visibility: null }, warnings: [] }

  const warnings: HikingWarning[] = []
  if (weather.codes?.some((code) => [95, 96, 97, 99].includes(code))) warnings.push('thunderstorm')
  if (weather.codes?.some((code) => [56, 57, 66, 67].includes(code))) warnings.push('freezingRain')
  if ((weather.snowfall !== null && weather.snowfall >= 0.1) || weather.codes?.some((code) => [71, 73, 75, 77, 85, 86].includes(code))) warnings.push('snow')
  const wetCold = weather.temperatureMin !== null && weather.temperatureMin <= 5 && weather.precipitation !== null && weather.precipitation > 0.2
  if (wetCold) warnings.push('wetCold')

  let rain = minimum(interpolate(weather.precipitation, curves.rainTotal), interpolate(weather.precipitationMax, curves.rainPeak))
  if (weather.snowfall === null || weather.codes === null) rain = null
  else if (rain !== null && warnings.some((warning) => warning !== 'wetCold')) rain = 0

  let temperature = minimum(interpolate(weather.feelsLikeMin, curves.temperature), interpolate(weather.feelsLikeMax, curves.temperature))
  if (weather.temperatureMin === null || weather.precipitation === null) temperature = null
  else if (temperature !== null && wetCold) temperature *= 0.7

  const factors = {
    wind: minimum(interpolate(weather.windMax, curves.wind), interpolate(weather.gustMax, curves.gust)),
    rain,
    temperature,
    visibility: interpolate(weather.visibilityMin, curves.visibility),
  }
  return { score: geometricHikingScore(factors), factors, warnings }
}
