from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.archive_logic import report_matches_archive_scope
from app.models import Crisis, Zone

logger = logging.getLogger(__name__)


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


def resolve_active_crisis_for_report(
    db: Session,
    *,
    report_id: UUID,
    captured_at: datetime,
) -> Crisis | None:
    """Pick newest active crisis whose batch-archive scope contains this report."""
    crises = (
        db.query(Crisis)
        .filter(Crisis.archive_status == "active", Crisis.slug != "unspecified")
        .order_by(Crisis.created_at.desc())
        .all()
    )
    for crisis in crises:
        zone_ids = [z.id for z in db.query(Zone).filter(Zone.crisis_id == crisis.id).all()]
        if not zone_ids:
            continue
        if report_matches_archive_scope(
            db,
            report_id,
            crisis.id,
            zone_ids,
            crisis.archive_window_start,
            crisis.archive_window_end,
        ):
            return crisis
    return None


def apply_auto_classification(
    db: Session,
    *,
    report_id: UUID,
    geom_geojson: dict | None = None,
    building_id: UUID | None = None,
    captured_at: datetime,
    matched: Crisis | None = None,
) -> Crisis | None:
    """Create auto_classify link when report matches an active crisis; always returns unspecified bucket."""
    _ = geom_geojson, building_id
    unspecified = get_unspecified_crisis(db)
    if matched is None:
        matched = resolve_active_crisis_for_report(
            db,
            report_id=report_id,
            captured_at=captured_at,
        )
    if not matched:
        logger.info(
            "auto_classify: no crisis scope match for report %s",
            report_id,
        )
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
    try:
        with db.begin_nested():
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
    except IntegrityError:
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
    logger.info("auto_classify linked report %s to crisis %s", report_id, matched.id)
    return unspecified


def backfill_auto_classification(db: Session, *, limit: int = 500) -> dict:
    """Re-run auto classification for reports that have no crisis link yet."""
    rows = db.execute(
        text(
            """
            SELECT r.id, r.captured_at_client
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
