import { useEffect, useState } from 'react'
import type { MultiPolygon } from 'geojson'
import japanLandUrl from '../data/japan-land.json?url'

export function useJapanLand() {
  const [land, setLand] = useState<MultiPolygon | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function loadLand() {
      try {
        const response = await fetch(japanLandUrl, { signal: controller.signal })
        if (!response.ok) throw new Error(`Land mask HTTP ${response.status}`)
        const geometry: MultiPolygon = await response.json()
        if (geometry.type !== 'MultiPolygon' || geometry.coordinates.length === 0) throw new Error('Invalid land mask')
        setLand(geometry)
      } catch {
        if (!controller.signal.aborted) setLoadError(true)
      }
    }
    void loadLand()
    return () => controller.abort()
  }, [])

  return { land, loadError }
}
