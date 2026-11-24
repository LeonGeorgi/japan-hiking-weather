# /// script
# requires-python = ">=3.13"
# dependencies = ["omfiles==1.2.0", "aiohttp==3.14.5", "numpy==2.5.5", "pillow==12.0.0"]
# ///
"""Extract native IFS/MSM cells and summarize daylight windows for TypeScript.

Raw files are private build inputs. Only scores and daily summit summaries go online.
"""

import argparse
import asyncio
from contextlib import AsyncExitStack
import datetime as dt
import json
import pathlib
from zoneinfo import ZoneInfo

import aiohttp
import numpy as np
from omfiles import OmFileReaderAsync

from ecmwf_source import BASE, MeasuredHTTP, japan_rows, load_terrain
import jma_msm
from weather_calculations import (correct_elevation, derive_msm_fields, nearest_cells, resample,
                                  summit_cells, summit_forecasts, summarize, summarize_msm, thunder_probability)
from weather_config import FORECAST_DAYS, HIKING_WINDOW, NATIVE_GRID_BOUNDS, NATIVE_METRICS, WEATHER_TIMEZONE
from terrain_surface import TerrainSurface, prepare_terrain

JST = ZoneInfo(WEATHER_TIMEZONE)
FIELDS = {
    "temperature_2m": "°C", "dew_point_2m": "°C",
    "wind_u_component_10m": "m/s", "wind_v_component_10m": "m/s",
    "wind_gusts_10m": "m/s", "precipitation": "mm",
    "snowfall_water_equivalent": "mm", "visibility": "m", "cloud_cover": "%",
    "cape": "J/kg", "showers": "mm", "shortwave_radiation": "W/m²",
}
TOTALS = {"precipitation", "snowfall_water_equivalent", "showers"}
INTERVALS = TOTALS | {"shortwave_radiation", "wind_gusts_10m"}
METRICS = NATIVE_METRICS["fields"]


async def available_runs(fs, dates):
    end_day = dt.datetime.fromisoformat(dates[0]).replace(tzinfo=JST).astimezone(dt.timezone.utc).date() + dt.timedelta(days=1)
    runs = []
    for offset in range(4):
        day = end_day - dt.timedelta(days=offset)
        for hour in [12, 0]:
            path = f"data_run/ecmwf_ifs/{day:%Y/%m/%d}/{hour:02}00Z/"
            try:
                meta = await fs.json(BASE + path + "meta.json")
            except aiohttp.ClientResponseError as error:
                if error.status == 404:
                    continue
                raise
            if "O1280" not in meta.get("crs_wkt", "") or not all(field in meta["variables"] for field in FIELDS):
                continue
            if dt.datetime.fromisoformat(meta["reference_time"].replace("Z", "+00:00")) > dt.datetime.now(dt.timezone.utc):
                continue
            times = [dt.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() for t in meta["valid_times"]]
            runs.append((path, meta, times))
        if len(runs) >= 3:
            break
    chosen = []
    for date in dates:
        morning = dt.datetime.fromisoformat(date).replace(hour=HIKING_WINDOW["startHour"] - 1, tzinfo=JST).timestamp()
        evening = dt.datetime.fromisoformat(date).replace(hour=HIKING_WINDOW["endHour"], tzinfo=JST).timestamp()
        candidate = next((run for run in runs if run[2][0] <= morning and run[2][-1] >= evening), None)
        if candidate is None:
            raise ValueError(f"No complete IFS run for {date}")
        chosen.append(candidate)
    return chosen


async def load_field(fs, prefix, meta, name, rows, first, last, cache, seed):
    target = cache / f"{name}.npz"
    source = target if target.exists() else None
    if source is None and seed:
        report = json.loads((seed / "report.json").read_text())
        if (report["run"] == meta["reference_time"]
            and report["bbox"] == NATIVE_GRID_BOUNDS
            and report["grid_points"] == sum(r["stop"] - r["start"] for r in rows)):
            source = seed / f"{name}.npz"
    if source and source.exists():
        with np.load(source) as data:
            values, times = data["values"], data["times"]
        if times[0] <= first and times[-1] >= last:
            if values.shape != (sum(r["stop"] - r["start"] for r in rows), len(times)) or not np.isfinite(values).all() or not np.all(np.diff(times) > 0):
                raise ValueError(f"Invalid cached field {name}")
            return values, times
    fs.blocks = {}
    reader = await OmFileReaderAsync.from_fsspec(fs, BASE + prefix + name + ".om")
    assert reader.shape[:2] == (1, 6599680)
    unit = await reader.get_child_by_name("unit")
    assert unit.read_scalar() == FIELDS[name], f"Unexpected unit: {name}"
    axis = await reader.get_child_by_name("time")
    times = await axis.read_array((slice(None),))
    assert np.all(np.diff(times) > 0) and times[0] <= first and times[-1] >= last
    low = max(0, int(np.searchsorted(times, first, side="right")) - 1)
    high = min(len(times), int(np.searchsorted(times, last)) + 1)
    arrays = []
    for offset in range(0, len(rows), 32):
        arrays.extend(await asyncio.gather(*(reader.read_array((slice(0, 1), slice(r["start"], r["stop"]), slice(low, high))) for r in rows[offset:offset + 32])))
    values = np.concatenate([a.reshape(-1, high - low) for a in arrays])
    reader.close()
    if not np.isfinite(values).all():
        raise ValueError(f"Missing values in {name}")
    times = times[low:high]
    cache.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    with temporary.open("wb") as file:
        np.savez_compressed(file, values=values, times=times)
    temporary.replace(target)
    print(f"Loaded {name}; downloaded {fs.transferred / 1e6:.1f} MB", flush=True)
    return values, times


async def main(args):
    dates = [(dt.date.fromisoformat(args.start) + dt.timedelta(days=i)).isoformat() for i in range(FORECAST_DAYS)]
    window_hours = range(HIKING_WINDOW["startHour"], HIKING_WINDOW["endHour"] + 1)
    instants_per_day = 25
    def day_targets(date):
        midnight = dt.datetime.fromisoformat(date).replace(tzinfo=JST)
        return np.array([(midnight + dt.timedelta(hours=h)).timestamp() for h in range(instants_per_day)])
    source = json.loads(args.summits.read_text())
    summits = [{"id": feature["properties"]["連番"], "height": feature["properties"]["標高値(m)"],
                "longitude": feature["geometry"]["coordinates"][0], "latitude": feature["geometry"]["coordinates"][1]} for feature in source["features"]]
    if not summits or len({s["id"] for s in summits}) != len(summits) or any(
        not isinstance(s["id"], int) or s["id"] < 0 or not all(np.isfinite(s[key]) for key in ["height", "latitude", "longitude"])
        or not NATIVE_GRID_BOUNDS["south"] <= s["latitude"] <= NATIVE_GRID_BOUNDS["north"]
        or not NATIVE_GRID_BOUNDS["west"] <= s["longitude"] <= NATIVE_GRID_BOUNDS["east"] for s in summits):
        raise ValueError("Invalid summit source")
    summit_lat = np.array([s["latitude"] for s in summits])
    summit_lon = np.array([s["longitude"] for s in summits])
    summit_height = np.array([s["height"] for s in summits])
    forecasts = {str(s["id"]): [None] * len(dates) for s in summits}
    ifs_summits = [None] * len(dates)
    ifs_support = [None] * len(dates)
    rows = japan_rows()
    native_rows = [{"latitude": r["latitude"], "west": r["west"], "step": (r["east"] - r["west"]) / (r["stop"] - r["start"] - 1), "count": r["stop"] - r["start"]} for r in rows]
    latitudes = np.concatenate([np.full(r["stop"] - r["start"], r["latitude"]) for r in rows])
    longitudes = np.concatenate([np.linspace(r["west"], r["east"], r["stop"] - r["start"]) for r in rows])
    result = np.empty((len(dates), len(latitudes), len(METRICS)), dtype="<f4")
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=32), timeout=aiohttp.ClientTimeout(total=120), auto_decompress=False) as session, AsyncExitStack() as cleanup:
        fs = MeasuredHTTP(session, 8192)
        terrain = await load_terrain(fs, "ecmwf_ifs", rows, args.cache)
        cells, cell_heights = summit_cells(native_rows, terrain, summit_lat, summit_lon, summit_height)
        runs = await available_runs(fs, dates)
        msm_runs = await jma_msm.available_runs(fs, dates, JST)
        surface_tiles = await prepare_terrain(session, args.cache.parent / "terrain")
        surface = TerrainSurface(surface_tiles, args.output / "surface", json.loads((args.output / "palette.json").read_text()))
        cleanup.callback(surface.close)
        for path in dict.fromkeys(run[0] for run in runs):
            indices = [i for i, run in enumerate(runs) if run[0] == path]
            _, meta, axis = runs[indices[0]]
            reference = dt.datetime.fromisoformat(meta["reference_time"].replace("Z", "+00:00")).timestamp()
            targets = np.concatenate([day_targets(dates[i]) for i in indices])
            fields = {}
            for name in FIELDS:
                values, times = await load_field(fs, path, meta, name, rows, targets.min() - 3600, targets.max(), args.cache / meta["reference_time"].replace(":", "") / args.start, args.seed_cache)
                mode = "maximum" if name == "wind_gusts_10m" else name in INTERVALS
                fields[name] = resample(values, times, targets, reference, mode, name in TOTALS, axis)
                if name not in {"temperature_2m", "dew_point_2m", "wind_u_component_10m", "wind_v_component_10m"}:
                    fields[name] = fields[name].clip(0)
            for position, index in enumerate(indices):
                section = slice(position * instants_per_day, (position + 1) * instants_per_day)
                hiking_section = slice(position * instants_per_day + window_hours.start, position * instants_per_day + window_hours.stop)
                window = {name: values[:, hiking_section] for name, values in fields.items()}
                result[index] = summarize(window, latitudes, longitudes, targets[hiking_section])
                if msm_runs[index] is None:
                    surface.write_day(dates[index], window, native_rows, terrain, targets[hiking_section], "ecmwf_ifs")
                else:
                    ifs_support[index] = {name: window[name].copy() for name in
                                          ["cape", "showers", "precipitation", "cloud_cover", "wind_gusts_10m", "visibility"]}
                point_fields = correct_elevation({name: values[cells, section] for name, values in fields.items()}, cell_heights, summit_height)
                ifs_summits[index] = point_fields
                daily = summit_forecasts(point_fields, summit_lat, summit_lon, targets[section], "ecmwf_ifs")
                for summit, value in zip(summits, daily, strict=True):
                    forecasts[str(summit["id"])][index] = value
        del fields, window
        msm_rows = jma_msm.japan_rows()
        msm_latitudes = np.repeat([r["latitude"] for r in msm_rows], [r["count"] for r in msm_rows])
        msm_longitudes = np.tile(msm_rows[0]["west"] + np.arange(msm_rows[0]["count"]) * msm_rows[0]["step"], len(msm_rows))
        support_cells = nearest_cells(native_rows, msm_latitudes, msm_longitudes)
        msm_terrain = await load_terrain(fs, "jma_msm", msm_rows, args.cache)
        msm_cells, msm_heights = summit_cells(msm_rows, msm_terrain, summit_lat, summit_lon, summit_height)
        msm_result = np.full((len(dates), len(msm_latitudes), len(METRICS)), np.nan, dtype="<f4")
        msm_result[:, :, METRICS.index("hours")] = 0
        for path in dict.fromkeys(run[0] for run in msm_runs if run):
            indices = [i for i, run in enumerate(msm_runs) if run and run[0] == path]
            all_targets = np.concatenate([day_targets(dates[i]) for i in indices])
            run = msm_runs[indices[0]]
            # Interval fields start one hour after initialization. Uncovered daily
            # boundary hours retain IFS; the complete hiking window must be MSM.
            covered = (all_targets >= run[2][0] + 3600) & (all_targets <= run[2][-1])
            targets = all_targets[covered]
            fields = await jma_msm.load_fields(fs, run, msm_rows, targets, args.cache)
            for position, index in enumerate(indices):
                section = slice(position * instants_per_day, (position + 1) * instants_per_day)
                daily_targets = all_targets[section]
                hiking_targets = daily_targets[window_hours.start:window_hours.stop]
                positions = np.searchsorted(targets, hiking_targets)
                if np.any(positions >= len(targets)) or not np.array_equal(targets[positions], hiking_targets):
                    raise ValueError("Incomplete MSM hiking window")
                msm_result[index] = summarize_msm({name: values[:, positions] for name, values in fields.items()}, result[index, support_cells], msm_latitudes, msm_longitudes, hiking_targets)
                surface.write_day(dates[index], {name: values[:, positions] for name, values in fields.items()},
                                  msm_rows, msm_terrain, hiking_targets, "jma_msm", (ifs_support[index], native_rows, terrain))
                ifs_support[index] = None
                daily_covered = covered[section]
                point_positions = np.searchsorted(targets, daily_targets[daily_covered])
                local = correct_elevation({name: values[msm_cells][:, point_positions] for name, values in fields.items()}, msm_heights, summit_height)
                local = derive_msm_fields(local)
                base = ifs_summits[index]
                thunder = thunder_probability(base["cape"], base["showers"], base["precipitation"], base["cloud_cover"], base["wind_gusts_10m"], summit_lat)
                mixed = {name: values.copy() for name, values in base.items() if name not in {"cape", "showers"}}
                for name, values in local.items():
                    if name in mixed:
                        mixed[name][:, daily_covered] = values
                daily = summit_forecasts(mixed, summit_lat, summit_lon, daily_targets, "jma_msm", thunder, not daily_covered.all())
                for summit, value in zip(summits, daily, strict=True):
                    forecasts[str(summit["id"])][index] = value
        surface_metadata = surface.finish(dates)
        args.output.mkdir(parents=True, exist_ok=True)
        result.tofile(args.output / "metrics.bin")
        msm_result.tofile(args.output / "msm-metrics.bin")
        (args.output / "forecasts.json").write_text(json.dumps(forecasts, allow_nan=False) + "\n")
        manifest = {"version": NATIVE_METRICS["version"], "dates": dates, "modelRuns": [run[1]["reference_time"] for run in runs], "fields": METRICS,
                    "surface": surface_metadata,
                    "rows": native_rows, "pointCount": len(latitudes), "downloadBytes": fs.transferred + fs.metadata_bytes,
                    "msm": {"version": NATIVE_METRICS["version"], "dates": dates, "fields": METRICS,
                            "modelRuns": [run[1]["reference_time"] if run else None for run in msm_runs],
                            "rows": [{key: value for key, value in row.items() if key != "y"} for row in msm_rows], "pointCount": len(msm_latitudes)}}
        (args.output / "manifest.json").write_text(json.dumps(manifest) + "\n")
        print(f"Prepared {len(latitudes):,} IFS cells × {len(dates)} days, {len(msm_latitudes):,} MSM cells × {sum(run is not None for run in msm_runs)} days and {len(summits):,} summit forecasts; downloaded {manifest['downloadBytes'] / 1e6:.2f} MB. No point-API requests.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--cache", type=pathlib.Path, default=pathlib.Path(".cache/ecmwf"))
    parser.add_argument("--seed-cache", type=pathlib.Path)
    parser.add_argument("--summits", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1] / "src/data/gsi-mountains.json")
    asyncio.run(main(parser.parse_args()))
