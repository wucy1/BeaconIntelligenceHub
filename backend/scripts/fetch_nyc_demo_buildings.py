"""Fetch Lower Manhattan building footprints from OSM Overpass for demo import."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "nyc_lower_manhattan_buildings.geojson"

QUERY = """
[out:json][timeout:90];
(
  way["building"](40.704,-74.018,40.712,-74.004);
);
out geom 200;
""".strip()

UA = "BeaconIntelligenceHub/1.0 (demo building import; contact: ops@example.com)"


def _way_to_feature(way: dict) -> dict | None:
    geom_nodes = way.get("geometry")
    if not geom_nodes or len(geom_nodes) < 4:
        return None
    ring = [[n["lon"], n["lat"]] for n in geom_nodes]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    tags = way.get("tags") or {}
    hn = tags.get("addr:housenumber")
    st = tags.get("addr:street")
    if hn and st:
        name = f"{hn} {st}"
    else:
        name = tags.get("name")
    external_ref = f"osm-way-{way['id']}"
    return {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [ring]},
        "properties": {
            "external_ref": external_ref,
            "name": name or f"OSM {way['id']}",
        },
    }


def main() -> None:
    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(QUERY)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    features = []
    for el in data.get("elements", []):
        if el.get("type") != "way":
            continue
        feat = _way_to_feature(el)
        if feat:
            features.append(feat)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Wrote {len(features)} features to {OUT}")


if __name__ == "__main__":
    main()
