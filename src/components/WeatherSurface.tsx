import { useEffect, useId, useMemo, useRef } from 'react'
import { TileLayer } from 'leaflet'
import { Pane, SVGOverlay, useMap } from 'react-leaflet'
import type { NativeWeatherGrid, TerrainWeatherSurface } from '../weather/schema'
import { landMaskPath, surfaceProjection } from '../weather/land-mask'
import { useJapanLand } from '../weather/useJapanLand'
import { renderWeatherSurface } from '../weather/render-surface'
import styles from './MapView.module.css'
import transparentTileUrl from '../assets/transparent-tile.svg'

interface WeatherSurfaceProps {
  grid: NativeWeatherGrid | undefined
  dayIndex: number
  opacity: number
  surface: TerrainWeatherSurface | undefined
  date: string
}

export default function WeatherSurface(props: WeatherSurfaceProps) {
  return (
    <Pane name="weather-surface" className={styles.weatherSurface}>
      {props.surface
        ? <TerrainTiles surface={props.surface} date={props.date} opacity={props.opacity} />
        : <NativeSurface grid={props.grid} dayIndex={props.dayIndex} opacity={props.opacity} />}
    </Pane>
  )
}

function TerrainTiles({ surface, date, opacity }: { surface: TerrainWeatherSurface; date: string; opacity: number }) {
  const map = useMap()
  const layer = useRef<TileLayer | null>(null)
  useEffect(() => {
    const tiles = new Set(surface.tiles)
    const url = `${import.meta.env.BASE_URL}weather/${surface.path}/${date}/{z}/{x}/{y}.png`
    const current = new TileLayer(url, {
      pane: 'weather-surface', noWrap: true, minNativeZoom: surface.minZoom, maxNativeZoom: surface.zoom, maxZoom: 19,
      errorTileUrl: transparentTileUrl,
      attribution: 'Höhen: <a href="https://maps.gsi.go.jp/development/ichiran.html">GSI DEM</a> · Landmaske: <a href="https://www.geoboundaries.org/">geoBoundaries</a> / MLIT',
    })
    const tileUrl = current.getTileUrl.bind(current)
    current.getTileUrl = (coords) => tiles.has(`${coords.z}/${coords.x}/${coords.y}`) ? tileUrl(coords) : transparentTileUrl
    current.addTo(map)
    layer.current = current
    return () => { current.remove(); layer.current = null }
  }, [map, surface, date])
  useEffect(() => { layer.current?.setOpacity(opacity) }, [surface, date, opacity])
  return null
}

function NativeSurface({ grid, dayIndex, opacity }: Pick<WeatherSurfaceProps, 'grid' | 'dayIndex' | 'opacity'>) {
  const { land, loadError } = useJapanLand()
  const clipId = useId()
  const projection = useMemo(() => grid ? surfaceProjection(grid) : null, [grid])
  const url = useMemo(() => grid && projection ? renderWeatherSurface(grid, dayIndex, projection) : null, [grid, dayIndex, projection])
  const path = useMemo(() => land && projection ? landMaskPath(land, projection) : null, [land, projection])

  // Never display an unrestricted weather rectangle while the land mask loads.
  if (loadError && grid) return <p className={styles.surfaceNotice} role="status">Die Wetterfläche konnte nicht geladen werden.</p>
  if (!grid || !url || !path || !projection) return null
  const { south, west, north, east } = grid
  return (
    <SVGOverlay
      key={`${south},${west},${north},${east}`}
      bounds={[[south, west], [north, east]]}
      opacity={opacity}
      interactive={false}
      attributes={{ viewBox: `0 0 ${projection.width} ${projection.height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Wanderbedingungen auf japanischen Landflächen und Inseln' }}
      attribution='Landmaske: <a href="https://www.geoboundaries.org/">geoBoundaries</a> / MLIT (aufbereitet)'
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path d={path} clipRule="evenodd" fillRule="evenodd" />
        </clipPath>
      </defs>
      <image href={url} width={projection.width} height={projection.height} clipPath={`url(#${clipId})`} />
    </SVGOverlay>
  )
}
