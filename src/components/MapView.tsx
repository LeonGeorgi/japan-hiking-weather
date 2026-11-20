import { lazy, Suspense } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import styles from './MapView.module.css'

const MountainMarkers = lazy(() => import('./MountainMarkers'))

export default function MapView() {
  return (
    <MapContainer
      className={styles.map}
      center={[36.2048, 138.2529]}
      zoom={5}
      preferCanvas
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <Suspense fallback={null}>
        <MountainMarkers />
      </Suspense>
    </MapContainer>
  )
}
