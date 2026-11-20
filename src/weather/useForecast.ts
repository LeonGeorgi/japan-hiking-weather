import { useEffect, useState } from 'react'
import { parseWeatherSnapshot } from './schema.ts'
import type { WeatherSnapshot } from './schema.ts'

export interface ForecastState {
  snapshot: WeatherSnapshot | null
  status: 'loading' | 'ready' | 'error'
}

export function useForecast(): ForecastState {
  const [state, setState] = useState<ForecastState>({ snapshot: null, status: 'loading' })

  useEffect(() => {
    let controller: AbortController | undefined

    async function refresh() {
      controller?.abort()
      const request = new AbortController()
      controller = request
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}weather/forecast.json`, {
          signal: request.signal,
          cache: 'no-cache',
        })
        if (!response.ok) throw new Error(`Forecast HTTP ${response.status}`)
        const snapshot = parseWeatherSnapshot(await response.json())
        if (!request.signal.aborted) setState({ snapshot, status: 'ready' })
      } catch {
        if (!request.signal.aborted) setState((previous) => ({ ...previous, status: 'error' }))
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') void refresh()
    }

    void refresh()
    const interval = window.setInterval(refreshWhenVisible, 30 * 60 * 1_000)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      controller?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshWhenVisible)
    }
  }, [])

  return state
}
