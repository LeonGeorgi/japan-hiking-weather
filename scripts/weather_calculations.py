"""Shared meteorology for native surfaces and elevation-corrected summits."""

import calendar
import datetime as dt

import numpy as np

from weather_config import HIKING_WINDOW, NATIVE_METRICS

METRICS = NATIVE_METRICS["fields"]


def resample(values, times, targets, reference, interval=False, total=False, axis=None):
    """Interpolate instants; overlap-weight interval totals to conserve water.

    Gusts retain each native interval's maximum. Radiation retains its mean.
    Coarser native intervals cannot recover unknown hourly precipitation peaks.
    """
    if interval:
        canonical = np.asarray(axis)
        left = canonical[np.maximum(0, np.searchsorted(canonical, times) - 1)]
        left = np.where(times == reference, times - 3600, left)
        result = np.zeros((len(values), len(targets)), dtype=np.float32)
        for index, target in enumerate(targets):
            overlap = np.maximum(0, np.minimum(times, target) - np.maximum(left, target - 3600))
            if overlap.sum() != 3600:
                raise ValueError("Incomplete forecast interval")
            selected = overlap > 0
            if total:
                result[:, index] = values[:, selected] @ (overlap[selected] / (times[selected] - left[selected]))
            elif interval == "maximum":
                result[:, index] = values[:, selected].max(axis=1)
            else:
                result[:, index] = values[:, selected] @ (overlap[selected] / 3600)
        return result
    upper = np.searchsorted(times, targets, side="right").clip(1, len(times) - 1)
    lower = upper - 1
    fraction = (targets - times[lower]) / (times[upper] - times[lower])
    if np.any(fraction < 0) or np.any(fraction > 1):
        raise ValueError("Forecast does not bracket requested hours")
    return (values[:, lower] * (1 - fraction) + values[:, upper] * fraction).astype(np.float32)


def daylight(latitudes, longitudes, targets):
    # NOAA solar position equations: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
    moments = [dt.datetime.fromtimestamp(int(t), dt.timezone.utc) for t in targets]
    gamma = np.array([2 * np.pi / (366 if calendar.isleap(t.year) else 365)
                      * (t.timetuple().tm_yday - 1 + (t.hour - 12) / 24) for t in moments])
    equation = 229.18 * (.000075 + .001868 * np.cos(gamma) - .032077 * np.sin(gamma)
                        - .014615 * np.cos(2 * gamma) - .040849 * np.sin(2 * gamma))
    declination = (.006918 - .399912 * np.cos(gamma) + .070257 * np.sin(gamma)
                   - .006758 * np.cos(2 * gamma) + .000907 * np.sin(2 * gamma)
                   - .002697 * np.cos(3 * gamma) + .00148 * np.sin(3 * gamma))
    solar_minutes = np.array([t.hour * 60 for t in moments]) + equation + 4 * longitudes[:, None]
    angle = np.deg2rad(solar_minutes / 4 - 180)
    latitude = np.deg2rad(latitudes[:, None])
    cosine = np.sin(latitude) * np.sin(declination) + np.cos(latitude) * np.cos(declination) * np.cos(angle)
    return cosine > np.cos(np.deg2rad(90.833))


def apparent_temperature(temperature, dewpoint, wind, solar):
    # Same meteorological formula as Open-Meteo Meteorology.apparentTemperature.
    humidity = np.exp(17.625 * dewpoint / (243.04 + dewpoint)
                      - 17.625 * temperature / (243.04 + temperature)).clip(0, 1)
    vapor = humidity * 6.105 * np.exp(17.27 * temperature / (237.7 + temperature))
    wind_at_two_metres = wind * .75
    absorbed = np.maximum(0, .1 * (solar - 550))
    return temperature + .348 * vapor - .70 * wind_at_two_metres + .70 * absorbed / (wind_at_two_metres + 10) - 4.25


def thunder_probability(cape, showers, rain, cloud, gust, latitude):
    # Open-Meteo's weather-code indicator with its optional CIN/LI/PBL inputs absent.
    tropical = 1 - np.minimum(np.abs(latitude[:, None]), 30) / 30
    cape_part = ((cape - 300) / (2200 + 1500 * tropical)).clip(0, 1)
    trigger = 2 + 3 * tropical
    has_showers = showers > 0
    rain_weight = np.where(has_showers, .25, .15)
    rain_part = np.where(has_showers, (showers / trigger).clip(0, 1),
                         (rain / (trigger * 1.6)).clip(0, 1))
    gust_part = ((gust - 5) / 13).clip(0, 1)
    probability = (cape_part * .25 + rain_part * rain_weight + gust_part * .075) / (.325 + rain_weight) * 100
    probability *= np.where(showers <= 0, .7, 1)
    probability *= (.6 + .4 * ((cloud - 30) / 30)).clip(.6, 1)
    probability *= 1 - .2 * tropical
    return np.where((cape <= 10) | (cloud < 30), 0, probability)


def summarize(fields, latitude, longitude, targets, thunder=None):
    sun = daylight(latitude, longitude, targets)
    intervals = sun[:, :-1] & sun[:, 1:]
    instants = np.zeros_like(sun)
    instants[:, :-1] |= intervals
    instants[:, 1:] |= intervals
    def extreme(values, maximum=False):
        masked = np.where(instants, values, -np.inf if maximum else np.inf)
        return masked.max(axis=1) if maximum else masked.min(axis=1)
    def amount(values):
        return np.where(intervals, values[:, 1:], 0).sum(axis=1)
    wind = np.hypot(fields["wind_u_component_10m"], fields["wind_v_component_10m"])
    feels = apparent_temperature(fields["temperature_2m"], fields["dew_point_2m"], wind, fields["shortwave_radiation"])
    snow = fields["snowfall_water_equivalent"] * .7
    if thunder is None:
        thunder = (thunder_probability(fields["cape"], fields["showers"], fields["precipitation"], fields["cloud_cover"], fields["wind_gusts_10m"], latitude)
                   if "cape" in fields else np.zeros_like(wind))
    hazards = ((thunder > 60) & instants).any(axis=1).astype(np.uint8) * NATIVE_METRICS["hazards"]["thunderstorm"]["mask"]
    hazards |= ((snow[:, 1:] >= .01) & intervals).any(axis=1).astype(np.uint8) * NATIVE_METRICS["hazards"]["snow"]["mask"]
    metrics = {
        "hours": intervals.sum(axis=1),
        "temperatureMin": extreme(fields["temperature_2m"]),
        "feelsLikeMin": extreme(feels),
        "feelsLikeMax": extreme(feels, True),
        "precipitation": amount(fields["precipitation"]),
        "precipitationMax": np.where(intervals, fields["precipitation"][:, 1:], 0).max(axis=1),
        "snowfall": amount(snow),
        "windMax": extreme(wind, True) * 3.6,
        "gustMax": extreme(fields["wind_gusts_10m"], True) * 3.6,
        "visibilityMin": extreme(fields["visibility"]),
        "hazards": hazards,
    }
    result = np.column_stack([metrics[name] for name in METRICS]).astype("<f4")
    for column, name in enumerate(METRICS):
        if name != "hours":
            result[metrics["hours"] == 0, column] = np.nan
    return result


def derive_msm_fields(fields):
    humidity = (fields["relative_humidity_2m"] / 100).clip(.0001, 1)
    temperature = fields["temperature_2m"]
    gamma = np.log(humidity) + 17.625 * temperature / (243.04 + temperature)
    return {**fields, "dew_point_2m": 243.04 * gamma / (17.625 - gamma),
            "snowfall_water_equivalent": np.where(np.isfinite(temperature), np.where(temperature < 0, fields["precipitation"], 0), np.nan)}


def summarize_msm(fields, support, latitude, longitude, targets):
    temperature = fields["temperature_2m"]
    fields = {**derive_msm_fields(fields),
              "wind_gusts_10m": np.broadcast_to(support[:, METRICS.index("gustMax"), None] / 3.6, temperature.shape),
              "visibility": np.broadcast_to(support[:, METRICS.index("visibilityMin"), None], temperature.shape)}
    result = summarize(fields, latitude, longitude, targets)
    # MSM has no native thunder indicator. Preserve the nearest IFS cell's flag.
    valid = (support[:, METRICS.index("hours")] > 0) & (result[:, METRICS.index("hours")] > 0) & np.isfinite(support).all(axis=1)
    hazard_index = METRICS.index("hazards")
    thunder_mask = NATIVE_METRICS["hazards"]["thunderstorm"]["mask"]
    result[valid, hazard_index] = (result[valid, hazard_index].astype(int)
                                  | (support[valid, hazard_index].astype(int) & thunder_mask))
    result[~valid] = np.nan
    result[~valid, METRICS.index("hours")] = 0
    return result


def nearest_cells(rows, latitudes, longitudes):
    latitude = np.array([row["latitude"] for row in rows])
    lower = np.searchsorted(-latitude, -latitudes).clip(1, len(rows) - 1)
    row = np.where(abs(latitude[lower] - latitudes) < abs(latitude[lower - 1] - latitudes), lower, lower - 1)
    west = np.array([r["west"] for r in rows])
    count = np.array([r["count"] for r in rows])
    step = np.array([r["step"] for r in rows])
    column = np.rint((longitudes - west[row]) / step[row]).astype(int).clip(0, count[row] - 1)
    return np.r_[0, np.cumsum(count[:-1])][row] + column


def summit_cells(rows, terrain, latitudes, longitudes, elevations):
    """Prefer a nearby land cell with similar terrain; keep close height matches."""
    nearest = nearest_cells(rows, latitudes, longitudes)
    offsets = np.r_[0, np.cumsum([r["count"] for r in rows])]
    selected = nearest.copy()
    heights = terrain[nearest]
    valid = np.isfinite(heights) & (heights > -999) & (heights < 9999)
    best = np.where(valid, abs(heights - elevations), np.inf)
    fixed = valid & (best <= 100)
    center_rows = np.searchsorted(offsets, nearest, side="right") - 1
    latitude = np.array([r["latitude"] for r in rows])
    west = np.array([r["west"] for r in rows])
    step = np.array([r["step"] for r in rows])
    count = np.array([r["count"] for r in rows])
    # Nine vectorized candidates also make the same selection practical for DEM pixels.
    for dy in [-1, 0, 1]:
        y = (center_rows + dy).clip(0, len(rows) - 1)
        center_columns = np.rint((longitudes - west[y]) / step[y]).astype(int)
        for dx in [-1, 0, 1]:
            column = (center_columns + dx).clip(0, count[y] - 1)
            point = offsets[y] + column
            candidate = terrain[point]
            distance = np.hypot(latitude[y] - latitudes, west[y] + column * step[y] - longitudes) * 111
            penalty = abs(candidate - elevations) + 30 * distance
            better = (~fixed & np.isfinite(candidate) & (candidate > -999) & (candidate < 9999)
                      & (distance < 50) & (penalty < best) & (penalty <= 1500))
            selected[better], best[better] = point[better], penalty[better]
    heights = terrain[selected].copy()
    heights[heights <= -999] = 0  # Open-Meteo's sea-cell marker.
    heights[heights >= 9999] = np.nan
    return selected, heights


def correct_elevation(fields, model_height, summit_height):
    """Open-Meteo's fixed lapse correction: -0.65 °C per additional 100 m."""
    shift = (np.asarray(model_height) - np.asarray(summit_height))[:, None] * .0065
    return {name: values + shift if name in {"temperature_2m", "dew_point_2m"} else values
            for name, values in fields.items()}


def weather_codes(fields, thunder, interval_ends=None):
    """Hourly WMO interpretation of the available native fields."""
    rain = fields["precipitation"]
    snow = fields["snowfall_water_equivalent"] * .7
    if interval_ends is not None:
        # Accumulations describe the preceding hour, not the current instant.
        rain = np.where(interval_ends, rain, 0)
        snow = np.where(interval_ends, snow, 0)
    cloud = fields["cloud_cover"]
    codes = np.select([cloud < 20, cloud < 50, cloud < 80], [0, 1, 2], default=3)
    codes = np.where(fields["visibility"] <= 1000, 45, codes)
    for threshold, code in [(.01, 51), (.5, 53), (1, 55), (1.3, 61), (2.5, 63), (7.6, 65)]:
        codes = np.where(rain >= threshold, code, codes)
    for threshold, code in [(.01, 71), (.2, 73), (.8, 75)]:
        codes = np.where(snow >= threshold, code, codes)
    if "cape" in fields:
        convective = (fields["cape"] >= 800) | (fields["showers"] > 0)
        codes = np.where(convective & (rain >= 1.3) & (snow < .01), 80, codes)
        codes = np.where(convective & (rain >= 2.5) & (snow < .01), 81, codes)
        codes = np.where(convective & (rain >= 7.6) & (snow < .01), 82, codes)
        codes = np.where(convective & (snow >= .01), 85, codes)
        codes = np.where(convective & (snow >= .8), 86, codes)
    codes = np.where(thunder > 60, 95, codes)
    codes = np.where(thunder > 85, 96, codes)
    valid = np.isfinite(rain) & np.isfinite(snow) & np.isfinite(cloud) & np.isfinite(thunder)
    return np.where(valid, codes, np.nan)


def summit_forecasts(fields, latitude, longitude, targets, model, thunder=None, daily_supplemented=False):
    """25 hourly boundaries: instants 00–23, precipitation intervals 00–24 JST."""
    if thunder is None:
        thunder = thunder_probability(fields["cape"], fields["showers"], fields["precipitation"], fields["cloud_cover"], fields["wind_gusts_10m"], latitude)
    codes = weather_codes(fields, thunder)
    start, end = HIKING_WINDOW["startHour"], HIKING_WINDOW["endHour"]
    section = slice(start, end + 1)
    hiking_fields = {name: values[:, section] for name, values in fields.items()}
    metrics = summarize(hiking_fields, latitude, longitude, targets[section], thunder[:, section])
    sun = daylight(latitude, longitude, targets[section])
    intervals = sun[:, :-1] & sun[:, 1:]
    instants = np.zeros_like(sun)
    instants[:, :-1] |= intervals
    instants[:, 1:] |= intervals
    interval_ends = np.zeros_like(sun)
    interval_ends[:, 1:] = intervals
    hiking_codes = weather_codes(hiking_fields, thunder[:, section], interval_ends)
    wind = np.hypot(fields["wind_u_component_10m"], fields["wind_v_component_10m"]) * 3.6
    values = {
        "code": codes[:, :24].max(axis=1),
        "temperatureMin": fields["temperature_2m"][:, :24].min(axis=1),
        "temperatureMax": fields["temperature_2m"][:, :24].max(axis=1),
        "precipitation": fields["precipitation"][:, 1:].sum(axis=1),
        "snowfall": fields["snowfall_water_equivalent"][:, 1:].sum(axis=1) * .7,
        "windMax": wind[:, :24].max(axis=1),
        "gustMax": fields["wind_gusts_10m"][:, :24].max(axis=1) * 3.6,
    }
    def number(value):
        return float(value) if np.isfinite(value) else None
    forecasts = []
    for point in range(len(latitude)):
        hiking = None
        if metrics[point, METRICS.index("hours")] > 0:
            hiking = {name: number(value) for name, value in zip(METRICS, metrics[point], strict=True) if name != "hazards"}
            selected = hiking_codes[point, instants[point]]
            hiking["codes"] = sorted(set(selected.astype(int).tolist())) if np.isfinite(selected).all() else None
        daily = {name: number(value[point]) for name, value in values.items()}
        forecasts.append({**daily, "hiking": hiking, "model": model, "dailySupplemented": bool(daily_supplemented)})
    return forecasts
