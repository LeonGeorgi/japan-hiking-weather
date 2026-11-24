import type { ForecastState } from '../weather/useForecast'
import { formatFetchedAt, formatForecastDate, formatHikingWindow, isForecastStale, hikingLegend } from '../weather/presentation'
import { hikingFactors } from '../weather/scoring'
import { weatherSurfaceGrid } from '../weather/grid'
import { MOUNTAIN_MARKER_MIN_ZOOM } from '../map-settings'
import styles from './WeatherSidebar.module.css'

interface WeatherSidebarProps {
  forecast: ForecastState
  selectedDate: string
  onDateChange: (date: string) => void
  surfaceOpacity: number
  onSurfaceOpacityChange: (opacity: number) => void
}

export default function WeatherSidebar({ forecast, selectedDate, onDateChange, surfaceOpacity, onSurfaceOpacityChange }: WeatherSidebarProps) {
  const { snapshot, status } = forecast
  const dayIndex = snapshot?.dates.indexOf(selectedDate) ?? -1
  const grid = weatherSurfaceGrid(snapshot, dayIndex)
  const modelRun = grid?.modelRuns[dayIndex]
  const msm = grid?.kind === 'native-msm'

  return (
    <div className={styles.content}>
      <header>
        <h1 className={styles.title}>Hiking Weather</h1>
        <p className={styles.model}>{msm ? 'JMA MSM · 5 km + IFS' : 'ECMWF IFS · 9 km'}</p>
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
        <span className={styles.secondary}>{`Wanderwert: ${formatHikingWindow()} bei Tageslicht`}</span>
      </div>

      <div className={styles.field}>
        <label htmlFor="surface-opacity">Farbstärke <output htmlFor="surface-opacity">{Math.round(surfaceOpacity * 100)} %</output></label>
        <input id="surface-opacity" type="range" min="0" max="0.7" step="0.05" value={surfaceOpacity} onChange={(event) => onSurfaceOpacityChange(Number(event.target.value))} />
      </div>

      <div aria-live="polite">
        {status === 'loading' && <p className={styles.secondary}>Wetterdaten werden geladen …</p>}
        {status === 'error' && <p className={styles.notice}>{snapshot ? 'Aktualisierung fehlgeschlagen. Die zuletzt geladenen Werte bleiben sichtbar.' : 'Wetterdaten sind noch nicht verfügbar.'}</p>}
        {snapshot && isForecastStale(snapshot) && <p className={styles.notice}>Die Vorhersage ist veraltet. Bitte den Abrufzeitpunkt beachten.</p>}
        {snapshot && !snapshot.grid && <p className={styles.notice}>Flächenwerte sind noch nicht verfügbar. Die Gipfelvorhersagen bleiben abrufbar.</p>}
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
          <li><span className={`${styles.swatch} ${styles.noData}`} aria-hidden="true" />Transparent: keine Bewertung</li>
        </ul>
      </section>

      <p className={styles.secondary}>
        Bergsymbole erscheinen ab Zoomstufe {MOUNTAIN_MARKER_MIN_ZOOM}. Anklicken für eigene Gipfelwerte, Teilbewertungen und Wetterdaten.
      </p>
      <p className={styles.secondary}>
        {snapshot?.surface
          ? `Höhenkorrigiertes Flächenraster ca. ${snapshot.surface.resolutionMetres} m · GSI-Geländehöhen.`
          : grid ? `Flächenraster ca. ${grid.resolutionKm} km auf Modellgeländehöhe.` : 'Flächenraster noch nicht verfügbar.'}
        {' '}Nur japanische Landflächen inklusive Inseln sind eingefärbt, ohne räumliche Glättung der Scores.
        {snapshot?.surface && ` Die Wetterdaten haben weiterhin ${grid?.resolutionKm ?? 9} km Auflösung. Die kleineren Zellen berücksichtigen die örtliche Geländehöhe; Gipfelwerte können wegen der Rasterauflösung abweichen.`}
      </p>
      {modelRun && <p className={styles.secondary}>Modelllauf der Fläche: {formatFetchedAt(modelRun)} JST. {msm ? 'Stündliche MSM-Werte. Böen, Sicht und Gewitterhinweise aus IFS (9 km).' : 'Zeitauflösung zunächst 1, später 3–6 Stunden; auf Stundenintervalle umgelegt.'}</p>}
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
        Kurzfristig JMA MSM (ca. 5 km), danach ECMWF IFS (ca. 9 km). Gipfelwerte lokal aus denselben Rohdaten berechnet, Temperatur auf die Gipfelhöhe korrigiert. Böen, Sicht und Gewitterhinweise aus IFS.
      </p>
      <p className={styles.secondary}>
        Wetter: <a href="https://open-meteo.com/en/docs/jma-api" target="_blank" rel="noreferrer">Open-Meteo</a> / JMA / ECMWF
      </p>
    </div>
  )
}
