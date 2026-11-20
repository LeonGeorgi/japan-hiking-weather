import type { ForecastState } from '../weather/useForecast'
import { formatFetchedAt, formatForecastDate, isForecastStale, hikingLegend } from '../weather/presentation'
import { hikingFactors } from '../weather/scoring'
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
        <span className={styles.secondary}>Wanderwert: 08–16 Uhr JST bei Tageslicht</span>
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
        <h2 className={styles.heading}>Wanderwert · 0–100</h2>
        <ul className={styles.legend}>
          {hikingLegend.map((condition) => (
            <li key={condition.label}>
              <span className={styles.swatch} style={{ backgroundColor: condition.color }} aria-hidden="true" />
              <span>{condition.range} · {condition.label}</span>
            </li>
          ))}
          <li><span className={styles.swatch} style={{ backgroundColor: '#94a3b8' }} aria-hidden="true" />Nicht bewertbar</li>
        </ul>
      </section>

      <p className={styles.secondary}>
        Gipfel anklicken für Gesamtwert, Teilbewertungen und Wetterdaten.
      </p>
      <details className={styles.method}>
        <summary>Wie wird bewertet?</summary>
        <p>Gewichtetes geometrisches Mittel. Ein Teilwert von 0 setzt den Gesamtwert auf 0. Fehlende Daten ergeben keine Gesamtbewertung.</p>
        <ul>
          {hikingFactors.map(({ key, label, weight }) => <li key={key}>{label}: {weight * 100} %</li>)}
        </ul>
        <p>Bewertet werden die ungünstigsten Stundenwerte und der gesamte Niederschlag im Wanderzeitfenster.</p>
        <p>Eigene Heuristik für Bergwanderungen ohne Winterausrüstung. Neuschnee, gefrierender Niederschlag oder ein Gewitterhinweis setzen den Niederschlagswert auf 0.</p>
      </details>
      <p className={styles.secondary}>Altschnee, Wegzustand und Sperrungen sind nicht bewertet.</p>
      <p className={styles.secondary}>
        Modellraster ca. 9 km. Temperatur an die Gipfelhöhe angepasst; Wind und Niederschlag stammen aus dem Modellraster.
      </p>
      <p className={styles.secondary}>
        Wetter: <a href="https://open-meteo.com/en/docs/ecmwf-api" target="_blank" rel="noreferrer">Open-Meteo</a> / ECMWF
      </p>
    </div>
  )
}
