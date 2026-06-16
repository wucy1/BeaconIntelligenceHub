from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Crisis
from app.org_settings import effective_capture_window, get_org_settings

_BBOX_INTERSECT = """
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
"""

_ZONE_INTERSECT_REPORT = """
(
  ST_Intersects(r.geom, z.geom)
  OR ST_Intersects(r.geom, ST_ShiftLongitude(z.geom))
)
"""

_ZONE_INTERSECT_BUILDING = """
(
  ST_Intersects(b.geom, z.geom)
  OR ST_Intersects(b.geom, ST_ShiftLongitude(z.geom))
)
"""

_ACTIVE_CRISIS_EXCLUSION = f"""
  AND NOT EXISTS (
    SELECT 1 FROM zones z
    JOIN crises c ON c.id = z.crisis_id
    WHERE c.archive_status = 'active'
      AND (
        (r.geom IS NOT NULL AND {_ZONE_INTERSECT_REPORT})
        OR (b.geom IS NOT NULL AND {_ZONE_INTERSECT_BUILDING})
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM report_crisis_links l
    JOIN crises c ON c.id = l.crisis_id
    WHERE l.report_id = r.id AND c.archive_status = 'active'
  )
"""


def report_ids_unspecified_in_bbox(
    db: Session,
    min_lng: float,
    min_lat: float,
    max_lng: float,
    max_lat: float,
    captured_from: datetime,
    captured_to: datetime,
    limit: int,
    reporter_hash: str | None = None,
) -> list[UUID]:
    hash_filter = "AND r.reporter_hash = :hash" if reporter_hash else ""
    params: dict = {
        "minx": min_lng,
        "miny": min_lat,
        "maxx": max_lng,
        "maxy": max_lat,
        "from": captured_from,
        "to": captured_to,
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
                WHERE r.captured_at_client >= :from
                  AND r.captured_at_client <= :to
                  {hash_filter}
                  {_BBOX_INTERSECT}
                  {_ACTIVE_CRISIS_EXCLUSION}
                ORDER BY r.captured_at_client DESC
                LIMIT :lim
                """
            ),
            params,
        ).scalars().all()
    )


def report_ids_active_crisis_in_bbox(
    db: Session,
    crisis_id: UUID,
    min_lng: float,
    min_lat: float,
    max_lng: float,
    max_lat: float,
    captured_from: datetime,
    captured_to: datetime,
    limit: int,
    reporter_hash: str | None = None,
) -> list[UUID]:
    hash_filter = "AND r.reporter_hash = :hash" if reporter_hash else ""
    params: dict = {
        "cid": str(crisis_id),
        "minx": min_lng,
        "miny": min_lat,
        "maxx": max_lng,
        "maxy": max_lat,
        "from": captured_from,
        "to": captured_to,
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
                WHERE r.captured_at_client >= :from
                  AND r.captured_at_client <= :to
                  {hash_filter}
                  {_BBOX_INTERSECT}
                  AND (
                    EXISTS (
                      SELECT 1 FROM zones z
                      WHERE z.crisis_id = CAST(:cid AS uuid)
                        AND (
                          (r.geom IS NOT NULL AND {_ZONE_INTERSECT_REPORT})
                          OR (b.geom IS NOT NULL AND {_ZONE_INTERSECT_BUILDING})
                        )
                    )
                    OR EXISTS (
                      SELECT 1 FROM buildings b2
                      WHERE b2.id = r.building_id
                        AND b2.crisis_id = CAST(:cid AS uuid)
                    )
                    OR (
                      NOT EXISTS (SELECT 1 FROM zones z WHERE z.crisis_id = CAST(:cid AS uuid))
                      AND (
                        r.crisis_id = CAST(:cid AS uuid)
                        OR EXISTS (
                          SELECT 1 FROM report_crisis_links l
                          WHERE l.report_id = r.id AND l.crisis_id = CAST(:cid AS uuid)
                        )
                      )
                    )
                  )
                ORDER BY r.captured_at_client DESC
                LIMIT :lim
                """
            ),
            params,
        ).scalars().all()
    )


def _public_capture_window(db: Session, crisis) -> tuple[datetime, datetime]:
    org = get_org_settings(db)
    return effective_capture_window(
        months=org.default_public_report_months,
        event_start=crisis.archive_window_start,
        event_end=crisis.archive_window_end,
    )


def report_ids_all_public_in_bbox(
    db: Session,
    min_lng: float,
    min_lat: float,
    max_lng: float,
    max_lat: float,
    limit: int,
    reporter_hash: str | None = None,
) -> list[UUID]:
    org = get_org_settings(db)
    now = datetime.now(timezone.utc)
    captured_from, captured_to = effective_capture_window(
        months=org.default_public_report_months,
        event_start=None,
        event_end=None,
        now=now,
    )
    unspecified = report_ids_unspecified_in_bbox(
        db,
        min_lng,
        min_lat,
        max_lng,
        max_lat,
        captured_from,
        captured_to,
        limit,
        reporter_hash=reporter_hash,
    )
    seen = set(unspecified)
    merged = list(unspecified)
    active_rows = db.execute(
        text(
            """
            SELECT id FROM crises
            WHERE archive_status = 'active' AND slug != 'unspecified'
            ORDER BY created_at DESC
            """
        )
    ).scalars().all()
    for cid in active_rows:
        if len(merged) >= limit:
            break
        crisis = db.get(Crisis, cid)
        if not crisis:
            continue
        win_from, win_to = _public_capture_window(db, crisis)
        for rid in report_ids_active_crisis_in_bbox(
            db,
            cid,
            min_lng,
            min_lat,
            max_lng,
            max_lat,
            win_from,
            win_to,
            limit - len(merged),
            reporter_hash=reporter_hash,
        ):
            if rid in seen:
                continue
            seen.add(rid)
            merged.append(rid)
            if len(merged) >= limit:
                break
    return merged[:limit]
