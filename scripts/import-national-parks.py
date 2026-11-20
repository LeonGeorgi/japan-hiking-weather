# /// script
# requires-python = ">=3.13"
# dependencies = ["shapely==2.2.0", "pyproj==3.7.2"]
# ///
"""Convert Biodic's NPS_all.kmz to dissolved park outlines for the web map."""

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from zipfile import ZipFile

from pyproj import Transformer
from shapely import get_num_coordinates, make_valid, set_precision, transform, union_all
from shapely.geometry import MultiPolygon, Polygon, mapping


KML_NAMESPACE = {"k": "http://www.opengis.net/kml/2.2"}
PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT = PROJECT_ROOT / "src/data/biodic-national-parks.geojson"
SIMPLIFICATION_METERS = 10


def read_ring(element):
    return [
        tuple(map(float, coordinate.split(",")[:2]))
        for coordinate in (element.text or "").split()
    ]


def polygon_parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry] if not geometry.is_empty else []
    return [
        polygon
        for part in getattr(geometry, "geoms", [])
        for polygon in polygon_parts(part)
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Downloaded Biodic NPS_all.kmz")
    source = parser.parse_args().source
    parks = defaultdict(list)
    source_polygons = 0
    repaired_polygons = 0

    with ZipFile(source) as archive, archive.open("doc.kml") as document:
        for _, placemark in ET.iterparse(document, events=("end",)):
            if placemark.tag != "{" + KML_NAMESPACE["k"] + "}Placemark":
                continue

            name = placemark.findtext("k:name", "", KML_NAMESPACE).strip()
            if not name:
                raise ValueError("A source placemark is missing its park name")

            for element in placemark.findall(".//k:Polygon", KML_NAMESPACE):
                outer = element.find(
                    "k:outerBoundaryIs/k:LinearRing/k:coordinates", KML_NAMESPACE
                )
                if outer is None:
                    raise ValueError(f"Missing outer ring for {name}")
                holes = element.findall(
                    "k:innerBoundaryIs/k:LinearRing/k:coordinates", KML_NAMESPACE
                )
                polygon = Polygon(read_ring(outer), [read_ring(hole) for hole in holes])
                source_polygons += 1
                if not polygon.is_valid:
                    polygon = make_valid(polygon)
                    repaired_polygons += 1
                parks[name].extend(polygon_parts(polygon))

            placemark.clear()

    to_mercator = Transformer.from_crs(4326, 3857, always_xy=True).transform
    to_wgs84 = Transformer.from_crs(3857, 4326, always_xy=True).transform
    features = []
    for name, polygons in sorted(parks.items()):
        # Dissolve zoning polygons before drawing, so internal zone edges disappear.
        merged = union_all(polygons, grid_size=0.000000001)
        projected = transform(merged, to_mercator, interleaved=False)
        simplified = projected.simplify(SIMPLIFICATION_METERS, preserve_topology=True)
        geometry = set_precision(
            transform(simplified, to_wgs84, interleaved=False), grid_size=0.0000001
        )
        geometry = MultiPolygon(polygon_parts(geometry))
        if geometry.is_empty or not geometry.is_valid:
            raise ValueError(f"Invalid output geometry for {name}")

        features.append({
            "type": "Feature",
            "properties": {"name": name},
            "geometry": mapping(geometry),
        })
        print(
            f"{name}: {len(polygons)} source polygons, "
            f"{get_num_coordinates(geometry)} output vertices",
            flush=True,
        )

    collection = {"type": "FeatureCollection", "features": features}
    OUTPUT.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Wrote {len(features)} parks from {source_polygons} polygons to {OUTPUT}")
    print(f"Repaired source polygons: {repaired_polygons}")
    with source.open("rb") as original:
        print(f"Source SHA-256: {hashlib.file_digest(original, 'sha256').hexdigest()}")


if __name__ == "__main__":
    main()
