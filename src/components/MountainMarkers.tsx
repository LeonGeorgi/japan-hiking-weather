import { useState } from 'react'
import { icon } from 'leaflet'
import { Marker, LayerGroup, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { MOUNTAIN_MARKER_MIN_ZOOM } from '../map-settings'
import { mountains } from '../data/mountains'
import type { WeatherSnapshot } from '../weather/schema'
import { formatWeatherValue, hikingCondition, weatherCondition } from '../weather/presentation'
import { assessHikingWeather } from '../weather/scoring'
import MountainWeather from './MountainWeather'
import HikingConditions from './HikingConditions'
import summitIconUrl from '../assets/summit.svg'

const summitIcon = icon({
  iconUrl: summitIconUrl,
  iconSize: [10, 10],
  iconAnchor: [5, 6],
  popupAnchor: [0, -5],
  tooltipAnchor: [5, 0],
})

interface MountainMarkersProps {
  weather: WeatherSnapshot | null
  selectedDate: string
}

export default function MountainMarkers({ weather, selectedDate }: MountainMarkersProps) {
  const map = useMap()
  const [visible, setVisible] = useState(() => map.getZoom() >= MOUNTAIN_MARKER_MIN_ZOOM)
  useMapEvents({
    zoomend: () => setVisible(map.getZoom() >= MOUNTAIN_MARKER_MIN_ZOOM),
  })
  const dayIndex = weather?.dates.indexOf(selectedDate) ?? -1

  return (
    <LayerGroup attribution='Bergdaten: <a href="https://web2.gsi.go.jp/kihonjohochousa/kihonjohochousa41139.html">GSI</a> | Wetter: <a href="https://open-meteo.com/">Open-Meteo</a> / <a href="https://www.jma.go.jp/">JMA</a> / <a href="https://www.ecmwf.int/en/forecasts/datasets/open-data">ECMWF</a>'>
      {visible && mountains.map((mountain) => {
        const daily = weather?.forecasts[String(mountain.id)]?.[dayIndex]
        const assessment = assessHikingWeather(daily?.hiking)
        const condition = hikingCondition(assessment.score)
        return (
          <Marker
            key={mountain.id}
            position={mountain.position}
            icon={summitIcon}
            title={`${mountain.name} · ${mountain.elevation} m`}
            alt={mountain.name}
          >
            <Tooltip>
              <span lang="ja">{mountain.name}</span>
              <br />
              {assessment.score === null ? condition.label : `${assessment.score} / 100 · ${condition.label}`}
              {daily && (
                <>
                  <br />
                  {weatherCondition(daily.code).label} · Tagesmax. {formatWeatherValue(daily.temperatureMax, '°C')}
                </>
              )}
            </Tooltip>
            <Popup maxWidth={360} maxHeight={520}>
              <strong lang="ja">{mountain.name}</strong>
              <br />
              <span lang="ja">{mountain.reading}</span>
              <br />
              {mountain.elevation.toLocaleString('de-DE')} m
              <br />
              <span lang="ja">{mountain.prefecture}</span>
              <HikingConditions weather={daily?.hiking} />
              <MountainWeather date={selectedDate} weather={daily} />
            </Popup>
          </Marker>
        )
      })}
    </LayerGroup>
  )
}
