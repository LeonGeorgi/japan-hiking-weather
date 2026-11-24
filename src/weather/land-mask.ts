import type { MultiPolygon } from 'geojson'

interface SurfaceBounds {
  south: number
  west: number
  north: number
  east: number
}

export function mercator(latitude: number): number {
  return Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360))
}

export function surfaceProjection(bounds: SurfaceBounds, width = 1024) {
  const top = mercator(bounds.north)
  const bottom = mercator(bounds.south)
  const height = Math.round(width * (top - bottom) / ((bounds.east - bounds.west) * Math.PI / 180))
  return {
    width,
    height,
    point: (longitude: number, latitude: number) => [
      (longitude - bounds.west) / (bounds.east - bounds.west) * width,
      (top - mercator(latitude)) / (top - bottom) * height,
    ],
    latitudeAt: (y: number) => (2 * Math.atan(Math.exp(top - (top - bottom) * y / height)) - Math.PI / 2) * 180 / Math.PI,
  }
}

export type SurfaceProjection = ReturnType<typeof surfaceProjection>

export function landMaskPath(land: MultiPolygon, projection: SurfaceProjection): string {
  // A separate closed subpath for every island and interior ring. SVG's evenodd
  // clipping keeps holes transparent, regardless of ring winding direction.
  return land.coordinates.flatMap((polygon) => polygon.map((ring) => ring.map(([longitude, latitude], index) => {
    const [x, y] = projection.point(longitude, latitude)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(5)},${y.toFixed(5)}`
  }).join('') + 'Z')).join('')
}
