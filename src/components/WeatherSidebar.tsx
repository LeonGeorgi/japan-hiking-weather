import type { ForecastState } from '../weather/useForecast'
import { formatFetchedAt, formatForecastDate, isForecastStale, weatherLegend } from '../weather/presentation'
import styles from './WeatherSidebar.module.css'

interface WeatherSidebarProps {
  forecast: ForecastState
  selectedDate: string
  onDateChange: (date: string) => void
}

export default function WeatherSidebar({ forecast, selectedDate, onDateChange }: WeatherSidebarProps) {
  const { snapshot, status } = forecast

  return (
    <div className={styles.content}>
      <header>
        <h1 className={styles.title}>Hiking Weather</h1>
        <p className={styles.model}>ECMWF IFS · 9 km</p>
      </header>

      <div className={styles.field}>
        <label htmlFor="forecast-day">Vorhersagetag</label>
        <select
          id="forecast-day"
          value={selectedDate}
          onChange={(event) => onDateChange(event.target.value)}
          disabled={!snapshot}
        >
          {!snapshot && <option value="">Noch keine Daten</option>}
          {snapshot?.dates.map((date) => (
            <option key={date} value={date}>{formatForecastDate(date)}</option>
          ))}
        </select>
        <span className={styles.secondary}>Tageswerte · Japan (JST)</span>
      </div>

      <div aria-live="polite">
        {status === 'loading' && <p className={styles.secondary}>Wetterdaten werden geladen …</p>}
        {status === 'error' && <p className={styles.notice}>{snapshot ? 'Aktualisierung fehlgeschlagen. Die zuletzt geladenen Werte bleiben sichtbar.' : 'Wetterdaten sind noch nicht verfügbar.'}</p>}
        {snapshot && isForecastStale(snapshot) && <p className={styles.notice}>Die Vorhersage ist veraltet. Bitte den Abrufzeitpunkt beachten.</p>}
      </div>

      {snapshot && (
        <p className={styles.secondary}>
          {Object.keys(snapshot.forecasts).length.toLocaleString('de-DE')} Gipfel
          <br />
          Abgerufen: <time dateTime={snapshot.fetchedAt}>{formatFetchedAt(snapshot.fetchedAt)}</time> JST
        </p>
      )}

      <section aria-label="Wetterlegende">
        <h2 className={styles.heading}>Tageswetter</h2>
        <ul className={styles.legend}>
          {weatherLegend.map((condition) => (
            <li key={condition.label}>
              <span className={styles.swatch} style={{ backgroundColor: condition.color }} aria-hidden="true" />
              {condition.label}
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.secondary}>
        Gipfel anklicken für Temperatur, Niederschlag und Wind.
      </p>
      <p className={styles.secondary}>
        Modellraster ca. 9 km. Temperatur an die Gipfelhöhe angepasst; Wind und Niederschlag stammen aus dem Modellraster.
      </p>
      <p className={styles.secondary}>
        Wetter: <a href="https://open-meteo.com/en/docs/ecmwf-api" target="_blank" rel="noreferrer">Open-Meteo</a> / ECMWF
      </p>
    </div>
  )
}
