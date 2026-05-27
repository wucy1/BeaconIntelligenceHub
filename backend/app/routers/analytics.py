from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db

router = APIRouter(prefix="/v1/analytics", tags=["analytics"])


@router.get("/summary")
def analytics_summary(
    crisis_id: UUID,
    db: Session = Depends(get_db),
) -> dict:
    total = db.execute(
        text("SELECT COUNT(*) FROM reports WHERE crisis_id = :cid"),
        {"cid": str(crisis_id)},
    ).scalar_one()

    latest_count = db.execute(
        text("SELECT COUNT(*) FROM latest_report_per_building WHERE crisis_id = :cid"),
        {"cid": str(crisis_id)},
    ).scalar_one()

    damage_rows = db.execute(
        text(
            """
            SELECT damage_level, COUNT(*) AS cnt
            FROM latest_report_per_building
            WHERE crisis_id = :cid
            GROUP BY damage_level
            """
        ),
        {"cid": str(crisis_id)},
    ).mappings().all()

    damage_counts = {r["damage_level"]: r["cnt"] for r in damage_rows}

    timeline = db.execute(
        text(
            """
            SELECT date_trunc('day', received_at_server) AS day, COUNT(*) AS cnt
            FROM reports
            WHERE crisis_id = :cid
            GROUP BY 1
            ORDER BY 1
            """
        ),
        {"cid": str(crisis_id)},
    ).mappings().all()

    return {
        "crisis_id": str(crisis_id),
        "total_reports": total,
        "latest_building_count": latest_count,
        "damage_counts": damage_counts,
        "timeline": [{"day": str(r["day"]), "count": r["cnt"]} for r in timeline],
    }


@router.get("/timeline")
def analytics_timeline(crisis_id: UUID, db: Session = Depends(get_db)) -> dict:
    """Alias for timeline slice (also included in /summary)."""
    summary = analytics_summary(crisis_id, db)
    return {"crisis_id": summary["crisis_id"], "timeline": summary["timeline"]}


@router.get("/crises")
def analytics_crises(crisis_id: UUID, db: Session = Depends(get_db)) -> dict:
    """Crisis-level aggregates (damage counts + totals)."""
    return analytics_summary(crisis_id, db)


@router.get("/buildings")
def analytics_buildings(
    crisis_id: UUID,
    db: Session = Depends(get_db),
) -> dict:
    rows = db.execute(
        text(
            """
            SELECT b.id::text AS building_id, b.name,
                   lr.damage_level, lr.received_at_server
            FROM buildings b
            LEFT JOIN latest_report_per_building lr ON lr.building_id = b.id
            WHERE b.crisis_id = :cid
            ORDER BY b.name NULLS LAST
            """
        ),
        {"cid": str(crisis_id)},
    ).mappings().all()
    return {"items": [dict(r) for r in rows]}


@router.get("/map")
def analytics_map(
    crisis_id: UUID,
    latest_only: int = Query(1, ge=0, le=1),
    db: Session = Depends(get_db),
) -> dict:
    """GeoJSON points for dashboard map (report geom or building centroid)."""
    source = "latest_report_per_building" if latest_only else "reports"
    extra = "AND lr.crisis_id = :cid" if latest_only else "WHERE r.crisis_id = :cid"
    alias = "lr" if latest_only else "r"
    fc = db.execute(
        text(
            f"""
            SELECT jsonb_build_object(
              'type', 'FeatureCollection',
              'features', COALESCE(
                (
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'type', 'Feature',
                      'geometry', COALESCE(
                        ST_AsGeoJSON({alias}.geom)::jsonb,
                        ST_AsGeoJSON(ST_Centroid(b.geom))::jsonb
                      ),
                      'properties', jsonb_build_object(
                        'report_id', {alias}.id::text,
                        'damage_level', {alias}.damage_level,
                        'building_id', {alias}.building_id::text,
                        'description_preview', left({alias}.description, 80)
                      )
                    )
                  )
                  FROM {source} {alias}
                  LEFT JOIN buildings b ON b.id = {alias}.building_id
                  {extra}
                  AND (
                    {alias}.geom IS NOT NULL
                    OR b.geom IS NOT NULL
                  )
                ),
                '[]'::jsonb
              )
            ) AS fc
            """
        ),
        {"cid": str(crisis_id)},
    ).scalar_one()
    return fc
