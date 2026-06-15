from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID

from geoalchemy2.shape import from_shape
from shapely.geometry import MultiPolygon, shape
from sqlalchemy.orm import Session

from app.models import Building

DEMO_GEOJSON_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "nyc_lower_manhattan_buildings.geojson"
)
DEMO_SOURCE_ID = "nyc_lower_manhattan_osm"
EXAMPLE_GEOJSON_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "building_footprints.example.geojson"
)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_FEATURES_PER_IMPORT = 10_000


def _as_multipolygon(geom: Any):
    shp = shape(geom)
    if shp.is_empty:
        raise ValueError("Empty geometry")
    if shp.geom_type == "Polygon":
        return MultiPolygon([shp])
    if shp.geom_type == "MultiPolygon":
        return shp
    raise ValueError(f"Unsupported geometry type: {shp.geom_type}")


def load_demo_geojson() -> dict[str, Any]:
    if not DEMO_GEOJSON_PATH.is_file():
        raise FileNotFoundError(
            f"Demo building footprints missing at {DEMO_GEOJSON_PATH}. "
            "Run backend/scripts/fetch_nyc_demo_buildings.py to generate it."
        )
    return json.loads(DEMO_GEOJSON_PATH.read_text(encoding="utf-8"))


def load_example_geojson() -> dict[str, Any]:
    if not EXAMPLE_GEOJSON_PATH.is_file():
        raise FileNotFoundError(f"Example GeoJSON missing at {EXAMPLE_GEOJSON_PATH}")
    return json.loads(EXAMPLE_GEOJSON_PATH.read_text(encoding="utf-8"))


def parse_uploaded_geojson(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError(f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid UTF-8 JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("Root must be a JSON object")
    if data.get("type") != "FeatureCollection":
        raise ValueError("Root type must be FeatureCollection")
    features = data.get("features")
    if not isinstance(features, list):
        raise ValueError("features must be an array")
    if len(features) > MAX_FEATURES_PER_IMPORT:
        raise ValueError(f"Too many features (max {MAX_FEATURES_PER_IMPORT})")
    return data


def import_buildings_from_bytes(
    db: Session,
    crisis_id: UUID,
    raw: bytes,
    *,
    replace: bool = False,
    source: str = "upload",
) -> dict[str, Any]:
    geojson = parse_uploaded_geojson(raw)
    imported = import_buildings_geojson(db, crisis_id, geojson, replace=replace)
    total = db.query(Building).filter(Building.crisis_id == crisis_id).count()
    return {
        "imported": imported,
        "total": total,
        "source": source,
        "replaced": replace,
    }


def import_buildings_geojson(
    db: Session,
    crisis_id: UUID,
    geojson: dict[str, Any],
    *,
    replace: bool = False,
) -> int:
    if replace:
        db.query(Building).filter(Building.crisis_id == crisis_id).delete(synchronize_session=False)

    imported = 0
    for feat in geojson.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        try:
            mp = _as_multipolygon(geom)
        except ValueError:
            continue
        props = feat.get("properties") or {}
        name = props.get("name")
        if isinstance(name, str):
            name = name.strip() or None
        external_ref = props.get("external_ref")
        if external_ref is not None:
            external_ref = str(external_ref)
        db.add(
            Building(
                crisis_id=crisis_id,
                geom=from_shape(mp, srid=4326),
                name=name,
                external_ref=external_ref,
            )
        )
        imported += 1
    return imported


def import_demo_buildings(db: Session, crisis_id: UUID, *, replace: bool = False) -> dict[str, Any]:
    geojson = load_demo_geojson()
    imported = import_buildings_geojson(db, crisis_id, geojson, replace=replace)
    total = (
        db.query(Building).filter(Building.crisis_id == crisis_id).count()
    )
    return {
        "imported": imported,
        "total": total,
        "source": DEMO_SOURCE_ID,
        "replaced": replace,
    }
