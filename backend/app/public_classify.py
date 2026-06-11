from __future__ import annotations

from datetime import datetime
from uuid import UUID

from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import Crisis, ReportCrisisLink
from app.org_settings import effective_capture_window, get_org_settings


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
    """Match active crisis by report time window and zone intersection (newest crisis first)."""
    org = get_org_settings(db)
    report_geom = _report_geom(geom_geojson)

    if report_geom is not None:
        rows = db.execute(
            text(
                """
                SELECT c.id, c.archive_window_start, c.archive_window_end
                FROM crises c
                WHERE c.archive_status = 'active' AND c.slug <> 'unspecified'
                  AND EXISTS (
                    SELECT 1 FROM zones z
                    WHERE z.crisis_id = c.id AND ST_Intersects(:pt, z.geom)
                  )
                ORDER BY c.created_at DESC
                """
            ),
            {"pt": report_geom},
        ).fetchall()
    elif building_id is not None:
        rows = db.execute(
            text(
                """
                SELECT c.id, c.archive_window_start, c.archive_window_end
                FROM crises c
                WHERE c.archive_status = 'active' AND c.slug <> 'unspecified'
                  AND EXISTS (
                    SELECT 1 FROM zones z
                    JOIN buildings b ON b.id = CAST(:bid AS uuid)
                    WHERE z.crisis_id = c.id
                      AND b.geom IS NOT NULL
                      AND ST_Intersects(b.geom, z.geom)
                  )
                ORDER BY c.created_at DESC
                """
            ),
            {"bid": str(building_id)},
        ).fetchall()
    else:
        return None

    for row in rows:
        captured_from, captured_to = effective_capture_window(
            months=org.default_public_report_months,
            event_start=row.archive_window_start,
            event_end=row.archive_window_end,
            now=captured_at,
        )
        if captured_at < captured_from or captured_at > captured_to:
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
    existing = (
        db.query(ReportCrisisLink)
        .filter(
            ReportCrisisLink.report_id == report_id,
            ReportCrisisLink.crisis_id == matched.id,
        )
        .first()
    )
    if not existing:
        db.add(
            ReportCrisisLink(
                report_id=report_id,
                crisis_id=matched.id,
                linked_by=None,
                link_source="auto_classify",
            )
        )
    return unspecified
