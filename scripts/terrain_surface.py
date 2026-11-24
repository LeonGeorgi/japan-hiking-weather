"""GSI elevations and land-clipped, elevation-corrected weather image tiles."""

import asyncio
import hashlib
import io
import json
import pathlib
import struct
import subprocess
import uuid

import aiohttp
import numpy as np
from PIL import Image, ImageDraw

from weather_calculations import correct_elevation, derive_msm_fields, summit_cells, summarize, thunder_probability
from weather_config import NATIVE_GRID_BOUNDS, TERRAIN_SURFACE

ROOT = pathlib.Path(__file__).resolve().parents[1]
TILE_SIZE = 256


def world_pixels(longitude, latitude, zoom):
    scale = TILE_SIZE * 2 ** zoom
    return (np.asarray(longitude) + 180) / 360 * scale, (1 - np.arcsinh(np.tan(np.deg2rad(latitude))) / np.pi) / 2 * scale


def pixel_coordinates(x, y, indices, zoom):
    scale = TILE_SIZE * 2 ** zoom
    longitude = ((x * TILE_SIZE + indices % TILE_SIZE + .5) / scale) * 360 - 180
    latitude = np.rad2deg(np.arctan(np.sinh(np.pi * (1 - 2 * (y * TILE_SIZE + indices // TILE_SIZE + .5) / scale))))
    return latitude, longitude


def decode_elevation(body):
    image = Image.open(io.BytesIO(body)).convert("RGBA")
    if image.size != (TILE_SIZE, TILE_SIZE):
        raise ValueError("Invalid GSI elevation tile size")
    rgba = np.asarray(image).astype(np.int32)
    value = rgba[:, :, 0] * 65536 + rgba[:, :, 1] * 256 + rgba[:, :, 2]
    return np.where((value == 8388608) | (rgba[:, :, 3] == 0), np.nan,
                    np.where(value < 8388608, value, value - 16777216) * .01).astype(np.float32)


def land_tiles(land, zoom):
    """Group projected polygons by tile; retain islands and polygon holes."""
    bounds = NATIVE_GRID_BOUNDS
    left, bottom = world_pixels(bounds["west"], bounds["south"], zoom)
    right, top = world_pixels(bounds["east"], bounds["north"], zoom)
    tiles = {}
    for polygon in land["coordinates"]:
        rings = [np.column_stack(world_pixels(*np.asarray(ring).T, zoom)) for ring in polygon]
        low, high = rings[0].min(axis=0), rings[0].max(axis=0)
        for y in range(int(max(top, low[1]) // TILE_SIZE), int(min(bottom, high[1]) // TILE_SIZE) + 1):
            for x in range(int(max(left, low[0]) // TILE_SIZE), int(min(right, high[0]) // TILE_SIZE) + 1):
                tiles.setdefault((x, y), []).append(rings)
    return tiles


def land_alpha(polygons, x, y):
    # Supersampling retains small islands and softens only the coastline, not scores.
    mask = Image.new("L", (TILE_SIZE * 4, TILE_SIZE * 4))
    draw = ImageDraw.Draw(mask)
    for rings in polygons:
        for index, ring in enumerate(rings):
            points = ((ring - [x * TILE_SIZE, y * TILE_SIZE]) * 4).reshape(-1).tolist()
            draw.polygon(points, fill=255 if index == 0 else 0)
    return np.asarray(mask.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.BOX)).copy()


async def elevation_tile(session, cache, layer, zoom, x, y):
    path = cache / "gsi" / layer / str(zoom) / str(x) / f"{y}.png"
    missing = path.with_suffix(".missing")
    if path.exists():
        return decode_elevation(path.read_bytes())
    if missing.exists():
        return np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
    path.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://cyberjapandata.gsi.go.jp/xyz/{layer}/{zoom}/{x}/{y}.png"
    for attempt in range(4):
        try:
            async with session.get(url) as response:
                if response.status == 404:
                    missing.touch()
                    return np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
                response.raise_for_status()
                body = await response.read()
            heights = decode_elevation(body)
            temporary = path.with_suffix(".tmp")
            temporary.write_bytes(body)
            temporary.replace(path)
            return heights
        except (aiohttp.ClientError, asyncio.TimeoutError):
            if attempt == 3:
                raise
            await asyncio.sleep(2 ** attempt)


async def prepare_terrain(session, cache):
    source = (ROOT / "src/data/japan-land.json").read_bytes()
    zoom = TERRAIN_SURFACE["zoom"]
    fingerprint = hashlib.sha256(source + json.dumps(NATIVE_GRID_BOUNDS).encode()).hexdigest()[:12]
    directory = cache / f"v1-z{zoom}-{fingerprint}"
    directory.mkdir(parents=True, exist_ok=True)
    polygons = land_tiles(json.loads(source), zoom)
    semaphore = asyncio.Semaphore(8)
    downloads = {}

    async def fetch(layer, z, x, y):
        key = layer, z, x, y
        if key not in downloads:
            downloads[key] = asyncio.create_task(elevation_tile(session, cache, layer, z, x, y))
        return (await downloads[key]).copy()

    async def prepare(x, y, rings):
        path = directory / f"{x}-{y}.npz"
        async with semaphore:
            if not path.exists():
                alpha = land_alpha(rings, x, y)
                heights = await fetch("dem_png", zoom, x, y)
                absent = (alpha > 0) & ~np.isfinite(heights)
                if absent.any():
                    # DEM10B gaps fall back to GSI's coarser global elevation data.
                    parent = await fetch("demgm_png", zoom - 1, x // 2, y // 2)
                    parent = np.repeat(np.repeat(parent, 2, axis=0), 2, axis=1)
                    fallback = parent[(y % 2) * TILE_SIZE:(y % 2 + 1) * TILE_SIZE,
                                      (x % 2) * TILE_SIZE:(x % 2 + 1) * TILE_SIZE]
                    heights[absent] = fallback[absent]
                indices = np.flatnonzero((alpha > 0) & np.isfinite(heights))
                latitude, longitude = pixel_coordinates(x, y, indices, zoom)
                bounds = NATIVE_GRID_BOUNDS
                inside = ((latitude >= bounds["south"]) & (latitude <= bounds["north"])
                          & (longitude >= bounds["west"]) & (longitude <= bounds["east"]))
                indices = indices[inside]
                np.savez_compressed(path, indices=indices.astype(np.uint16), heights=heights.reshape(-1)[indices], alpha=alpha)
        return x, y, path

    tiles = await asyncio.gather(*(prepare(x, y, rings) for (x, y), rings in sorted(polygons.items())))
    print(f"Prepared {len(tiles)} cached GSI terrain tiles (about 250 m per pixel).", flush=True)
    return tiles


class TerrainSurface:
    def __init__(self, tiles, output, palette):
        self.tiles = tiles
        self.output = output
        self.palette = np.array(palette, dtype=np.uint8)
        self.process = subprocess.Popen(["node", str(ROOT / "scripts/score-weather.ts")], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.point_count = 0

    def close(self):
        if self.process.stdin.closed:
            return
        self.process.stdin.close()
        status = self.process.wait()
        self.process.stdout.close()
        if status != 0:
            raise RuntimeError("Terrain weather scoring failed")

    def write_day(self, date, fields, rows, terrain, targets, model, ifs_support=None):
        zoom = TERRAIN_SURFACE["zoom"]
        for x, y, path in self.tiles:
            with np.load(path) as tile:
                indices, height, alpha = tile["indices"], tile["heights"], tile["alpha"]
            if not len(indices):
                continue
            latitude, longitude = pixel_coordinates(x, y, indices.astype(np.int32), zoom)
            cells, model_height = summit_cells(rows, terrain, latitude, longitude, height)
            local = correct_elevation({name: values[cells] for name, values in fields.items()}, model_height, height)
            thunder = None
            if model == "jma_msm":
                local = derive_msm_fields(local)
                support_fields, support_rows, support_terrain = ifs_support
                support_cells, _ = summit_cells(support_rows, support_terrain, latitude, longitude, height)
                support = {name: values[support_cells] for name, values in support_fields.items()}
                local.update({name: support[name] for name in ["wind_gusts_10m", "visibility"]})
                thunder = thunder_probability(support["cape"], support["showers"], support["precipitation"],
                                              support["cloud_cover"], support["wind_gusts_10m"], latitude)
            metrics = summarize(local, latitude, longitude, targets, thunder)
            body = metrics.tobytes()
            self.process.stdin.write(struct.pack("<I", len(body)) + body)
            self.process.stdin.flush()
            scores = self.process.stdout.read(len(indices))
            if len(scores) != len(indices):
                raise RuntimeError("Incomplete terrain weather scores")
            values = np.full(TILE_SIZE * TILE_SIZE, 255, dtype=np.uint8)
            values[indices] = np.frombuffer(scores, dtype=np.uint8)
            rgba = self.palette[values].reshape(TILE_SIZE, TILE_SIZE, 4).copy()
            rgba[:, :, 3] = np.where(values.reshape(TILE_SIZE, TILE_SIZE) == 255, 0, alpha)
            target = self.output / date / str(zoom) / str(x) / f"{y}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba).save(target)
            self.point_count += len(indices)
        print(f"Rendered terrain weather for {date} ({model}).", flush=True)

    def finish(self, dates):
        self.close()
        zoom, minimum = TERRAIN_SURFACE["zoom"], TERRAIN_SURFACE["minZoom"]
        for date in dates:
            children = {(x, y) for x, y, _ in self.tiles if (self.output / date / str(zoom) / str(x) / f"{y}.png").exists()}
            for z in range(zoom - 1, minimum - 1, -1):
                parents = {(x // 2, y // 2) for x, y in children}
                for x, y in parents:
                    image = Image.new("RGBA", (TILE_SIZE * 2, TILE_SIZE * 2))
                    for dx in range(2):
                        for dy in range(2):
                            child = self.output / date / str(z + 1) / str(x * 2 + dx) / f"{y * 2 + dy}.png"
                            if child.exists():
                                with Image.open(child) as tile:
                                    image.paste(tile, (dx * TILE_SIZE, dy * TILE_SIZE))
                    target = self.output / date / str(z) / str(x) / f"{y}.png"
                    target.parent.mkdir(parents=True, exist_ok=True)
                    image.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.NEAREST).save(target)
                children = parents
        # Every day has the same footprint; absent-height tiles stay transparent.
        existing = {tuple(map(int, path.relative_to(self.output / dates[0]).with_suffix("").parts))
                    for path in (self.output / dates[0]).rglob("*.png")}
        print(f"Created {len(existing)} terrain image tiles per day; evaluated {self.point_count:,} land cells across {len(dates)} days.", flush=True)
        return {**TERRAIN_SURFACE, "path": f"surfaces/{uuid.uuid4().hex}",
                "tiles": [f"{z}/{x}/{y}" for z, x, y in sorted(existing)], "source": "gsi-dem"}
