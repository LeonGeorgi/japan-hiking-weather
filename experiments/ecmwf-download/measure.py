# /// script
# requires-python = ">=3.13"
# dependencies = ["omfiles==1.2.0", "aiohttp==3.14.5", "numpy==2.5.5"]
# ///
"""Measure actual unsigned S3 range downloads for a native IFS Japan subset.

uv run experiments/ecmwf-download/measure.py --output /tmp/ecmwf-japan
Downloaded arrays stay in --output; this does not change the app's forecast.
"""

import argparse
import asyncio
import datetime as dt
import importlib.metadata
import json
import pathlib
import time
import sys

import aiohttp
import numpy as np
from omfiles import OmFileReaderAsync

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))
from ecmwf_source import BASE, MeasuredHTTP, japan_rows
VARIABLES = [
    "temperature_2m", "dew_point_2m", "wind_u_component_10m",
    "wind_v_component_10m", "wind_gusts_10m", "precipitation",
    "snowfall_water_equivalent", "visibility", "cloud_cover", "cape",
    "showers", "shortwave_radiation",
]
JST = dt.timezone(dt.timedelta(hours=9))


async def measure_file(fs, path, rows, output, start=None, end=None):
    before, request_count, tick = fs.transferred, len(fs.requests), time.monotonic()
    fs.blocks = {}
    reader = await OmFileReaderAsync.from_fsspec(fs, path)
    assert reader.shape[:2] == (1, 6599680), reader.shape
    shape, chunks = reader.shape, reader.chunks
    times = None
    unit = None
    if start is not None:
        unit_reader = await reader.get_child_by_name("unit")
        unit = unit_reader.read_scalar()
        # Interval variables omit the initial instant. Use each file's own axis.
        time_reader = await reader.get_child_by_name("time")
        times = await time_reader.read_array((slice(None),))
        assert len(times) == shape[2] and np.all(np.diff(times) > 0)
        first = np.flatnonzero(times <= start.timestamp())[-1]
        last = np.flatnonzero(times >= end.timestamp())[0]
        times = times[first:last + 1]
        time_slice = slice(int(first), int(last) + 1)

    def selection(row):
        spatial = (slice(0, 1), slice(row["start"], row["stop"]))
        return spatial if times is None else (*spatial, time_slice)

    arrays = []
    for batch in range(0, len(rows), 8):
        arrays.extend(await asyncio.gather(*(
            reader.read_array(selection(row)) for row in rows[batch:batch + 8]
        )))
    count = sum(row["stop"] - row["start"] for row in rows)
    width = 1 if times is None else len(times)
    values = np.concatenate([array.reshape(-1, width) for array in arrays])
    assert values.shape == (count, width)
    assert np.isfinite(values).all(), f"Missing/nonfinite values in {path}"
    np.savez_compressed(output, values=values, times=np.array([]) if times is None else times)

    warm_before = fs.transferred
    for batch in range(0, len(rows), 8):
        reread = await asyncio.gather(*(
            reader.read_array(selection(row)) for row in rows[batch:batch + 8]
        ))
        for original, cached in zip(arrays[batch:batch + 8], reread, strict=True):
            assert np.array_equal(original, cached)
    assert fs.transferred == warm_before, "Unexpected transfer during cached reread"
    reader.close()
    return {
        "name": pathlib.PurePosixPath(path).stem, "url": path, "unit": unit,
        "download_bytes": fs.transferred - before,
        "range_requests": len(fs.requests) - request_count,
        "remote_file_bytes": fs.sizes[path], "shape": shape, "chunk_shape": chunks,
        "selected_native_timesteps": width,
        "returned_float32_bytes": values.nbytes, "finite_values": values.size,
        "min": float(values.min()), "max": float(values.max()),
        "cached_reread_download_bytes": fs.transferred - warm_before,
        "local_npz_bytes": output.stat().st_size,
        "seconds": round(time.monotonic() - tick, 2),
    }


async def main(args):
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    rows = japan_rows()
    start = dt.datetime.fromisoformat(args.start).replace(tzinfo=JST)
    end = start + dt.timedelta(days=7)
    report = {
        "measured_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "model": "ecmwf_ifs", "grid": "O1280 native ~9km",
        "bbox": {"south": 24, "north": 46, "west": 122, "east": 147},
        "latitude_rows": len(rows),
        "grid_points": sum(row["stop"] - row["start"] for row in rows),
        "block_bytes": args.block_bytes,
        "period_start_jst": start.isoformat(),
        "period_end_jst_exclusive": end.isoformat(),
        "package_versions": {name: importlib.metadata.version(name)
                             for name in ["omfiles", "aiohttp", "numpy"]},
        "method": "Actual HTTP 206 response-body bytes with fresh cache for each file. "
                  "Includes compressed-chunk and read-block overfetch. Excludes HTTP/TLS "
                  "headers and tool installation. No API key or AWS account.",
        "variables": [],
    }
    tick = time.monotonic()
    async with aiohttp.ClientSession(
        connector=aiohttp.TCPConnector(limit=12),
        timeout=aiohttp.ClientTimeout(total=120), auto_decompress=False,
    ) as session:
        fs = MeasuredHTTP(session, args.block_bytes)
        prefix = BASE + f"data_run/ecmwf_ifs/{args.run}/"
        meta = await fs.json(prefix + "meta.json")
        assert "O1280" in meta["crs_wkt"]
        report["run"] = meta["reference_time"]
        for variable in VARIABLES:
            assert variable in meta["variables"]
            entry = await measure_file(
                fs, prefix + variable + ".om", rows,
                output / (variable + ".npz"), start, end,
            )
            report["variables"].append(entry)
            print(json.dumps(entry), flush=True)
            (output / "partial-report.json").write_text(json.dumps(report, indent=2) + "\n")
        report["static_elevation"] = await measure_file(
            fs, BASE + "data/ecmwf_ifs/static/HSURF.om", rows, output / "HSURF.npz",
        )
        report["forecast_download_bytes"] = sum(item["download_bytes"] for item in report["variables"])
        report["metadata_download_bytes"] = fs.metadata_bytes
        report["total_download_bytes"] = fs.transferred + fs.metadata_bytes
        report["range_requests"] = len(fs.requests)
        report["head_requests"] = fs.head_requests
        report["seconds"] = round(time.monotonic() - tick, 2)
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        (output / "requests.json").write_text(json.dumps(fs.requests, indent=2) + "\n")
        (output / "grid-rows.json").write_text(json.dumps(rows, indent=2) + "\n")
        print("TOTAL", report["total_download_bytes"], "bytes", report["seconds"], "seconds", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", default="2026/11/21/1200Z")
    parser.add_argument("--start", default="2026-11-22")
    parser.add_argument("--block-bytes", type=int, default=8192)
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path("/tmp/ecmwf-japan"))
    args = parser.parse_args()
    assert args.block_bytes > 0
    asyncio.run(main(args))
