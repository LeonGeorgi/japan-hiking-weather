import type { NativeWeatherGrid, WeatherSnapshot } from './schema.ts'
import { hikingCondition } from './presentation.ts'

export function gridScores(grid: NativeWeatherGrid, dayIndex: number): (number | null)[] | null {
  const encoded = grid.scores[dayIndex]
  return encoded == null ? null : Array.from(atob(encoded), (byte) => byte.charCodeAt(0) === 255 ? null : byte.charCodeAt(0))
}

export function weatherSurfaceGrid(snapshot: WeatherSnapshot | null, dayIndex: number): NativeWeatherGrid | undefined {
  return snapshot?.msmGrid?.scores[dayIndex] != null ? snapshot.msmGrid : snapshot?.grid
}

export function gridSampler(grid: NativeWeatherGrid, scores: (number | null)[]) {
  const rows = grid.rows
  let offset = 0
  const offsets = rows.map((row) => { const start = offset; offset += row.count; return start })
  return (latitude: number, longitude: number): number | null => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude > rows[0].latitude || latitude < rows.at(-1)!.latitude) return null
    let top = 0
    let bottom = rows.length - 1
    while (bottom - top > 1) {
      const middle = (top + bottom) >>> 1
      if (rows[middle].latitude >= latitude) top = middle
      else bottom = middle
    }
    const index = rows[top].latitude - latitude <= latitude - rows[bottom].latitude ? top : bottom
    const row = rows[index]
    const column = (longitude - row.west) / row.step
    if (column < -1e-8 || column > row.count - 1 + 1e-8) return null
    return scores[offsets[index] + Math.round(column)] ?? null
  }
}

export function gridColor(score: number): [number, number, number] {
  const color = hikingCondition(score).color
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number]
}
