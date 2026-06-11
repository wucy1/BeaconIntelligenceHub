import csv
import io
import json
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Report

router = APIRouter(prefix="/v1/export", tags=["export"])


def _fetch_rows(
    db: Session,
    crisis_id: UUID,
    latest_only: bool,
    reviewed_only: bool | None = None,
) -> list[Report]:
    if latest_only:
        ids = db.execute(
            text("SELECT id FROM latest_report_per_building WHERE crisis_id = :cid"),
            {"cid": str(crisis_id)},
        ).scalars().all()
        if not ids:
            return []
        rows = db.query(Report).filter(Report.id.in_(list(ids))).order_by(Report.received_at_server.asc()).all()
        if reviewed_only is True:
            return [r for r in rows if r.admin_reviewed]
        if reviewed_only is False:
            return [r for r in rows if not r.admin_reviewed]
        return rows
    rows = (
        db.query(Report)
        .filter(Report.crisis_id == crisis_id)
        .order_by(Report.received_at_server.asc())
        .all()
    )
    if reviewed_only is True:
        return [r for r in rows if r.admin_reviewed]
    if reviewed_only is False:
        return [r for r in rows if not r.admin_reviewed]
    return rows


def _coords(db: Session, report_id: UUID, r: Report) -> tuple[str, str]:
    if r.geom is not None:
        pair = db.execute(
            text("SELECT ST_X(geom), ST_Y(geom) FROM reports WHERE id = :id"),
            {"id": report_id},
        ).one()
        return str(pair[0]), str(pair[1])
    if r.building_id:
        pair = db.execute(
            text(
                """
                SELECT ST_X(ST_Centroid(geom)), ST_Y(ST_Centroid(geom))
                FROM buildings WHERE id = :bid
                """
            ),
            {"bid": r.building_id},
        ).one_or_none()
        if pair:
            return str(pair[0]), str(pair[1])
    return "", ""


@router.get("")
def export_data(
    crisis_id: UUID,
    export_format: str = Query("csv", alias="format", pattern="^(csv|geojson)$"),
    latest: int = Query(0, ge=0, le=1),
    reviewed_only: bool | None = None,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    latest_only = latest == 1
    rows = _fetch_rows(db, crisis_id, latest_only, reviewed_only=reviewed_only)
    suffix = "latest" if latest_only else "all"
    if reviewed_only is True:
        suffix += "-reviewed"
    elif reviewed_only is False:
        suffix += "-pending"

    if export_format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(
            [
                "id",
                "client_generated_uuid",
                "building_id",
                "lon",
                "lat",
                "damage_level",
                "infrastructure_types",
                "infrastructure_name",
                "crisis_types",
                "debris_clearing_required",
                "description",
                "description_language",
                "captured_at_client",
                "received_at_server",
                "textual_location",
            ]
        )
        for r in rows:
            lon, lat = _coords(db, r.id, r)
            w.writerow(
                [
                    str(r.id),
                    str(r.client_generated_uuid),
                    str(r.building_id) if r.building_id else "",
                    lon,
                    lat,
                    r.damage_level,
                    "|".join(r.infrastructure_types or []),
                    r.infrastructure_name,
                    "|".join(r.crisis_types or []),
                    r.debris_clearing_required,
                    r.description,
                    r.description_language,
                    r.captured_at_client.isoformat(),
                    r.received_at_server.isoformat(),
                    r.textual_location or "",
                ]
            )
        data = buf.getvalue().encode("utf-8")
        return StreamingResponse(
            iter([data]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="export-{crisis_id}-{suffix}.csv"'},
        )

    features = []
    for r in rows:
        geom = None
        if r.geom is not None:
            geom = db.execute(
                text("SELECT ST_AsGeoJSON(geom)::json FROM reports WHERE id = :id"),
                {"id": r.id},
            ).scalar_one()
        elif r.building_id:
            geom = db.execute(
                text("SELECT ST_AsGeoJSON(ST_Centroid(geom))::json FROM buildings WHERE id = :bid"),
                {"bid": r.building_id},
            ).scalar_one_or_none()
        features.append(
            {
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "report_id": str(r.id),
                    "damage_level": r.damage_level,
                    "building_id": str(r.building_id) if r.building_id else None,
                    "description": r.description,
                    "description_language": r.description_language,
                    "infrastructure_name": r.infrastructure_name,
                    "captured_at_client": r.captured_at_client.isoformat(),
                    "received_at_server": r.received_at_server.isoformat(),
                    "is_latest_per_building": latest_only,
                },
            }
        )
    fc = {"type": "FeatureCollection", "features": features}
    raw = json.dumps(fc, ensure_ascii=False).encode("utf-8")
    return StreamingResponse(
        iter([raw]),
        media_type="application/geo+json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="export-{crisis_id}-{suffix}.geojson"'},
    )
