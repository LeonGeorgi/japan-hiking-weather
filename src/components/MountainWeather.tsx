import type { DailyWeather } from '../weather/schema'
import { formatForecastDate, formatWeatherValue, weatherCondition } from '../weather/presentation'
import styles from './MountainWeather.module.css'

interface MountainWeatherProps {
  date: string
  weather: DailyWeather | undefined
}

export default function MountainWeather({ date, weather }: MountainWeatherProps) {
  if (!weather) return <p className={styles.section}>Keine Wetterdaten für diesen Tag verfügbar.</p>

  return (
    <section className={styles.section} aria-label="Tagesvorhersage">
      <h3 className={styles.title}>{formatForecastDate(date)} · JST</h3>
      <p className={styles.condition}>{weatherCondition(weather.code).label}</p>
      <dl className={styles.values}>
        <div><dt>Temperatur</dt><dd>{formatWeatherValue(weather.temperatureMin, '°C')} bis {formatWeatherValue(weather.temperatureMax, '°C')}</dd></div>
        <div><dt>Niederschlag</dt><dd>{formatWeatherValue(weather.precipitation, 'mm / Tag')}</dd></div>
        <div><dt>Neuschnee</dt><dd>{formatWeatherValue(weather.snowfall, 'cm / Tag')}</dd></div>
        <div><dt>Wind, max.</dt><dd>{formatWeatherValue(weather.windMax, 'km/h')}</dd></div>
        <div><dt>Böen, max.</dt><dd>{formatWeatherValue(weather.gustMax, 'km/h')}</dd></div>
      </dl>
      <p className={styles.source}>ECMWF IFS · via Open-Meteo</p>
    </section>
  )
}
