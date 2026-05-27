from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import Report
from app.schemas import ReportSummary

router = APIRouter(prefix="/v1/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class AdminPatchBody(BaseModel):
    reviewed: bool | None = None
    flagged: bool | None = None


class AdminReportSummary(ReportSummary):
    admin_reviewed: bool
    admin_flagged: bool


@router.get("/reports")
def admin_list_reports(
    crisis_id: UUID,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> dict:
    rows = (
        db.query(Report)
        .filter(Report.crisis_id == crisis_id)
        .order_by(Report.received_at_server.desc())
        .limit(limit)
        .all()
    )
    items = [
        AdminReportSummary(
            id=r.id,
            crisis_id=r.crisis_id,
            building_id=r.building_id,
            damage_level=r.damage_level,
            captured_at_client=r.captured_at_client,
            received_at_server=r.received_at_server,
            geom=None,
            description_preview=r.description[:120] + ("…" if len(r.description) > 120 else ""),
            admin_reviewed=bool(r.admin_reviewed),
            admin_flagged=bool(r.admin_flagged),
        )
        for r in rows
    ]
    return {"items": items}


@router.patch("/reports/{report_id}")
def admin_patch_report(
    report_id: UUID,
    body: AdminPatchBody,
    db: Session = Depends(get_db),
) -> dict:
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    if body.reviewed is not None:
        r.admin_reviewed = body.reviewed
    if body.flagged is not None:
        r.admin_flagged = body.flagged
    db.commit()
    return {"ok": True, "id": str(report_id)}
