import { useState } from 'react'
import MapView from './components/MapView'
import WeatherSidebar from './components/WeatherSidebar'
import { useForecast } from './weather/useForecast'
import { defaultForecastDate } from './weather/presentation'
import styles from './App.module.css'

export default function App() {
  const forecast = useForecast()
  const [requestedDate, setRequestedDate] = useState('')
  const [surfaceOpacity, setSurfaceOpacity] = useState(0.4)
  const dates = forecast.snapshot?.dates ?? []
  const selectedDate = dates.includes(requestedDate) ? requestedDate : defaultForecastDate(dates)

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Wetter und Tagesauswahl">
        <WeatherSidebar forecast={forecast} selectedDate={selectedDate} onDateChange={setRequestedDate} surfaceOpacity={surfaceOpacity} onSurfaceOpacityChange={setSurfaceOpacity} />
      </aside>
      <main className={styles.mapArea} aria-label="Karte">
        <MapView weather={forecast.snapshot} selectedDate={selectedDate} surfaceOpacity={surfaceOpacity} />
      </main>
    </div>
  )
}
