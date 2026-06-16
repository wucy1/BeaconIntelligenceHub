from __future__ import annotations

from typing import Any


def normalize_lng(lng: float) -> float:
    """WGS84 longitude in [-180, 180] (Leaflet world-copy safe)."""
    x = float(lng)
    while x > 180:
        x -= 360
    while x < -180:
        x += 360
    return x


def normalize_polygon_geojson(geojson: dict[str, Any] | None) -> dict[str, Any] | None:
    if not geojson or geojson.get("type") != "Polygon":
        return geojson
    coords = geojson.get("coordinates")
    if not isinstance(coords, list):
        return geojson
    new_coords: list[Any] = []
    for ring in coords:
        if not isinstance(ring, list):
            new_coords.append(ring)
            continue
        new_ring: list[Any] = []
        for pt in ring:
            if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                new_ring.append(pt)
                continue
            lng, lat = float(pt[0]), float(pt[1])
            new_ring.append([normalize_lng(lng), lat])
        new_coords.append(new_ring)
    return {"type": "Polygon", "coordinates": new_coords}
