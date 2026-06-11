from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

_ACTIVE_EXCLUSION = """
  AND NOT EXISTS (
    SELECT 1 FROM zones z
    JOIN crises c ON c.id = z.crisis_id
    WHERE c.archive_status = 'active'
      AND (
        (r.geom IS NOT NULL AND ST_Intersects(r.geom, z.geom))
        OR (b.geom IS NOT NULL AND ST_Intersects(b.geom, z.geom))
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM report_crisis_links l
    JOIN crises c ON c.id = l.crisis_id
    WHERE l.report_id = r.id AND c.archive_status = 'active'
  )
"""

_ZONE_SCOPE = """
  AND (
    EXISTS (
      SELECT 1 FROM zones z
      WHERE z.id = ANY(CAST(:zone_ids AS uuid[]))
        AND r.geom IS NOT NULL
        AND ST_Intersects(r.geom, z.geom)
    )
    OR EXISTS (
      SELECT 1 FROM zones z
      JOIN buildings b2 ON b2.id = r.building_id
      WHERE z.id = ANY(CAST(:zone_ids AS uuid[]))
        AND b2.geom IS NOT NULL
        AND ST_Intersects(b2.geom, z.geom)
    )
  )
"""


def _time_reviewed_clause(
    captured_from: datetime | None,
    captured_to: datetime | None,
    reviewed_only: bool | None,
) -> tuple[str, dict]:
    clause = ""
    params: dict = {}
    if captured_from is not None:
        clause += " AND r.captured_at_client >= :captured_from"
        params["captured_from"] = captured_from
    if captured_to is not None:
        clause += " AND r.captured_at_client <= :captured_to"
        params["captured_to"] = captured_to
    if reviewed_only is True:
        clause += " AND r.admin_reviewed = true"
    elif reviewed_only is False:
        clause += " AND r.admin_reviewed = false"
    return clause, params


def _run_ids(db: Session, sql: str, params: dict, limit: int) -> list[UUID]:
    rows = db.execute(text(sql), {**params, "lim": limit}).scalars().all()
    return list(rows)


def report_ids_unspecified_scoped(
    db: Session,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
    limit: int,
    *,
    reviewed_only: bool | None = None,
) -> list[UUID]:
    time_clause, params = _time_reviewed_clause(captured_from, captured_to, reviewed_only)
    zone_clause = ""
    if zone_ids is not None:
        if len(zone_ids) == 0:
            return []
        zone_clause = _ZONE_SCOPE
        params["zone_ids"] = [str(z) for z in zone_ids]
    sql = f"""
        SELECT r.id FROM reports r
        LEFT JOIN buildings b ON b.id = r.building_id
        WHERE TRUE {time_clause} {zone_clause} {_ACTIVE_EXCLUSION}
        ORDER BY r.captured_at_client DESC
        LIMIT :lim
    """
    return _run_ids(db, sql, params, limit)


def report_ids_for_crisis_scoped(
    db: Session,
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
    limit: int,
    *,
    reviewed_only: bool | None = None,
) -> list[UUID]:
    time_clause, params = _time_reviewed_clause(captured_from, captured_to, reviewed_only)
    params["cid"] = str(crisis_id)
    zone_clause = ""
    if zone_ids is not None:
        if len(zone_ids) == 0:
            return []
        zone_clause = _ZONE_SCOPE
        params["zone_ids"] = [str(z) for z in zone_ids]
    sql = f"""
        SELECT r.id FROM reports r
        LEFT JOIN buildings b ON b.id = r.building_id
        WHERE (
          r.crisis_id = CAST(:cid AS uuid)
          OR EXISTS (
            SELECT 1 FROM report_crisis_links l
            WHERE l.report_id = r.id AND l.crisis_id = CAST(:cid AS uuid)
          )
        )
        {time_clause}
        {zone_clause}
        AND (
          NOT EXISTS (SELECT 1 FROM zones z WHERE z.crisis_id = CAST(:cid AS uuid))
          OR EXISTS (
            SELECT 1 FROM zones z
            WHERE z.crisis_id = CAST(:cid AS uuid)
              AND (
                (r.geom IS NOT NULL AND ST_Intersects(r.geom, z.geom))
                OR (b.geom IS NOT NULL AND ST_Intersects(b.geom, z.geom))
              )
          )
        )
        ORDER BY r.captured_at_client DESC
        LIMIT :lim
    """
    return _run_ids(db, sql, params, limit)


def report_ids_all_scoped(
    db: Session,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
    limit: int,
    *,
    reviewed_only: bool | None = None,
) -> list[UUID]:
    unspecified = report_ids_unspecified_scoped(
        db, zone_ids, captured_from, captured_to, limit, reviewed_only=reviewed_only
    )
    seen = set(unspecified)
    active_rows = db.execute(
        text("SELECT id FROM crises WHERE archive_status = 'active'")
    ).scalars().all()
    merged = list(unspecified)
    for cid in active_rows:
        if len(merged) >= limit:
            break
        for rid in report_ids_for_crisis_scoped(
            db,
            cid,
            zone_ids,
            captured_from,
            captured_to,
            limit - len(merged),
            reviewed_only=reviewed_only,
        ):
            if rid not in seen:
                seen.add(rid)
                merged.append(rid)
                if len(merged) >= limit:
                    break
    return merged[:limit]
