import type { NativeWeatherGrid } from './schema.ts'
import { gridColor, gridScores, gridSampler } from './grid.ts'
import type { SurfaceProjection } from './land-mask.ts'

export function renderWeatherSurface(grid: NativeWeatherGrid, dayIndex: number, projection: SurfaceProjection): string | null {
  const scores = gridScores(grid, dayIndex)
  if (!scores) return null
  const { north, east } = grid
  const sample = gridSampler(grid, scores)
  const fade = 0.15
  const canvas = document.createElement('canvas')
  canvas.width = projection.width
  canvas.height = projection.height
  const context = canvas.getContext('2d')
  if (!context) return null
  const pixels = context.createImageData(canvas.width, canvas.height)

  for (let y = 0; y < canvas.height; y++) {
    const latitude = projection.latitudeAt(y + 0.5)
    for (let x = 0; x < canvas.width; x++) {
      const longitude = grid.west + (east - grid.west) * (x + 0.5) / canvas.width
      const score = sample(latitude, longitude)
      if (score === null) continue
      const pixel = (y * canvas.width + x) * 4
      const color = gridColor(score)
      pixels.data[pixel] = color[0]
      pixels.data[pixel + 1] = color[1]
      pixels.data[pixel + 2] = color[2]
      const edgeDistance = Math.min(latitude - grid.south, north - latitude, longitude - grid.west, east - longitude)
      pixels.data[pixel + 3] = Math.round(255 * Math.min(1, Math.max(0, edgeDistance / fade)))
    }
  }
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL('image/png')
}
