import { useEffect, useState } from 'react'
import type { Feature, FeatureCollection, MultiPolygon } from 'geojson'
import { GeoJSON as LeafletGeoJSON, type LeafletEvent } from 'leaflet'
import { GeoJSON, LayerGroup, Popup, Tooltip } from 'react-leaflet'
import nationalParksUrl from '../data/biodic-national-parks.geojson?url'
import styles from './NationalParkBoundaries.module.css'

type NationalPark = Feature<MultiPolygon, { name: string }>
type NationalParkCollection = FeatureCollection<MultiPolygon, { name: string }>

const boundaryStyle = {
  color: '#15803d',
  weight: 2,
  opacity: 0.9,
  fill: false,
}

const boundaryEvents = {
  add({ target }: LeafletEvent) {
    // Use the shared canvas so both outlines and summit markers receive clicks.
    if (target instanceof LeafletGeoJSON) {
      target.bringToBack()
    }
  },
}

export default function NationalParkBoundaries() {
  const [parks, setParks] = useState<NationalPark[]>([])
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function loadParks() {
      try {
        const response = await fetch(nationalParksUrl, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Loading national parks failed: ${response.status}`)
        }
        const data: NationalParkCollection = await response.json()
        setParks(data.features)
      } catch {
        if (!controller.signal.aborted) {
          setLoadError(true)
        }
      }
    }

    void loadParks()
    return () => controller.abort()
  }, [])

  return (
    <>
      {loadError && (
        <p className={styles.notice} role="alert">
          Nationalparkgrenzen konnten nicht geladen werden.
        </p>
      )}
      <LayerGroup attribution='Nationalparks: <a href="https://www.biodic.go.jp/trialSystem/top_en.html">MOE/Biodic</a> (aufbereitet)'>
        {parks.map((park) => (
          <GeoJSON
            key={park.properties.name}
            data={park}
            style={boundaryStyle}
            eventHandlers={boundaryEvents}
          >
            <Tooltip sticky>{park.properties.name}</Tooltip>
            <Popup>
              <strong>{park.properties.name}</strong>
              <br />
              Nationalpark
            </Popup>
          </GeoJSON>
        ))}
      </LayerGroup>
    </>
  )
}
