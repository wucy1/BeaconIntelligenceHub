from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


def _time_clause(captured_from, captured_to) -> tuple[str, dict]:
    clause = ""
    params: dict = {}
    if captured_from is not None:
        clause += " AND r.captured_at_client >= :captured_from"
        params["captured_from"] = captured_from
    if captured_to is not None:
        clause += " AND r.captured_at_client <= :captured_to"
        params["captured_to"] = captured_to
    return clause, params


def _zone_clause(zone_ids: list[UUID] | None, crisis_id: UUID | None = None) -> tuple[str, dict]:
    if zone_ids is None:
        return "", {}
    if len(zone_ids) == 0:
        return " AND FALSE", {}
    params: dict = {"zone_ids": [str(z) for z in zone_ids]}
    crisis_building = ""
    if crisis_id is not None:
        params["cid"] = str(crisis_id)
        crisis_building = """
        OR EXISTS (
          SELECT 1 FROM buildings b
          WHERE b.id = r.building_id
            AND b.crisis_id = CAST(:cid AS uuid)
        )
        """
    return (
        f"""
      AND (
        EXISTS (
          SELECT 1 FROM zones z
          WHERE z.id = ANY(CAST(:zone_ids AS uuid[]))
            AND r.geom IS NOT NULL
            AND ST_Intersects(r.geom, z.geom)
        )
        OR EXISTS (
          SELECT 1 FROM zones z
          JOIN buildings b ON b.id = r.building_id
          WHERE z.id = ANY(CAST(:zone_ids AS uuid[]))
            AND b.geom IS NOT NULL
            AND ST_Intersects(b.geom, z.geom)
        ){crisis_building}
      )
    """,
        params,
    )


def report_ids_for_archive(
    db: Session,
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
    limit: int,
    *,
    exclude_already_linked: bool = True,
) -> list[UUID]:
    time_filter, time_params = _time_clause(captured_from, captured_to)
    zone_filter, zone_params = _zone_clause(zone_ids, crisis_id)
    link_filter = ""
    if exclude_already_linked:
        link_filter = """
          AND NOT EXISTS (
            SELECT 1 FROM report_crisis_links l
            WHERE l.report_id = r.id AND l.crisis_id = CAST(:cid AS uuid)
          )
        """
    params = {"cid": str(crisis_id), "lim": limit, **time_params, **zone_params}
    rows = db.execute(
        text(
            f"""
            SELECT r.id FROM reports r
            WHERE TRUE
              {time_filter}
              {zone_filter}
              {link_filter}
            ORDER BY r.captured_at_client DESC
            LIMIT :lim
            """
        ),
        params,
    ).scalars().all()
    return list(rows)


def _in_scope_condition(
    crisis_id: UUID,
    captured_from: datetime | None,
    captured_to: datetime | None,
    zone_ids: list[UUID] | None,
) -> tuple[str, dict]:
    time_filter, time_params = _time_clause(captured_from, captured_to)
    zone_filter, zone_params = _zone_clause(zone_ids, crisis_id)
    return f"(TRUE{time_filter}{zone_filter})", {**time_params, **zone_params}


def report_ids_to_unlink(
    db: Session,
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
    limit: int,
) -> list[UUID]:
    """Linked to this crisis but outside the current archive time/zone scope."""
    in_scope, scope_params = _in_scope_condition(crisis_id, captured_from, captured_to, zone_ids)
    params = {"cid": str(crisis_id), "lim": limit, **scope_params}
    rows = db.execute(
        text(
            f"""
            SELECT l.report_id
            FROM report_crisis_links l
            INNER JOIN reports r ON r.id = l.report_id
            WHERE l.crisis_id = CAST(:cid AS uuid)
              AND NOT {in_scope}
            ORDER BY r.captured_at_client DESC
            LIMIT :lim
            """
        ),
        params,
    ).scalars().all()
    return list(rows)


def count_linked_in_scope(
    db: Session,
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
    captured_from: datetime | None,
    captured_to: datetime | None,
) -> int:
    in_scope, scope_params = _in_scope_condition(crisis_id, captured_from, captured_to, zone_ids)
    params = {"cid": str(crisis_id), **scope_params}
    return int(
        db.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM report_crisis_links l
                INNER JOIN reports r ON r.id = l.report_id
                WHERE l.crisis_id = CAST(:cid AS uuid)
                  AND {in_scope}
                """
            ),
            params,
        ).scalar_one()
    )
