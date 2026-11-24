import config from './config.json' with { type: 'json' }

export const FORECAST_DAYS = config.forecastDays
export const WEATHER_TIMEZONE = config.timezone
export const HIKING_WINDOW = config.hikingWindow
export const NATIVE_GRID_BOUNDS = config.nativeGridBounds
export const NATIVE_METRICS = config.nativeMetrics
