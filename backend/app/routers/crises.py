from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import CrisisOut

router = APIRouter(prefix="/v1/crises", tags=["crises"])


@router.get("", response_model=list[CrisisOut])
def list_crises(db: Session = Depends(get_db)) -> list[CrisisOut]:
    rows = db.execute(
        text(
            """
            SELECT id, slug, name,
                   CASE WHEN bounds IS NULL THEN NULL ELSE ST_AsGeoJSON(bounds)::json END AS bounds
            FROM crises
            ORDER BY created_at DESC
            """
        )
    ).mappings().all()
    return [
        CrisisOut(
            id=r["id"],
            slug=r["slug"],
            name=r["name"],
            bounds=r["bounds"],
        )
        for r in rows
    ]


@router.get("/{crisis_id}/buildings")
def crisis_buildings(
    crisis_id: UUID,
    bbox: str | None = None,
    db: Session = Depends(get_db),
) -> dict:
    params: dict = {"cid": str(crisis_id)}
    bbox_sql = ""
    if bbox:
        parts = bbox.split(",")
        if len(parts) == 4:
            min_lng, min_lat, max_lng, max_lat = map(float, parts)
            bbox_sql = """
              AND ST_Intersects(
                b.geom,
                ST_MakeEnvelope(:minx, :miny, :maxx, :maxy, 4326)
              )
            """
            params.update(minx=min_lng, miny=min_lat, maxx=max_lng, maxy=max_lat)

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
                      'geometry', ST_AsGeoJSON(b.geom)::jsonb,
                      'properties', jsonb_build_object(
                        'building_id', b.id::text,
                        'name', b.name,
                        'external_ref', b.external_ref
                      )
                    )
                  )
                  FROM buildings b
                  WHERE b.crisis_id = CAST(:cid AS uuid)
                  {bbox_sql}
                ),
                '[]'::jsonb
              )
            ) AS fc
            """
        ),
        params,
    ).scalar_one()
    return fc
