"""Native 5-km MSM cells from Open-Meteo's public run-based distribution."""

import asyncio
import datetime as dt

import aiohttp
import numpy as np
from omfiles import OmFileReaderAsync

from ecmwf_source import BASE
from weather_config import HIKING_WINDOW, NATIVE_GRID_BOUNDS

FIELDS = {
    "temperature_2m": "°C", "relative_humidity_2m": "%",
    "wind_u_component_10m": "m/s", "wind_v_component_10m": "m/s",
    "precipitation": "mm", "cloud_cover": "%", "shortwave_radiation": "W/m²",
}


def japan_rows():
    # Open-Meteo JmaDomain.msm: 481 × 505, origin 22.4°N/120°E.
    bounds = NATIVE_GRID_BOUNDS
    west = int(np.ceil((bounds["west"] - 120) / .0625))
    east = int(np.floor((bounds["east"] - 120) / .0625))
    south = int(np.ceil(round((bounds["south"] - 22.4) / .05, 8)))
    north = int(np.floor(round((bounds["north"] - 22.4) / .05, 8)))
    return [{"y": y, "latitude": round(22.4 + y * .05, 8), "west": 120 + west * .0625,
             "step": .0625, "count": east - west + 1} for y in range(north, south - 1, -1)]


async def available_runs(fs, dates, timezone):
    latest = await fs.json(BASE + "data_spatial/jma_msm/latest.json")
    reference = dt.datetime.fromisoformat(latest["reference_time"].replace("Z", "+00:00"))
    runs = []
    for offset in range(8):
        stamp = reference - dt.timedelta(hours=3 * offset)
        path = f"data_run/jma_msm/{stamp:%Y/%m/%d/%H}00Z/"
        try:
            meta = await fs.json(BASE + path + "meta.json")
        except aiohttp.ClientResponseError as error:
            if error.status == 404:
                continue
            raise
        if not all(field in meta["variables"] for field in FIELDS):
            continue
        times = [dt.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() for t in meta["valid_times"]]
        runs.append((path, meta, times))
    chosen = []
    for date in dates:
        morning = dt.datetime.fromisoformat(date).replace(hour=HIKING_WINDOW["startHour"] - 1, tzinfo=timezone).timestamp()
        evening = dt.datetime.fromisoformat(date).replace(hour=HIKING_WINDOW["endHour"], tzinfo=timezone).timestamp()
        chosen.append(next((run for run in runs if run[2][0] <= morning and run[2][-1] >= evening), None))
    return chosen


async def load_fields(fs, run, rows, targets, cache):
    prefix, meta, _ = run
    directory = cache / "jma_msm" / meta["reference_time"].replace(":", "")
    directory.mkdir(parents=True, exist_ok=True)
    west = round((rows[0]["west"] - 120) / .0625)
    point_count = sum(row["count"] for row in rows)
    fields = {}
    for name, unit in FIELDS.items():
        target = directory / f"{name}.npz"
        values = times = None
        if target.exists():
            with np.load(target) as stored:
                cached, axis = stored["values"], stored["times"]
            if axis[0] <= targets.min() and axis[-1] >= targets.max():
                values, times = cached, axis
        if values is None:
            fs.blocks = {}
            reader = await OmFileReaderAsync.from_fsspec(fs, BASE + prefix + name + ".om")
            try:
                if reader.shape[:2] != (505, 481) or (await reader.get_child_by_name("unit")).read_scalar() != unit:
                    raise ValueError(f"Unexpected MSM shape or unit: {name}")
                axis = await (await reader.get_child_by_name("time")).read_array((slice(None),))
                low, high = np.searchsorted(axis, [targets.min(), targets.max()])
                times = axis[low:high + 1]
                arrays = []
                for offset in range(0, len(rows), 32):
                    arrays.extend(await asyncio.gather(*(reader.read_array((slice(row["y"], row["y"] + 1),
                        slice(west, west + row["count"]), slice(low, high + 1))) for row in rows[offset:offset + 32])))
                values = np.concatenate(arrays).reshape(point_count, len(times))
            finally:
                reader.close()
            temporary = target.with_suffix(".tmp")
            with temporary.open("wb") as file:
                np.savez_compressed(file, values=values, times=times)
            temporary.replace(target)
        indices = np.searchsorted(times, targets)
        if (values.shape != (point_count, len(times)) or not np.isfinite(values).all()
            or not np.all(np.diff(times) == 3600) or np.any(indices >= len(times))
            or not np.array_equal(times[indices], targets)):
            raise ValueError(f"Incomplete hourly MSM field: {name}")
        fields[name] = values[:, indices]
        if name not in {"temperature_2m", "wind_u_component_10m", "wind_v_component_10m"}:
            fields[name] = fields[name].clip(0)
        print(f"Loaded MSM {name}; downloaded {fs.transferred / 1e6:.1f} MB", flush=True)
    return fields
