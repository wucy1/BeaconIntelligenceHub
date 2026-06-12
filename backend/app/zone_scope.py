from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ops_auth import OpsPrincipal


def geom_scope_clause(snapshots: list[dict[str, Any]] | None) -> tuple[str, dict]:
    """Spatial filter using frozen GeoJSON polygons from a saved report."""
    if not snapshots:
        return "", {}
    parts: list[str] = []
    params: dict = {}
    for i, snap in enumerate(snapshots):
        geom = snap.get("geom")
        if not geom:
            continue
        key = f"zgeom_{i}"
        parts.append(
            f"""(
              (r.geom IS NOT NULL AND ST_Intersects(
                r.geom, ST_SetSRID(ST_GeomFromGeoJSON(CAST(:{key} AS text)), 4326)))
              OR EXISTS (
                SELECT 1 FROM buildings bz WHERE bz.id = r.building_id
                  AND bz.geom IS NOT NULL
                  AND ST_Intersects(
                    bz.geom, ST_SetSRID(ST_GeomFromGeoJSON(CAST(:{key} AS text)), 4326))
              )
            )"""
        )
        params[key] = json.dumps(geom)
    if not parts:
        return "", {}
    return " AND (" + " OR ".join(parts) + ")", params


def resolve_zone_filter_ids(
    principal: OpsPrincipal,
    requested_zone_id: UUID | None,
    crisis_id: UUID | None = None,
) -> list[UUID] | None:
    """
    Returns zone id list to filter by, or None meaning crisis-wide / unscoped browse.
    Empty list means no visible zones (coordinator with no assignments).
    """
    if not principal.uses_coordinator_zone_filter(crisis_id):
        if requested_zone_id:
            return [requested_zone_id]
        return None
    allowed = set(principal.zone_ids)
    if not allowed:
        return []
    if requested_zone_id:
        if requested_zone_id not in allowed:
            raise ValueError("zone_not_allowed")
        return [requested_zone_id]
    return list(allowed)


def principal_can_access_report(
    db: Session,
    principal: OpsPrincipal,
    report_id: UUID,
    crisis_id: UUID | None = None,
) -> bool:
    if principal.is_system_admin():
        return True
    from app.ops_reports_query import report_ids_for_crisis_scoped

    for cid in principal.crisis_lead_ids:
        if report_id in report_ids_for_crisis_scoped(db, cid, None, None, None, 5000):
            return True
    zone_ids = resolve_zone_filter_ids(principal, None, crisis_id)
    if zone_ids is None:
        return False
    visible = report_ids_in_zones(db, None, list(zone_ids), None, None, 5000)
    return report_id in visible


def report_ids_in_zones(
    db: Session,
    crisis_id: UUID | None,
    zone_ids: list[UUID] | None,
    captured_from,
    captured_to,
    limit: int,
) -> list[UUID]:
    time_filter = ""
    params: dict = {"lim": limit}
    crisis_filter = ""
    if crisis_id is not None:
        crisis_filter = " AND r.crisis_id = CAST(:cid AS uuid)"
        params["cid"] = str(crisis_id)
    if captured_from is not None:
        time_filter += " AND r.captured_at_client >= :captured_from"
        params["captured_from"] = captured_from
    if captured_to is not None:
        time_filter += " AND r.captured_at_client <= :captured_to"
        params["captured_to"] = captured_to

    zone_filter = ""
    if zone_ids is not None:
        if len(zone_ids) == 0:
            return []
        zone_filter = """
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
            )
          )
        """
        params["zone_ids"] = [str(z) for z in zone_ids]

    rows = db.execute(
        text(
            f"""
            SELECT r.id FROM reports r
            WHERE TRUE
              {crisis_filter}
              {time_filter}
              {zone_filter}
            ORDER BY r.captured_at_client DESC
            LIMIT :lim
            """
        ),
        params,
    ).scalars().all()
    return list(rows)
