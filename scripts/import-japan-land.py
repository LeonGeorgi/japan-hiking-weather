# /// script
# requires-python = ">=3.13"
# dependencies = ["shapely==2.2.0", "pyproj==3.7.2"]
# ///
"""Prepare geoBoundaries' MLIT-derived Japan polygons as a local land mask."""

import argparse
import hashlib
import json
from pathlib import Path

from pyproj import Transformer
from shapely import get_num_coordinates, make_valid, set_precision, transform
from shapely.geometry import MultiPolygon, Point, Polygon, mapping, shape


def polygons(geometry):
    if isinstance(geometry, Polygon):
        return [geometry] if not geometry.is_empty else []
    return [polygon for part in getattr(geometry, "geoms", []) for polygon in polygons(part)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    source = parser.parse_args().source
    document = json.loads(source.read_text())
    if len(document["features"]) != 1 or document["features"][0]["properties"]["shapeISO"] != "JPN":
        raise ValueError("Expected the Japan ADM0 feature")
    original = shape(document["features"][0]["geometry"])
    geometry = make_valid(original)
    to_mercator = Transformer.from_crs(4326, 3857, always_xy=True).transform
    to_wgs84 = Transformer.from_crs(3857, 4326, always_xy=True).transform
    projected = transform(geometry, to_mercator, interleaved=False)
    # Preserve even the smallest source islands and interior rings.
    simplified = projected.simplify(10, preserve_topology=True)
    result = set_precision(transform(simplified, to_wgs84, interleaved=False), grid_size=0.0000001)
    result = MultiPolygon(polygons(result))
    if result.is_empty or not result.is_valid or len(result.geoms) != len(polygons(geometry)):
        raise ValueError("Land mask lost source polygons or became invalid")

    checks = {
        "Tokyo": (139.75, 35.68, True), "Sapporo": (141.35, 43.06, True),
        "Shikoku": (133.115, 33.767, True), "Kyushu": (131.104, 32.884, True),
        "Okinawa": (127.68, 26.21, True), "Ishigaki": (124.16, 24.34, True),
        "Sado": (138.37, 38.03, True), "Izu Oshima": (139.39, 34.75, True),
        "Hachijo": (139.79, 33.11, True), "Chichijima": (142.20, 27.07, True),
        "Pacific": (141, 34, False), "Sea of Japan": (136, 39, False),
        "Tokyo Bay": (139.85, 35.45, False), "Osaka Bay": (135.2, 34.55, False),
        "Korea": (127, 37, False), "Taiwan": (121, 24, False),
    }
    for name, (longitude, latitude, expected) in checks.items():
        if result.covers(Point(longitude, latitude)) != expected:
            raise ValueError(f"Unexpected land-mask coverage: {name}")
    target = Path(__file__).resolve().parents[1] / "src/data/japan-land.json"
    target.write_text(json.dumps(mapping(result), separators=(",", ":")) + "\n")
    print(f"Wrote {len(result.geoms)} polygons, {get_num_coordinates(result)} vertices, {target.stat().st_size} bytes")
    print(f"Source SHA-256: {hashlib.sha256(source.read_bytes()).hexdigest()}")
    print(f"Verified {len(checks)} land, island, sea, and foreign-country locations.")


if __name__ == "__main__":
    main()
