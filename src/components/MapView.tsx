import { lazy, Suspense } from 'react'
import { MapContainer, Pane, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import transparentTileUrl from '../assets/transparent-tile.svg'
import styles from './MapView.module.css'

const MountainMarkers = lazy(() => import('./MountainMarkers'))
const NationalParkBoundaries = lazy(() => import('./NationalParkBoundaries'))

const gsiAttribution = '<a href="https://maps.gsi.go.jp/development/ichiran.html">GSI</a>'

export default function MapView() {
  return (
    <MapContainer
      className={styles.map}
      center={[36.2048, 138.2529]}
      zoom={5}
      minZoom={2}
      maxZoom={19}
      preferCanvas
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <Pane name="hillshade" className={styles.hillshade}>
        <TileLayer
          url="https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png"
          attribution={`Relief: ${gsiAttribution} (aufbereitet)`}
          opacity={0.45}
          errorTileUrl={transparentTileUrl}
          bounds={[[20, 122], [46, 154]]}
          maxNativeZoom={16}
          maxZoom={19}
        />
      </Pane>
      <Suspense fallback={null}>
        <NationalParkBoundaries />
      </Suspense>
      <Suspense fallback={null}>
        <MountainMarkers />
      </Suspense>
    </MapContainer>
  )
}
