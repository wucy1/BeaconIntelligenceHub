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


def _intersects_crisis_zones(
    db: Session,
    crisis_id: UUID,
    *,
    report_geom,
    building_id: UUID | None,
) -> bool:
    if report_geom is not None:
        in_zone = db.execute(
            text(
                """
                SELECT EXISTS (
                  SELECT 1 FROM zones z
                  WHERE z.crisis_id = CAST(:cid AS uuid)
                    AND ST_Intersects(:pt, z.geom)
                )
                """
            ),
            {"cid": str(crisis_id), "pt": report_geom},
        ).scalar_one()
        if in_zone:
            return True
    if building_id is not None:
        in_zone = db.execute(
            text(
                """
                SELECT EXISTS (
                  SELECT 1 FROM zones z
                  JOIN buildings b ON b.id = CAST(:bid AS uuid)
                  WHERE z.crisis_id = CAST(:cid AS uuid)
                    AND b.geom IS NOT NULL
                    AND ST_Intersects(b.geom, z.geom)
                )
                """
            ),
            {"cid": str(crisis_id), "bid": str(building_id)},
        ).scalar_one()
        if in_zone:
            return True
    return False


def resolve_active_crisis_for_report(
    db: Session,
    *,
    geom_geojson: dict | None,
    building_id: UUID | None,
    captured_at: datetime,
) -> Crisis | None:
    """Match active crisis by report time window and zone intersection (newest crisis first)."""
    org = get_org_settings(db)
    report_geom = None
    if geom_geojson:
        try:
            g = shape(geom_geojson)
            if g.geom_type == "Point":
                report_geom = from_shape(g, srid=4326)
        except Exception:
            report_geom = None

    active = (
        db.query(Crisis)
        .filter(Crisis.archive_status == "active", Crisis.slug != "unspecified")
        .order_by(Crisis.created_at.desc())
        .all()
    )
    for crisis in active:
        captured_from, captured_to = effective_capture_window(
            months=org.default_public_report_months,
            event_start=crisis.archive_window_start,
            event_end=crisis.archive_window_end,
            now=captured_at,
        )
        if captured_at < captured_from or captured_at > captured_to:
            continue
        if _intersects_crisis_zones(
            db,
            crisis.id,
            report_geom=report_geom,
            building_id=building_id,
        ):
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
