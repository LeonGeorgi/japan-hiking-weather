"""Configuration shared with the TypeScript app and import adapter."""

import json
from pathlib import Path

CONFIG = json.loads((Path(__file__).resolve().parents[1] / "src/weather/config.json").read_text())

FORECAST_DAYS = CONFIG["forecastDays"]
WEATHER_TIMEZONE = CONFIG["timezone"]
HIKING_WINDOW = CONFIG["hikingWindow"]
NATIVE_GRID_BOUNDS = CONFIG["nativeGridBounds"]
NATIVE_METRICS = CONFIG["nativeMetrics"]
TERRAIN_SURFACE = CONFIG["terrainSurface"]
