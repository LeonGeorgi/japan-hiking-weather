import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { parseWeatherSnapshot } from '../src/weather/schema.ts'
import type { WeatherSnapshot } from '../src/weather/schema.ts'
import { fetchWeatherSnapshot } from './weather-native.ts'

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
  console.log('Loading native JMA MSM / ECMWF IFS data and calculating summit forecasts locally.')
  const directory = new URL('../public/weather/', import.meta.url)
  const target = fileURLToPath(new URL('forecast.json', directory))
  await mkdir(directory, { recursive: true })
  const snapshot = await fetchWeatherSnapshot(fileURLToPath(directory))
  await writeWeatherSnapshot(target, snapshot)
  console.log(`Wrote ${target}: ${Object.keys(snapshot.forecasts).length} summits, ${snapshot.dates[0]} to ${snapshot.dates.at(-1)}. No point-API requests.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
