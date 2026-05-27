from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.image_urls import thumb_url_for_report
from app.models import Crisis, Report, ReportImage
from app.duplicate import find_possible_duplicate
from app.reporter import device_id_header, reporter_hash_from_device
from app.schemas import MyContributionOut
from app.validation import site_status_from_appendix

router = APIRouter(prefix="/v1/public", tags=["public"])


def _active_crisis(db: Session) -> Crisis:
    if settings.active_crisis_id:
        c = db.query(Crisis).filter(Crisis.id == UUID(settings.active_crisis_id)).first()
        if c:
            return c
    c = db.query(Crisis).order_by(Crisis.created_at.desc()).first()
    if not c:
        raise HTTPException(status_code=503, detail="No active reporting window configured")
    return c


@router.get("/active-window")
def active_window(db: Session = Depends(get_db)) -> dict:
    c = _active_crisis(db)
    bounds = db.execute(
        text(
            """
            SELECT CASE WHEN bounds IS NULL THEN NULL ELSE ST_AsGeoJSON(bounds)::json END
            FROM crises WHERE id = :id
            """
        ),
        {"id": c.id},
    ).scalar_one()
    now = datetime.now(timezone.utc)
    has_bounds = bounds is not None
    return {
        "window_id": str(c.id),
        "crisis_id": str(c.id),
        "slug": c.slug,
        "name": c.name,
        # bounds 僅供管理員事後劃定參考；不限制 Contributor 回報位置
        "bounds": bounds,
        "bounds_role": "optional_reference" if has_bounds else None,
        "reporting_unbounded": True,
        # unspecified：管理員尚未劃定範圍；defined：已有參考 AOI（顯示可調整，提交仍不限 bounds）
        "reporting_phase": "defined" if has_bounds else "unspecified",
        "starts_at": None,
        "ends_at": None,
        "is_open": True,
        "server_time": now.isoformat(),
    }


def _parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(status_code=422, detail="bbox must be minLng,minLat,maxLng,maxLat")
    return tuple(map(float, parts))  # type: ignore[return-value]


def _report_ids_in_bbox(
    db: Session,
    crisis_id: UUID,
    min_lng: float,
    min_lat: float,
    max_lng: float,
    max_lat: float,
    limit: int,
    reporter_hash: str | None = None,
) -> list[UUID]:
    """Reports visible in map viewport: point geom or building footprint intersects bbox."""
    hash_filter = "AND r.reporter_hash = :hash" if reporter_hash else ""
    params: dict = {
        "cid": str(crisis_id),
        "minx": min_lng,
        "miny": min_lat,
        "maxx": max_lng,
        "maxy": max_lat,
        "lim": limit,
    }
    if reporter_hash:
        params["hash"] = reporter_hash
    return list(
        db.execute(
            text(
                f"""
                SELECT r.id FROM reports r
                LEFT JOIN buildings b ON b.id = r.building_id
                WHERE r.crisis_id = CAST(:cid AS uuid)
                  {hash_filter}
                  AND (
                    (r.geom IS NOT NULL AND ST_Intersects(
                      r.geom,
                      ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326)
                    ))
                    OR (b.geom IS NOT NULL AND ST_Intersects(
                      b.geom,
                      ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326)
                    ))
                  )
                ORDER BY r.captured_at_client DESC
                LIMIT :lim
                """
            ),
            params,
        ).scalars().all()
    )


def _report_point_geojson(db: Session, report_id: UUID, building_id: UUID | None):
    gj = db.execute(
        text("SELECT ST_AsGeoJSON(geom)::json FROM reports WHERE id = :id AND geom IS NOT NULL"),
        {"id": report_id},
    ).scalar_one_or_none()
    if gj:
        return gj
    if building_id:
        return db.execute(
            text(
                "SELECT ST_AsGeoJSON(ST_Centroid(geom))::json FROM buildings WHERE id = :bid"
            ),
            {"bid": building_id},
        ).scalar_one_or_none()
    return None


@router.get("/my-contribution", response_model=MyContributionOut)
def my_contribution(
    db: Session = Depends(get_db),
    x_device_id: str | None = Header(None, alias="X-Device-Id"),
) -> MyContributionOut:
    crisis = _active_crisis(db)
    did = device_id_header(x_device_id)
    if not did:
        return MyContributionOut(
            crisis_id=crisis.id,
            report_count=0,
            distinct_locations=0,
            possible_duplicate_recent=0,
        )
    reporter_hash = reporter_hash_from_device(did)
    rows = (
        db.query(Report)
        .filter(Report.crisis_id == crisis.id, Report.reporter_hash == reporter_hash)
        .all()
    )
    locations: set[str] = set()
    dup_recent = 0
    for r in rows:
        if r.building_id:
            locations.add(f"b:{r.building_id}")
        elif r.geom is not None:
            pt = db.execute(
                text("SELECT ST_X(geom), ST_Y(geom) FROM reports WHERE id = :id"),
                {"id": r.id},
            ).one()
            locations.add(f"p:{round(pt[0], 5)},{round(pt[1], 5)}")
        if find_possible_duplicate(
            db,
            crisis_id=crisis.id,
            building_id=r.building_id,
            reporter_hash=reporter_hash,
            before=r.received_at_server,
        ):
            dup_recent += 1
    return MyContributionOut(
        crisis_id=crisis.id,
        report_count=len(rows),
        distinct_locations=len(locations),
        possible_duplicate_recent=dup_recent,
    )


@router.get("/markers")
def public_markers(
    bbox: str = Query(..., description="minLng,minLat,maxLng,maxLat"),
    mode: str = Query("all", pattern="^(all|mine|new)$"),
    limit: int = Query(200, ge=1, le=500),
    x_device_id: str | None = Header(None, alias="X-Device-Id"),
    db: Session = Depends(get_db),
) -> dict:
    if mode == "new":
        return {"items": []}

    min_lng, min_lat, max_lng, max_lat = _parse_bbox(bbox)

    crisis = _active_crisis(db)
    reporter_hash = None
    did = device_id_header(x_device_id)
    if did:
        reporter_hash = reporter_hash_from_device(did)

    if mode == "mine":
        if not reporter_hash:
            return {"items": []}
        ids = _report_ids_in_bbox(
            db,
            crisis.id,
            min_lng,
            min_lat,
            max_lng,
            max_lat,
            limit,
            reporter_hash=reporter_hash,
        )
    else:
        ids = _report_ids_in_bbox(
            db, crisis.id, min_lng, min_lat, max_lng, max_lat, limit
        )

    rows = db.query(Report).filter(Report.id.in_(list(ids))).all() if ids else []
    if rows and ids:
        order = {rid: i for i, rid in enumerate(ids)}
        rows.sort(key=lambda r: order.get(r.id, 9999))

    items = []
    for r in rows:
        gj = _report_point_geojson(db, r.id, r.building_id)
        if not gj:
            continue
        is_mine = bool(reporter_hash and r.reporter_hash == reporter_hash)
        items.append(
            {
                "id": str(r.id),
                "damage_level": r.damage_level,
                "site_status": site_status_from_appendix(r.appendix_answers),
                "captured_at_client": r.captured_at_client.isoformat(),
                "building_id": str(r.building_id) if r.building_id else None,
                "geom": gj,
                "is_mine": is_mine,
                "thumb_url": thumb_url_for_report(db, r.id),
            }
        )
    return {"items": items, "crisis_id": str(crisis.id)}
