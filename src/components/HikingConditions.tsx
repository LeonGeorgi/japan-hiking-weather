import type { HikingWeather } from '../weather/schema'
import { assessHikingWeather, hikingFactors } from '../weather/scoring'
import { formatHikingFactor, formatHikingWindow, formatWeatherValue, hikingCondition } from '../weather/presentation'
import styles from './HikingConditions.module.css'

interface HikingConditionsProps {
  weather: HikingWeather | null | undefined
}

const warningLabels = {
  thunderstorm: 'Gewitterhinweis im Modell',
  freezingRain: 'Gefrierender Niederschlag',
  snow: 'Neuschnee / Winterbedingungen',
  wetCold: 'Nasskalte Bedingungen',
}

export default function HikingConditions({ weather }: HikingConditionsProps) {
  const assessment = assessHikingWeather(weather)
  const condition = hikingCondition(assessment.score)
  const availableFactors = hikingFactors.filter(({ key }) => assessment.factors[key] !== null)
  const weakestScore = Math.min(...availableFactors.map(({ key }) => assessment.factors[key]!))
  const weakest = availableFactors.filter(({ key }) => assessment.factors[key] === weakestScore)
  const details = weather ? {
    wind: `Wind max. ${formatWeatherValue(weather.windMax, 'km/h')}, Böen ${formatWeatherValue(weather.gustMax, 'km/h')}`,
    rain: `${formatWeatherValue(weather.precipitation, 'mm')} gesamt, stärkste Stunde ${formatWeatherValue(weather.precipitationMax, 'mm')}`,
    temperature: `Gefühlt ${formatWeatherValue(weather.feelsLikeMin, '°C')} bis ${formatWeatherValue(weather.feelsLikeMax, '°C')}`,
    visibility: `Geringste Sichtweite ${formatWeatherValue(weather.visibilityMin === null ? null : weather.visibilityMin / 1000, 'km')}`,
  } : null

  return (
    <section className={styles.section} aria-label="Wanderbedingungen">
      <h3 className={styles.title}>Wanderwert</h3>
      <p className={styles.rating}>
        <strong style={{ color: condition.color }}>{assessment.score === null ? '–' : assessment.score}<span> / 100</span></strong>
        <span>{condition.label}</span>
      </p>
      <p className={styles.secondary}>{`${formatHikingWindow()} · `}{weather ? `${weather.hours} Std. bei Tageslicht` : 'Stundenwerte fehlen'}</p>
      {assessment.score === null ? (
        <p className={styles.note}>Für eine vollständige Bewertung fehlen Wetterdaten.</p>
      ) : assessment.score < 100 && (
        <p className={styles.note}>Begrenzt durch: {weakest.map(({ label }) => label).join(', ')}.</p>
      )}
      {assessment.warnings.length > 0 && (
        <ul className={styles.warnings}>
          {assessment.warnings.map((warning) => <li key={warning}>{warningLabels[warning]}</li>)}
        </ul>
      )}
      {weather && details && (
        <details className={styles.breakdown}>
          <summary>Teilbewertungen</summary>
          <dl className={styles.factors}>
            {hikingFactors.map(({ key, label, weight }) => (
              <div key={key}>
                <dt>{label} <span>{weight * 100} %</span></dt>
                <dd>{formatHikingFactor(assessment.factors[key])} / 100</dd>
                <dd className={styles.detail}>{details[key]}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  )
}
