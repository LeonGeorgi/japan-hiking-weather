import { CircleMarker, LayerGroup, Popup, Tooltip } from 'react-leaflet'
import { mountains } from '../data/mountains'
import type { WeatherSnapshot } from '../weather/schema'
import { formatWeatherValue, weatherCondition } from '../weather/presentation'
import MountainWeather from './MountainWeather'

const markerStyle = {
  color: '#fff',
  weight: 1,
  fillOpacity: 0.9,
}

interface MountainMarkersProps {
  weather: WeatherSnapshot | null
  selectedDate: string
}

export default function MountainMarkers({ weather, selectedDate }: MountainMarkersProps) {
  const dayIndex = weather?.dates.indexOf(selectedDate) ?? -1

  return (
    <LayerGroup attribution='Bergdaten: <a href="https://web2.gsi.go.jp/kihonjohochousa/kihonjohochousa41139.html">GSI</a> | Wetter: <a href="https://open-meteo.com/">Open-Meteo</a> / <a href="https://www.ecmwf.int/en/forecasts/datasets/open-data">ECMWF</a>'>
      {mountains.map((mountain) => {
        const daily = weather?.forecasts[String(mountain.id)]?.[dayIndex]
        const condition = weatherCondition(daily?.code)
        return (
          <CircleMarker
            key={mountain.id}
            center={mountain.position}
            radius={4}
            pathOptions={{ ...markerStyle, fillColor: condition.color }}
          >
            <Tooltip>
              <span lang="ja">{mountain.name}</span>
              {daily && (
                <>
                  <br />
                  {condition.label} · {formatWeatherValue(daily.temperatureMax, '°C')}
                </>
              )}
            </Tooltip>
            <Popup>
              <strong lang="ja">{mountain.name}</strong>
              <br />
              <span lang="ja">{mountain.reading}</span>
              <br />
              {mountain.elevation.toLocaleString('de-DE')} m
              <br />
              <span lang="ja">{mountain.prefecture}</span>
              <MountainWeather date={selectedDate} weather={daily} />
            </Popup>
          </CircleMarker>
        )
      })}
    </LayerGroup>
  )
}
