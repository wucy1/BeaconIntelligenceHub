from __future__ import annotations

from datetime import datetime
from uuid import UUID

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.zone_scope import geom_scope_clause

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

_CRISIS_ZONE_SCOPE = """
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
    OR EXISTS (
      SELECT 1 FROM buildings b2
      WHERE b2.id = r.building_id
        AND b2.crisis_id = CAST(:cid AS uuid)
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


_UNLINKED_ACTIVE_CRISIS = """
  AND NOT EXISTS (
    SELECT 1 FROM report_crisis_links l
    JOIN crises c ON c.id = l.crisis_id
    WHERE l.report_id = r.id
      AND c.archive_status = 'active'
      AND c.slug <> 'unspecified'
  )
"""


def report_ids_unspecified_scoped(
    db: Session,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
    limit: int,
    *,
    reviewed_only: bool | None = None,
    geom_snapshots: list[dict[str, Any]] | None = None,
    crisis_context_id: UUID | None = None,
) -> list[UUID]:
    time_clause, params = _time_reviewed_clause(captured_from, captured_to, reviewed_only)
    exclusion = _UNLINKED_ACTIVE_CRISIS if crisis_context_id is not None else _ACTIVE_EXCLUSION
    if crisis_context_id is not None:
        params["cid"] = str(crisis_context_id)
        zone_clause, zone_params = _crisis_query_zone_clause(crisis_context_id, zone_ids, geom_snapshots)
        params.update(zone_params)
    elif geom_snapshots:
        zone_clause, geom_params = geom_scope_clause(geom_snapshots)
        params.update(geom_params)
    elif zone_ids is not None:
        if len(zone_ids) == 0:
            return []
        zone_clause = _ZONE_SCOPE
        params["zone_ids"] = [str(z) for z in zone_ids]
    else:
        zone_clause = ""
    sql = f"""
        SELECT r.id FROM reports r
        LEFT JOIN buildings b ON b.id = r.building_id
        WHERE TRUE {time_clause} {zone_clause} {exclusion}
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
    geom_snapshots: list[dict[str, Any]] | None = None,
) -> list[UUID]:
    time_clause, params = _time_reviewed_clause(captured_from, captured_to, reviewed_only)
    params["cid"] = str(crisis_id)
    zone_clause = ""
    crisis_zone_guard = """
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
          OR EXISTS (
            SELECT 1 FROM buildings b2
            WHERE b2.id = r.building_id
              AND b2.crisis_id = CAST(:cid AS uuid)
          )
        )
    """
    if geom_snapshots:
        zone_clause, geom_params = geom_scope_clause(geom_snapshots)
        params.update(geom_params)
        crisis_zone_guard = ""
    elif zone_ids is not None:
        if len(zone_ids) == 0:
            return []
        zone_clause = _CRISIS_ZONE_SCOPE
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
        {crisis_zone_guard}
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
    geom_snapshots: list[dict[str, Any]] | None = None,
) -> list[UUID]:
    unspecified = report_ids_unspecified_scoped(
        db,
        zone_ids,
        captured_from,
        captured_to,
        limit,
        reviewed_only=reviewed_only,
        geom_snapshots=geom_snapshots,
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
            geom_snapshots=geom_snapshots,
        ):
            if rid not in seen:
                seen.add(rid)
                merged.append(rid)
                if len(merged) >= limit:
                    break
    return merged[:limit]


def _crisis_zone_ids(
    db: Session,
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
) -> list[UUID] | None:
    """Resolve zone filter for archive-aligned browse: explicit filter or all crisis zones."""
    if zone_ids is not None:
        return zone_ids
    rows = db.execute(
        text("SELECT id FROM zones WHERE crisis_id = CAST(:cid AS uuid)"),
        {"cid": str(crisis_id)},
    ).scalars().all()
    return list(rows) if rows else None


def _crisis_query_zone_clause(
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
    geom_snapshots: list[dict[str, Any]] | None,
) -> tuple[str, dict]:
    """Spatial filter for crisis query browse (not archive)."""
    if geom_snapshots:
        return geom_scope_clause(geom_snapshots)
    if zone_ids is not None:
        if len(zone_ids) == 0:
            return " AND FALSE", {}
        return _CRISIS_ZONE_SCOPE, {"zone_ids": [str(z) for z in zone_ids]}
    return """
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
          OR EXISTS (
            SELECT 1 FROM buildings b2
            WHERE b2.id = r.building_id
              AND b2.crisis_id = CAST(:cid AS uuid)
          )
        )
    """, {}


def report_ids_crisis_query_scope(
    db: Session,
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
    limit: int,
    *,
    geom_snapshots: list[dict[str, Any]] | None = None,
) -> list[UUID]:
    """All reports in browse time + zone for this crisis (query layer; ignores archive links)."""
    time_clause, params = _time_reviewed_clause(captured_from, captured_to, None)
    params["cid"] = str(crisis_id)
    zone_clause, zone_params = _crisis_query_zone_clause(crisis_id, zone_ids, geom_snapshots)
    params.update(zone_params)
    sql = f"""
        SELECT r.id FROM reports r
        LEFT JOIN buildings b ON b.id = r.building_id
        WHERE TRUE {time_clause} {zone_clause}
        ORDER BY r.captured_at_client DESC
        LIMIT :lim
    """
    return _run_ids(db, sql, params, limit)


def _browse_link_status(
    db: Session,
    crisis_id: UUID,
    report_ids: list[UUID],
) -> dict[UUID, str]:
    if not report_ids:
        return {}
    rows = db.execute(
        text(
            """
            SELECT report_id, crisis_id
            FROM report_crisis_links
            WHERE report_id = ANY(CAST(:ids AS uuid[]))
            """
        ),
        {"ids": [str(i) for i in report_ids]},
    ).all()
    links_by_report: dict[UUID, set[UUID]] = {}
    for rid, cid in rows:
        links_by_report.setdefault(rid, set()).add(cid)
    status: dict[UUID, str] = {}
    for rid in report_ids:
        linked_crises = links_by_report.get(rid, set())
        if crisis_id in linked_crises:
            status[rid] = "linked"
        elif linked_crises:
            status[rid] = "other_linked"
        else:
            status[rid] = "candidate"
    return status


def report_ids_for_crisis_browse(
    db: Session,
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
    limit: int,
    *,
    geom_snapshots: list[dict[str, Any]] | None = None,
) -> tuple[list[UUID], dict[UUID, str]]:
    """
  All reports in work-crisis zones + browse time (view=all).
  Annotates link status for map markers.
    """
    ids = report_ids_crisis_query_scope(
        db,
        crisis_id,
        zone_ids,
        captured_from,
        captured_to,
        limit,
        geom_snapshots=geom_snapshots,
    )
    return ids, _browse_link_status(db, crisis_id, ids)
