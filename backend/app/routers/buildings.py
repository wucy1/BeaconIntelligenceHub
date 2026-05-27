from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Report
from app.reporter import device_id_header, reporter_hash_from_device
from app.schemas import ReportSummary
from app.validation import site_status_from_appendix

router = APIRouter(prefix="/v1/buildings", tags=["buildings"])


@router.get("/{building_id}/reports", response_model=list[ReportSummary])
def building_reports(
    building_id: UUID,
    db: Session = Depends(get_db),
    x_device_id: str | None = Header(None, alias="X-Device-Id"),
) -> list[ReportSummary]:
    reporter_hash = None
    did = device_id_header(x_device_id)
    if did:
        reporter_hash = reporter_hash_from_device(did)

    rows = (
        db.query(Report)
        .filter(Report.building_id == building_id)
        .order_by(Report.captured_at_client.desc())
        .all()
    )
    out: list[ReportSummary] = []
    for r in rows:
        gj = None
        if r.geom is not None:
            gj = db.execute(
                text("SELECT ST_AsGeoJSON(geom)::json FROM reports WHERE id = :id"),
                {"id": r.id},
            ).scalar_one()
        out.append(
            ReportSummary(
                id=r.id,
                crisis_id=r.crisis_id,
                building_id=r.building_id,
                damage_level=r.damage_level,
                site_status=site_status_from_appendix(r.appendix_answers),
                captured_at_client=r.captured_at_client,
                received_at_server=r.received_at_server,
                geom=gj,
                description_preview=r.description[:120] + ("…" if len(r.description) > 120 else ""),
                is_mine=bool(reporter_hash and r.reporter_hash == reporter_hash),
            )
        )
    return out
