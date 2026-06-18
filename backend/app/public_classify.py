from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Crisis
from app.org_settings import effective_capture_window, get_org_settings

logger = logging.getLogger(__name__)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _capture_in_crisis_window(
    captured_at: datetime,
    event_start: datetime | None,
    event_end: datetime | None,
    public_months: int,
) -> bool:
    """Match org_settings.effective_capture_window (same as ops map browse)."""
    at = _as_utc(captured_at)
    start, end = effective_capture_window(
        months=public_months,
        event_start=event_start,
        event_end=event_end,
        now=at,
    )
    return _as_utc(start) <= at <= _as_utc(end)


def _ensure_auto_classify_link_source(db: Session) -> None:
    """Apply migration 013 when production DB still has the old link_source CHECK."""
    row = db.execute(
        text(
            """
            SELECT pg_get_constraintdef(c.oid) AS def
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = 'report_crisis_links'
              AND c.conname = 'report_crisis_links_link_source_check'
            """
        )
    ).mappings().first()
    if row and row.get("def") and "auto_classify" in str(row["def"]):
        return
    db.execute(
        text(
            "ALTER TABLE report_crisis_links DROP CONSTRAINT IF EXISTS report_crisis_links_link_source_check"
        )
    )
    db.execute(
        text(
            """
            ALTER TABLE report_crisis_links ADD CONSTRAINT report_crisis_links_link_source_check
              CHECK (link_source IN ('batch_archive', 'manual', 'primary', 'auto_classify'))
            """
        )
    )
    db.flush()


def get_unspecified_crisis(db: Session) -> Crisis:
    c = db.query(Crisis).filter(Crisis.slug == "unspecified").first()
    if not c:
        raise RuntimeError("System unspecified crisis is missing")
    return c


def _report_geom(geom_geojson: dict | None):
    if not geom_geojson:
        return None
    try:
        g = shape(geom_geojson)
        if g.geom_type == "Point":
            return from_shape(g, srid=4326)
    except Exception:
        return None
    return None


def resolve_active_crisis_for_report(
    db: Session,
    *,
    geom_geojson: dict | None,
    building_id: UUID | None,
    captured_at: datetime,
) -> Crisis | None:
    """Match active crisis by time window and zone scope (newest crisis first).

    Zone scope mirrors batch archive: report GPS point, building footprint, or
    building crisis assignment when footprints exist; GPS-only when they do not.
    """
    org = get_org_settings(db)
    report_geom = _report_geom(geom_geojson)
    if report_geom is None and building_id is None:
        return None

    match_parts: list[str] = []
    params: dict = {}
    if report_geom is not None:
        params["pt"] = report_geom
        match_parts.append(
            """
            EXISTS (
              SELECT 1 FROM zones z
              WHERE z.crisis_id = c.id
                AND (
                  ST_Intersects(:pt, z.geom)
                  OR ST_Intersects(:pt, ST_ShiftLongitude(z.geom))
                )
            )
            """
        )
    if building_id is not None:
        params["bid"] = str(building_id)
        match_parts.append(
            """
            EXISTS (
              SELECT 1 FROM zones z
              JOIN buildings b ON b.id = CAST(:bid AS uuid)
              WHERE z.crisis_id = c.id
                AND b.geom IS NOT NULL
                AND (
                  ST_Intersects(b.geom, z.geom)
                  OR ST_Intersects(b.geom, ST_ShiftLongitude(z.geom))
                )
            )
            """
        )
        match_parts.append(
            """
            EXISTS (
              SELECT 1 FROM buildings b
              WHERE b.id = CAST(:bid AS uuid)
                AND b.crisis_id = c.id
            )
            """
        )

    scope_sql = " OR ".join(match_parts)
    rows = db.execute(
        text(
            f"""
            SELECT c.id, c.archive_window_start, c.archive_window_end
            FROM crises c
            WHERE c.archive_status = 'active' AND c.slug <> 'unspecified'
              AND ({scope_sql})
            ORDER BY c.created_at DESC
            """
        ),
        params,
    ).fetchall()

    for row in rows:
        if not _capture_in_crisis_window(
            captured_at,
            row.archive_window_start,
            row.archive_window_end,
            org.default_public_report_months,
        ):
            continue
        crisis = db.query(Crisis).filter(Crisis.id == row.id).first()
        if crisis:
            return crisis
    return None


def apply_auto_classification(
    db: Session,
    *,
    report_id: UUID,
    geom_geojson: dict | None,
    building_id: UUID | None,
    captured_at: datetime,
    matched: Crisis | None = None,
) -> Crisis | None:
    """Create auto_classify link when report matches an active crisis; always returns unspecified bucket."""
    unspecified = get_unspecified_crisis(db)
    if matched is None:
        matched = resolve_active_crisis_for_report(
            db,
            geom_geojson=geom_geojson,
            building_id=building_id,
            captured_at=captured_at,
        )
    if not matched:
        return unspecified
    exists = db.execute(
        text(
            """
            SELECT 1
            FROM report_crisis_links
            WHERE report_id = CAST(:rid AS uuid)
              AND crisis_id = CAST(:cid AS uuid)
            """
        ),
        {"rid": str(report_id), "cid": str(matched.id)},
    ).first()
    if exists:
        return unspecified
    _ensure_auto_classify_link_source(db)
    db.execute(
        text(
            """
            INSERT INTO report_crisis_links (report_id, crisis_id, linked_by, link_source)
            VALUES (CAST(:rid AS uuid), CAST(:cid AS uuid), NULL, 'auto_classify')
            ON CONFLICT DO NOTHING
            """
        ),
        {"rid": str(report_id), "cid": str(matched.id)},
    )
    return unspecified


def backfill_auto_classification(db: Session, *, limit: int = 500) -> dict:
    """Re-run auto classification for reports that have no crisis link yet."""
    rows = db.execute(
        text(
            """
            SELECT r.id,
                   ST_AsGeoJSON(r.geom)::json AS geom,
                   r.building_id,
                   r.captured_at_client
            FROM reports r
            WHERE NOT EXISTS (
              SELECT 1 FROM report_crisis_links l WHERE l.report_id = r.id
            )
            ORDER BY r.received_at_server DESC
            LIMIT :lim
            """
        ),
        {"lim": limit},
    ).mappings().all()
    linked = 0
    for row in rows:
        before = db.execute(
            text(
                """
                SELECT COUNT(*)::int FROM report_crisis_links
                WHERE report_id = CAST(:rid AS uuid)
                """
            ),
            {"rid": str(row["id"])},
        ).scalar_one()
        apply_auto_classification(
            db,
            report_id=row["id"],
            geom_geojson=row["geom"],
            building_id=row["building_id"],
            captured_at=row["captured_at_client"],
        )
        after = db.execute(
            text(
                """
                SELECT COUNT(*)::int FROM report_crisis_links
                WHERE report_id = CAST(:rid AS uuid)
                """
            ),
            {"rid": str(row["id"])},
        ).scalar_one()
        if after > before:
            linked += 1
    return {"processed": len(rows), "linked": linked}
