import { lazy, Suspense, useEffect } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { JAPAN_MAP_BOUNDS, MINIMUM_MAP_ZOOM } from '../map-settings'
import transparentTileUrl from '../assets/transparent-tile.svg'
import styles from './MapView.module.css'
import type { WeatherSnapshot } from '../weather/schema'
import { weatherSurfaceGrid } from '../weather/grid'

const MountainMarkers = lazy(() => import('./MountainMarkers'))
const NationalParkBoundaries = lazy(() => import('./NationalParkBoundaries'))
const WeatherSurface = lazy(() => import('./WeatherSurface'))

const gsiAttribution = '<a href="https://maps.gsi.go.jp/development/ichiran.html">GSI</a>'

function JapanViewportLimits() {
  const map = useMap()

  useEffect(() => {
    function updateLimits() {
      // Reset the previous limit so a smaller viewport can permit zooming out.
      map.setMinZoom(MINIMUM_MAP_ZOOM)
      const minimum = map.getBoundsZoom(JAPAN_MAP_BOUNDS, true)
      if (map.getZoom() < minimum) map.setZoom(minimum, { animate: false })
      map.setMinZoom(minimum)
      map.panInsideBounds(JAPAN_MAP_BOUNDS, { animate: false })
    }
    updateLimits()
    map.on('resize', updateLimits)
    return () => { map.off('resize', updateLimits) }
  }, [map])

  return null
}

interface MapViewProps {
  weather: WeatherSnapshot | null
  selectedDate: string
  surfaceOpacity: number
}

export default function MapView({ weather, selectedDate, surfaceOpacity }: MapViewProps) {
  const dayIndex = weather?.dates.indexOf(selectedDate) ?? -1
  return (
    <MapContainer
      className={styles.map}
      center={[36.2048, 138.2529]}
      zoom={5}
      minZoom={MINIMUM_MAP_ZOOM}
      maxZoom={19}
      maxBounds={JAPAN_MAP_BOUNDS}
      maxBoundsViscosity={1}
      bounceAtZoomLimits={false}
      preferCanvas
    >
      <JapanViewportLimits />
      <TileLayer
        url="https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png"
        attribution={`Relief: ${gsiAttribution}`}
        errorTileUrl={transparentTileUrl}
        bounds={JAPAN_MAP_BOUNDS}
        noWrap
        minNativeZoom={2}
        maxNativeZoom={16}
        maxZoom={19}
      />
      <Suspense fallback={null}>
        <WeatherSurface grid={weatherSurfaceGrid(weather, dayIndex)} dayIndex={dayIndex} opacity={surfaceOpacity} surface={weather?.surface} date={selectedDate} />
      </Suspense>
      <Suspense fallback={null}>
        <NationalParkBoundaries />
      </Suspense>
      <Suspense fallback={null}>
        <MountainMarkers weather={weather} selectedDate={selectedDate} />
      </Suspense>
    </MapContainer>
  )
}
