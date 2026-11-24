"""Public model-file reads, static terrain and native IFS row coordinates."""

import asyncio
import json
import math

import aiohttp
import numpy as np
from omfiles import OmFileReader
from weather_config import NATIVE_GRID_BOUNDS

BASE = "https://openmeteo.s3.amazonaws.com/"


async def load_terrain(fs, model, rows, cache):
    directory = cache / "static"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{model}-HSURF.om"
    tag = path.with_suffix(".etag")
    url = BASE + f"data/{model}/static/HSURF.om"
    async with fs.session.head(url) as response:
        response.raise_for_status()
        etag = response.headers["ETag"]
    download = not path.exists() or not tag.exists() or tag.read_text() != etag
    source = path.with_suffix(".tmp") if download else path
    if download:
        async with fs.session.get(url) as response:
            response.raise_for_status()
            body = await response.read()
        source.write_bytes(body)
        fs.requests.append({"url": url, "start": 0, "end_exclusive": len(body), "status": 200, "bytes": len(body)})
    reader = OmFileReader(str(source))
    try:
        expected = (1, 6599680) if model == "ecmwf_ifs" else (505, 481)
        if reader.shape != expected:
            raise ValueError(f"Invalid {model} terrain shape")
        if model == "ecmwf_ifs":
            heights = np.concatenate([reader.read_array((slice(0, 1), slice(row["start"], row["stop"]))).reshape(-1) for row in rows])
        else:
            west = round((rows[0]["west"] - 120) / .0625)
            heights = reader.read_array((slice(rows[-1]["y"], rows[0]["y"] + 1), slice(west, west + rows[0]["count"])))[::-1].reshape(-1)
    finally:
        reader.close()
    if not np.isfinite(heights).all():
        raise ValueError(f"Missing {model} terrain")
    if download:
        source.replace(path)
        tag.write_text(etag)
    return heights

class MeasuredHTTP:
    """The OM reader's filesystem interface, with a bounded-block read cache.

    Count response bodies after reading them, including failed HTTP responses.
    Require HTTP 206 so an ignored Range can never silently fetch a global file.
    Cache only within one file; a new model run starts with a cold cache.
    """

    def __init__(self, session, block_bytes):
        self.session = session
        self.block_bytes = block_bytes
        self.sizes = {}
        self.blocks = {}
        self.requests = []
        self.head_requests = 0
        self.metadata_bytes = 0

    async def _size(self, path):
        if path not in self.sizes:
            async with self.session.head(path) as response:
                response.raise_for_status()
                self.sizes[path] = int(response.headers["Content-Length"])
                self.head_requests += 1
        return self.sizes[path]

    async def json(self, path):
        async with self.session.get(path) as response:
            response.raise_for_status()
            body = await response.read()
            self.metadata_bytes += len(body)
            return json.loads(body)

    async def fetch_block(self, path, block):
        size = await self._size(path)
        start = block * self.block_bytes
        end = min(size, start + self.block_bytes)
        for attempt in range(4):
            try:
                async with self.session.get(
                    path, headers={"Range": f"bytes={start}-{end - 1}"}
                ) as response:
                    if response.status == 200:
                        raise RuntimeError("Server ignored Range; refusing global download")
                    body = await response.read()
                    self.requests.append({
                        "url": path, "start": start, "end_exclusive": end,
                        "status": response.status, "bytes": len(body),
                    })
                    response.raise_for_status()
                    if response.status != 206 or len(body) != end - start:
                        raise RuntimeError("Incorrect HTTP range response")
                    return body
            except (aiohttp.ClientError, asyncio.TimeoutError):
                if attempt == 3:
                    raise
                await asyncio.sleep(2 ** attempt)

    async def _cat_file(self, path, start=None, end=None):
        size = await self._size(path)
        start = 0 if start is None else start
        end = size if end is None else end
        if start < 0:
            start += size
        if end < 0:
            end += size
        assert 0 <= start <= end <= size
        if start == end:
            return b""
        tasks = []
        for block in range(start // self.block_bytes, (end - 1) // self.block_bytes + 1):
            key = (path, block)
            if key not in self.blocks:
                self.blocks[key] = asyncio.create_task(self.fetch_block(path, block))
            tasks.append(self.blocks[key])
        body = b"".join(await asyncio.gather(*tasks))
        offset = start % self.block_bytes
        return body[offset:offset + end - start]

    @property
    def transferred(self):
        return sum(request["bytes"] for request in self.requests)


def japan_rows():
    """O1280 equations from Open-Meteo's GaussianGrid.swift, northern hemisphere.

    Select every native cell in the configured Japan rectangle, including sea.
    No decimation, no regular-grid interpolation, no Japan land mask.
    """
    rows = []
    dy = 180 / (2 * 1280 + 0.5)
    for y in range(1280):
        latitude = (1280 - y - 1) * dy + dy / 2
        if not NATIVE_GRID_BOUNDS["south"] <= latitude <= NATIVE_GRID_BOUNDS["north"]:
            continue
        nx = 20 + 4 * y
        west = math.ceil(NATIVE_GRID_BOUNDS["west"] * nx / 360)
        east = math.floor(NATIVE_GRID_BOUNDS["east"] * nx / 360) + 1
        origin = 2 * y * y + 18 * y
        rows.append({
            "row": y, "latitude": latitude,
            "start": origin + west, "stop": origin + east,
            "west": west * 360 / nx, "east": (east - 1) * 360 / nx,
        })
    return rows
