import { CircleMarker, LayerGroup, Popup, Tooltip } from 'react-leaflet'
import { mountains } from '../data/mountains'
import type { WeatherSnapshot } from '../weather/schema'
import { formatWeatherValue, hikingCondition, weatherCondition } from '../weather/presentation'
import { assessHikingWeather } from '../weather/scoring'
import MountainWeather from './MountainWeather'
import HikingConditions from './HikingConditions'

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
        const assessment = assessHikingWeather(daily?.hiking)
        const condition = hikingCondition(assessment.score)
        return (
          <CircleMarker
            key={mountain.id}
            center={mountain.position}
            radius={4}
            pathOptions={{ ...markerStyle, fillColor: condition.color }}
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
          </CircleMarker>
        )
      })}
    </LayerGroup>
  )
}
