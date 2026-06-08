from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ops_auth import OpsPrincipal


def resolve_zone_filter_ids(
    principal: OpsPrincipal,
    requested_zone_id: UUID | None,
) -> list[UUID] | None:
    """
    Returns zone id list to filter by, or None meaning all reports (unscoped).
    Empty list means no visible zones.
    """
    if principal.sees_all_zones():
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


def report_ids_in_zones(
    db: Session,
    crisis_id: UUID,
    zone_ids: list[UUID] | None,
    captured_from,
    captured_to,
    limit: int,
) -> list[UUID]:
    time_filter = ""
    params: dict = {"cid": str(crisis_id), "lim": limit}
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
            WHERE r.crisis_id = CAST(:cid AS uuid)
              {time_filter}
              {zone_filter}
            ORDER BY r.captured_at_client DESC
            LIMIT :lim
            """
        ),
        params,
    ).scalars().all()
    return list(rows)
