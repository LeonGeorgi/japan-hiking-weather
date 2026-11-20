import MapView from './components/MapView'
import styles from './App.module.css'

export default function App() {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar} aria-label="Seitenleiste" />
      <main className={styles.mapArea} aria-label="Karte">
        <MapView />
      </main>
    </div>
  )
}
