from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.shape import from_shape
from pydantic import BaseModel, Field
from shapely.geometry import shape
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.archive_logic import (
    count_linked_in_scope,
    report_ids_for_archive,
    report_ids_to_unlink,
)

_ARCHIVE_UNLINK_LIMIT = 50_000
from app.database import get_db
from app.ops_reports_query import (
    report_ids_all_scoped,
    report_ids_for_crisis_browse,
    report_ids_for_crisis_scoped,
    report_ids_unspecified_scoped,
)
from app.org_settings import get_org_settings
from app.models import (
    Crisis,
    CrisisLeadAssignment,
    OpsAuditLog,
    OpsSavedReport,
    OpsUser,
    Report,
    ReportCrisisLink,
    UserZoneAssignment,
    Zone,
)
from app.ops_audit import log_ops_action
from app.ops_auth import (
    OpsPrincipal,
    create_access_token,
    get_ops_principal,
    hash_password,
    require_archive_permission,
    require_system_admin,
    verify_password,
)
from app.schemas import OpsReportSummary
from app.validation import site_status_from_appendix
from app.zone_scope import principal_can_access_report, resolve_zone_filter_ids

router = APIRouter(prefix="/v1/ops", tags=["ops"])


class LoginBody(BaseModel):
    email: str
    password: str


class ZoneCreateBody(BaseModel):
    crisis_id: UUID
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    parent_zone_id: UUID | None = None
    geom: dict[str, Any]


class ZonePatchBody(BaseModel):
    name: str | None = None
    description: str | None = None
    parent_zone_id: UUID | None = None
    geom: dict[str, Any] | None = None


class OpsReportPatchBody(BaseModel):
    reviewed: bool | None = None
    flagged: bool | None = None


class CrisisCreateBody(BaseModel):
    slug: str = Field(..., min_length=1, max_length=80)
    name: dict[str, str]
    archive_status: str = "draft"
    archive_window_start: datetime | None = None
    archive_window_end: datetime | None = None


class CrisisPatchBody(BaseModel):
    slug: str | None = None
    name: dict[str, str] | None = None
    archive_status: str | None = None
    archive_window_start: datetime | None = None
    archive_window_end: datetime | None = None


class ArchiveRunBody(BaseModel):
    limit: int = Field(500, ge=1, le=2000)
    unlink_out_of_scope: bool = True


class ZoneSnapshotBody(BaseModel):
    zone_id: UUID | None = None
    name: str
    geom: dict[str, Any]


class SavedReportCreateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    report_view: str = Field("crisis", pattern="^(crisis|unspecified|all)$")
    crisis_id: UUID | None = None
    zone_id: UUID | None = None
    browse_from: datetime | None = None
    browse_to: datetime | None = None
    review_filter: str = Field("all", pattern="^(all|pending|flagged|reviewed)$")
    snapshot_total: int | None = None
    snapshot_linked: int | None = None
    snapshot_candidate: int | None = None
    zone_snapshots: list[ZoneSnapshotBody] | None = None


class ProfilePatchBody(BaseModel):
    display_name: str | None = None
    locale: str | None = None
    phone: str | None = None
    title: str | None = None
    org_unit: str | None = None


class PasswordChangeBody(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)


class BatchReviewBody(BaseModel):
    report_ids: list[UUID]
    reviewed: bool | None = None
    flagged: bool | None = None


class UserCreateBody(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    display_name: str | None = None
    role: str = "coordinator"


class UserPatchBody(BaseModel):
    display_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8)


class ZoneAssignBody(BaseModel):
    assignment_role: str = "coordinator"


def _polygon_from_geojson(geojson: dict[str, Any]):
    g = shape(geojson)
    if g.geom_type != "Polygon":
        raise HTTPException(status_code=422, detail="geom must be a GeoJSON Polygon")
    return from_shape(g, srid=4326)


def _is_system_unspecified(crisis: Crisis) -> bool:
    return crisis.slug == "unspecified"


def _crisis_out(c: Crisis) -> dict:
    return {
        "id": str(c.id),
        "slug": c.slug,
        "name": c.name,
        "is_system": _is_system_unspecified(c),
        "archive_status": c.archive_status,
        "archive_window_start": c.archive_window_start.isoformat() if c.archive_window_start else None,
        "archive_window_end": c.archive_window_end.isoformat() if c.archive_window_end else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _zone_out(db: Session, zone: Zone) -> dict:
    gj = db.execute(
        text("SELECT ST_AsGeoJSON(geom)::json FROM zones WHERE id = :id"),
        {"id": zone.id},
    ).scalar_one()
    return {
        "id": str(zone.id),
        "crisis_id": str(zone.crisis_id) if zone.crisis_id else None,
        "name": zone.name,
        "description": zone.description,
        "parent_zone_id": str(zone.parent_zone_id) if zone.parent_zone_id else None,
        "geom": gj,
        "created_at": zone.created_at.isoformat() if zone.created_at else None,
        "updated_at": zone.updated_at.isoformat() if zone.updated_at else None,
    }


def _zone_assignments_payload(db: Session, user_id: UUID) -> list[dict]:
    rows = (
        db.query(UserZoneAssignment, Zone.name, Zone.crisis_id, Crisis.slug, Crisis.name)
        .join(Zone, Zone.id == UserZoneAssignment.zone_id)
        .outerjoin(Crisis, Crisis.id == Zone.crisis_id)
        .filter(UserZoneAssignment.user_id == user_id)
        .all()
    )
    return [
        {
            "zone_id": str(a.zone_id),
            "zone_name": name,
            "crisis_id": str(cid) if cid else None,
            "crisis_slug": slug,
            "crisis_name": cname,
            "assignment_role": a.assignment_role or "coordinator",
        }
        for a, name, cid, slug, cname in rows
    ]


def _crisis_leads_payload(db: Session, user_id: UUID) -> list[dict]:
    rows = (
        db.query(CrisisLeadAssignment, Crisis.name, Crisis.slug)
        .join(Crisis, Crisis.id == CrisisLeadAssignment.crisis_id)
        .filter(CrisisLeadAssignment.user_id == user_id)
        .all()
    )
    return [
        {
            "crisis_id": str(a.crisis_id),
            "crisis_slug": slug,
            "crisis_name": name,
        }
        for a, name, slug in rows
    ]


def _user_out(db: Session, user: OpsUser) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "locale": getattr(user, "locale", None),
        "phone": getattr(user, "phone", None),
        "title": getattr(user, "title", None),
        "org_unit": getattr(user, "org_unit", None),
        "role": user.role,
        "is_active": bool(user.is_active),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "zone_assignments": _zone_assignments_payload(db, user.id),
        "crisis_lead_assignments": _crisis_leads_payload(db, user.id),
    }


def _official_archive_scope(db: Session, crisis: Crisis) -> tuple[datetime | None, datetime | None, list[UUID]]:
    zone_rows = db.query(Zone.id).filter(Zone.crisis_id == crisis.id).all()
    zone_ids = [row[0] for row in zone_rows]
    if not zone_ids:
        raise HTTPException(
            status_code=422,
            detail="Crisis has no zones; create zones before archiving",
        )
    if crisis.archive_status == "draft" and crisis.archive_window_start is None:
        raise HTTPException(
            status_code=422,
            detail="Draft crisis requires archive_window_start before archiving",
        )
    return crisis.archive_window_start, crisis.archive_window_end, zone_ids


def _saved_report_out(row: OpsSavedReport, creator_email: str | None = None) -> dict:
    return {
        "id": str(row.id),
        "name": row.name,
        "created_by": str(row.created_by) if row.created_by else None,
        "creator_email": creator_email,
        "report_view": row.report_view,
        "crisis_id": str(row.crisis_id) if row.crisis_id else None,
        "zone_id": str(row.zone_id) if row.zone_id else None,
        "browse_from": row.browse_from.isoformat() if row.browse_from else None,
        "browse_to": row.browse_to.isoformat() if row.browse_to else None,
        "review_filter": row.review_filter,
        "snapshot_total": row.snapshot_total,
        "snapshot_linked": row.snapshot_linked,
        "snapshot_candidate": row.snapshot_candidate,
        "zone_snapshots": row.zone_snapshots,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _archive_summary(db: Session, crisis: Crisis) -> dict:
    zone_count = db.query(Zone).filter(Zone.crisis_id == crisis.id).count()
    link_rows = db.execute(
        text(
            """
            SELECT link_source, COUNT(*)::int AS n
            FROM report_crisis_links
            WHERE crisis_id = CAST(:cid AS uuid)
            GROUP BY link_source
            """
        ),
        {"cid": str(crisis.id)},
    ).mappings().all()
    by_source = {r["link_source"]: r["n"] for r in link_rows}
    linked_auto = by_source.get("auto_classify", 0)
    linked_manual = by_source.get("batch_archive", 0)
    linked_total = sum(by_source.values())

    candidate_count = 0
    if zone_count > 0:
        zone_ids = [row[0] for row in db.query(Zone.id).filter(Zone.crisis_id == crisis.id).all()]
        if zone_ids:
            from app.archive_logic import report_ids_for_archive

            candidate_count = len(
                report_ids_for_archive(
                    db,
                    crisis.id,
                    zone_ids,
                    crisis.archive_window_start,
                    crisis.archive_window_end,
                    5000,
                    exclude_already_linked=True,
                )
            )

    last_run = (
        db.query(OpsAuditLog, OpsUser.email)
        .outerjoin(OpsUser, OpsUser.id == OpsAuditLog.actor_user_id)
        .filter(
            OpsAuditLog.action == "crisis.archive_run",
            OpsAuditLog.entity_id == crisis.id,
        )
        .order_by(OpsAuditLog.created_at.desc())
        .first()
    )
    last_manual_at = None
    last_manual_actor = None
    last_manual_detail = None
    if last_run:
        log_row, actor_email = last_run
        last_manual_at = log_row.created_at.isoformat() if log_row.created_at else None
        last_manual_actor = actor_email
        last_manual_detail = log_row.detail

    return {
        "crisis_id": str(crisis.id),
        "archive_status": crisis.archive_status,
        "archive_window_start": crisis.archive_window_start.isoformat()
        if crisis.archive_window_start
        else None,
        "archive_window_end": crisis.archive_window_end.isoformat() if crisis.archive_window_end else None,
        "zone_count": zone_count,
        "linked_total": linked_total,
        "linked_auto": linked_auto,
        "linked_manual": linked_manual,
        "candidate_count": candidate_count,
        "last_manual_archive_at": last_manual_at,
        "last_manual_archive_actor": last_manual_actor,
        "last_manual_archive_detail": last_manual_detail,
    }


def _report_geom_json(db: Session, report_id: UUID, building_id: UUID | None):
    gj = db.execute(
        text("SELECT ST_AsGeoJSON(geom)::json FROM reports WHERE id = :id AND geom IS NOT NULL"),
        {"id": report_id},
    ).scalar_one_or_none()
    if gj:
        return gj
    if building_id:
        return db.execute(
            text("SELECT ST_AsGeoJSON(ST_Centroid(geom))::json FROM buildings WHERE id = :bid"),
            {"bid": building_id},
        ).scalar_one_or_none()
    return None


@router.post("/auth/login")
def ops_login(body: LoginBody, db: Session = Depends(get_db)) -> dict:
    email = body.email.strip().lower()
    user = db.query(OpsUser).filter(OpsUser.email == email, OpsUser.is_active.is_(True)).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    assignments = _zone_assignments_payload(db, user.id)
    token = create_access_token(user.id, user.role, user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role,
            "zone_ids": [a["zone_id"] for a in assignments],
            "zone_assignments": assignments,
            "crisis_lead_assignments": _crisis_leads_payload(db, user.id),
        },
    }


@router.get("/me")
def ops_me(principal: OpsPrincipal = Depends(get_ops_principal)) -> dict:
    u = principal.user
    return {
        "id": str(u.id),
        "email": u.email,
        "display_name": u.display_name,
        "locale": getattr(u, "locale", None),
        "phone": getattr(u, "phone", None),
        "title": getattr(u, "title", None),
        "org_unit": getattr(u, "org_unit", None),
        "role": u.role,
        "zone_ids": [str(z) for z in principal.zone_ids],
        "zone_assignments": [
            {"zone_id": str(a.zone_id), "assignment_role": a.assignment_role}
            for a in principal.assignments
        ],
        "crisis_lead_assignments": [
            {"crisis_id": str(cid)} for cid in principal.crisis_lead_ids
        ],
    }


@router.patch("/me")
def ops_patch_me(
    body: ProfilePatchBody,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(OpsUser).filter(OpsUser.id == principal.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.display_name is not None:
        user.display_name = body.display_name.strip() or None
    if body.locale is not None:
        user.locale = body.locale.strip() or None
    if body.phone is not None:
        user.phone = body.phone.strip() or None
    if body.title is not None:
        user.title = body.title.strip() or None
    if body.org_unit is not None:
        user.org_unit = body.org_unit.strip() or None
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="profile.update",
        entity_type="ops_user",
        entity_id=user.id,
        detail={},
    )
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.patch("/me/password")
def ops_change_password(
    body: PasswordChangeBody,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(OpsUser).filter(OpsUser.id == principal.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=422, detail="New password must differ from current password")
    user.password_hash = hash_password(body.new_password)
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="password.change",
        entity_type="ops_user",
        entity_id=user.id,
        detail={},
    )
    db.commit()
    return {"ok": True}


@router.get("/zones")
def list_zones(
    crisis_id: UUID | None = None,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    q = db.query(Zone).order_by(Zone.name.asc())
    if crisis_id is not None:
        q = q.filter(Zone.crisis_id == crisis_id)
    if principal.is_system_admin():
        pass
    elif principal.crisis_lead_ids:
        from sqlalchemy import or_

        clauses = [Zone.crisis_id.in_(principal.crisis_lead_ids)]
        if principal.zone_ids:
            clauses.append(Zone.id.in_(principal.zone_ids))
        q = q.filter(or_(*clauses))
    else:
        if not principal.zone_ids:
            return {"items": []}
        q = q.filter(Zone.id.in_(principal.zone_ids))
    zones = q.all()
    return {"items": [_zone_out(db, z) for z in zones]}


@router.post("/zones")
def create_zone(
    body: ZoneCreateBody,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    if not principal.can_create_zones(body.crisis_id):
        raise HTTPException(status_code=403, detail="Cannot create zones for this crisis")
    crisis = db.query(Crisis).filter(Crisis.id == body.crisis_id).first()
    if not crisis:
        raise HTTPException(status_code=404, detail="crisis_id not found")
    if _is_system_unspecified(crisis):
        raise HTTPException(status_code=422, detail="Cannot create zones on system unspecified crisis")
    if body.parent_zone_id:
        parent = db.query(Zone).filter(Zone.id == body.parent_zone_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="parent_zone_id not found")
    zone = Zone(
        crisis_id=body.crisis_id,
        name=body.name.strip(),
        description=body.description,
        parent_zone_id=body.parent_zone_id,
        geom=_polygon_from_geojson(body.geom),
    )
    db.add(zone)
    try:
        db.flush()
        log_ops_action(
            db,
            actor_user_id=principal.user_id,
            action="zone.create",
            entity_type="zone",
            entity_id=zone.id,
            detail={"name": zone.name, "crisis_id": str(body.crisis_id)},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not create zone") from exc
    db.refresh(zone)
    return _zone_out(db, zone)


@router.patch("/zones/{zone_id}")
def patch_zone(
    zone_id: UUID,
    body: ZonePatchBody,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    if not principal.can_edit_zone(zone.crisis_id):
        raise HTTPException(status_code=403, detail="Cannot edit this zone")
    if body.name is not None:
        zone.name = body.name.strip()
    if body.description is not None:
        zone.description = body.description
    if body.parent_zone_id is not None:
        zone.parent_zone_id = body.parent_zone_id
    if body.geom is not None:
        zone.geom = _polygon_from_geojson(body.geom)
    zone.updated_at = datetime.utcnow()
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="zone.update",
        entity_type="zone",
        entity_id=zone.id,
        detail={"name": zone.name},
    )
    db.commit()
    db.refresh(zone)
    return _zone_out(db, zone)


@router.delete("/zones/{zone_id}")
def delete_zone(
    zone_id: UUID,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    if not principal.can_delete_zone(zone.crisis_id):
        raise HTTPException(status_code=403, detail="Cannot delete this zone")
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="zone.delete",
        entity_type="zone",
        entity_id=zone_id,
        detail={"name": zone.name},
    )
    db.delete(zone)
    db.commit()
    return {"ok": True}


@router.get("/crises")
def ops_list_crises(
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    q = db.query(Crisis).order_by(Crisis.created_at.desc())
    visible = principal.visible_crisis_ids()
    if visible is not None:
        crisis_ids = set(visible)
        if principal.zone_ids:
            for (cid,) in db.query(Zone.crisis_id).filter(Zone.id.in_(principal.zone_ids)).distinct():
                if cid:
                    crisis_ids.add(cid)
        if not crisis_ids:
            return {"items": []}
        q = q.filter(Crisis.id.in_(list(crisis_ids)))
    rows = q.all()
    return {"items": [_crisis_out(c) for c in rows]}


@router.post("/crises")
def ops_create_crisis(
    body: CrisisCreateBody,
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    if body.archive_status not in ("draft", "active", "archived"):
        raise HTTPException(status_code=422, detail="Invalid archive_status")
    crisis = Crisis(
        slug=body.slug.strip(),
        name=body.name,
        archive_status=body.archive_status,
        archive_window_start=body.archive_window_start,
        archive_window_end=body.archive_window_end,
    )
    db.add(crisis)
    try:
        db.flush()
        log_ops_action(
            db,
            actor_user_id=principal.user_id,
            action="crisis.create",
            entity_type="crisis",
            entity_id=crisis.id,
            detail={"slug": crisis.slug},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Crisis slug already exists") from exc
    db.refresh(crisis)
    return _crisis_out(crisis)


@router.patch("/crises/{crisis_id}")
def ops_patch_crisis(
    crisis_id: UUID,
    body: CrisisPatchBody,
    principal: OpsPrincipal = Depends(require_archive_permission()),
    db: Session = Depends(get_db),
) -> dict:
    crisis = db.query(Crisis).filter(Crisis.id == crisis_id).first()
    if not crisis:
        raise HTTPException(status_code=404, detail="Crisis not found")
    if not principal.can_manage_crisis(crisis_id):
        raise HTTPException(status_code=403, detail="Cannot manage this crisis")
    if _is_system_unspecified(crisis):
        raise HTTPException(status_code=422, detail="System unspecified crisis cannot be edited")
    if body.slug is not None:
        crisis.slug = body.slug.strip()
    if body.name is not None:
        crisis.name = body.name
    if body.archive_status is not None:
        if body.archive_status not in ("draft", "active", "archived"):
            raise HTTPException(status_code=422, detail="Invalid archive_status")
        crisis.archive_status = body.archive_status
    if body.archive_window_start is not None:
        crisis.archive_window_start = body.archive_window_start
    if body.archive_window_end is not None:
        crisis.archive_window_end = body.archive_window_end
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="crisis.update",
        entity_type="crisis",
        entity_id=crisis.id,
        detail={"slug": crisis.slug, "archive_status": crisis.archive_status},
    )
    db.commit()
    db.refresh(crisis)
    return _crisis_out(crisis)


@router.post("/crises/{crisis_id}/archive-preview")
def ops_archive_preview(
    crisis_id: UUID,
    body: ArchiveRunBody,
    principal: OpsPrincipal = Depends(require_archive_permission()),
    db: Session = Depends(get_db),
) -> dict:
    crisis = db.query(Crisis).filter(Crisis.id == crisis_id).first()
    if not crisis:
        raise HTTPException(status_code=404, detail="Crisis not found")
    if _is_system_unspecified(crisis):
        raise HTTPException(status_code=422, detail="System unspecified crisis cannot be archived")
    if not principal.can_run_archive(crisis_id):
        raise HTTPException(status_code=403, detail="Cannot archive this crisis")
    win_start, win_end, zone_ids = _official_archive_scope(db, crisis)
    to_link = report_ids_for_archive(
        db,
        crisis_id,
        zone_ids,
        win_start,
        win_end,
        body.limit,
        exclude_already_linked=True,
    )
    to_unlink = (
        report_ids_to_unlink(
            db,
            crisis_id,
            zone_ids,
            win_start,
            win_end,
            _ARCHIVE_UNLINK_LIMIT,
        )
        if body.unlink_out_of_scope
        else []
    )
    linked_in_scope = count_linked_in_scope(db, crisis_id, zone_ids, win_start, win_end)
    total_linked = db.query(ReportCrisisLink).filter(ReportCrisisLink.crisis_id == crisis_id).count()
    return {
        "crisis_id": str(crisis_id),
        "matched_count": len(to_link),
        "unlinked_count": len(to_unlink),
        "unlink_out_of_scope": body.unlink_out_of_scope,
        "linked_in_scope_count": linked_in_scope,
        "sample_report_ids": [str(i) for i in to_link[:20]],
        "sample_unlink_report_ids": [str(i) for i in to_unlink[:20]],
        "already_linked_count": total_linked,
        "archive_window_start": win_start.isoformat() if win_start else None,
        "archive_window_end": win_end.isoformat() if win_end else None,
        "zone_ids": [str(z) for z in zone_ids],
        "zone_count": len(zone_ids),
    }


@router.post("/crises/{crisis_id}/archive-run")
def ops_archive_run(
    crisis_id: UUID,
    body: ArchiveRunBody,
    principal: OpsPrincipal = Depends(require_archive_permission()),
    db: Session = Depends(get_db),
) -> dict:
    crisis = db.query(Crisis).filter(Crisis.id == crisis_id).first()
    if not crisis:
        raise HTTPException(status_code=404, detail="Crisis not found")
    if _is_system_unspecified(crisis):
        raise HTTPException(status_code=422, detail="System unspecified crisis cannot be archived")
    if not principal.can_run_archive(crisis_id):
        raise HTTPException(status_code=403, detail="Cannot archive this crisis")
    win_start, win_end, zone_ids = _official_archive_scope(db, crisis)
    to_link = report_ids_for_archive(
        db,
        crisis_id,
        zone_ids,
        win_start,
        win_end,
        body.limit,
        exclude_already_linked=True,
    )
    to_unlink = (
        report_ids_to_unlink(
            db,
            crisis_id,
            zone_ids,
            win_start,
            win_end,
            _ARCHIVE_UNLINK_LIMIT,
        )
        if body.unlink_out_of_scope
        else []
    )
    removed = 0
    if to_unlink:
        removed = (
            db.query(ReportCrisisLink)
            .filter(
                ReportCrisisLink.crisis_id == crisis_id,
                ReportCrisisLink.report_id.in_(to_unlink),
            )
            .delete(synchronize_session=False)
        )
    created = 0
    for rid in to_link:
        db.add(
            ReportCrisisLink(
                report_id=rid,
                crisis_id=crisis_id,
                linked_by=principal.user_id,
                link_source="batch_archive",
            )
        )
        created += 1
    if crisis.archive_status == "draft" and created > 0:
        crisis.archive_status = "active"
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="crisis.archive_run",
        entity_type="crisis",
        entity_id=crisis_id,
        detail={
            "linked_count": created,
            "unlinked_count": removed,
            "zone_ids": [str(z) for z in zone_ids],
            "zone_count": len(zone_ids),
            "archive_window_start": win_start.isoformat() if win_start else None,
            "archive_window_end": win_end.isoformat() if win_end else None,
            "unlink_out_of_scope": body.unlink_out_of_scope,
        },
    )
    db.commit()
    return {
        "ok": True,
        "linked_count": created,
        "unlinked_count": removed,
        "crisis_id": str(crisis_id),
        "unlink_out_of_scope": body.unlink_out_of_scope,
    }


@router.get("/audit-log")
def ops_audit_log(
    limit: int = Query(50, ge=1, le=200),
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    rows = (
        db.query(OpsAuditLog)
        .order_by(OpsAuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "items": [
            {
                "id": str(r.id),
                "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": str(r.entity_id) if r.entity_id else None,
                "detail": r.detail,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@router.get("/reports")
def ops_list_reports(
    crisis_id: UUID | None = None,
    view: str = Query("crisis", pattern="^(crisis|unspecified|all)$"),
    zone_id: UUID | None = None,
    captured_from: datetime | None = None,
    captured_to: datetime | None = None,
    reviewed_only: bool | None = None,
    saved_report_id: UUID | None = None,
    limit: int = Query(100, ge=1, le=500),
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    link_status_map: dict[UUID, str] = {}
    saved_name: str | None = None
    geom_snapshots: list | None = None
    if saved_report_id is not None:
        saved = db.query(OpsSavedReport).filter(OpsSavedReport.id == saved_report_id).first()
        if not saved:
            raise HTTPException(status_code=404, detail="Saved report not found")
        if not principal.can_access_saved_report(saved):
            raise HTTPException(status_code=403, detail="Cannot access this saved report")
        saved_name = saved.name
        view = saved.report_view
        crisis_id = saved.crisis_id
        captured_from = saved.browse_from
        captured_to = saved.browse_to
        geom_snapshots = saved.zone_snapshots
        zone_id = saved.zone_id if not geom_snapshots else None
    try:
        zone_ids = resolve_zone_filter_ids(principal, zone_id, crisis_id)
    except ValueError as exc:
        if str(exc) == "zone_not_allowed":
            raise HTTPException(status_code=403, detail="Zone not in your assignment") from exc
        raise
    if view in ("all", "unspecified") and not principal.can_browse_wide_views():
        raise HTTPException(status_code=403, detail="Wide browse views require crisis lead or admin")
    if view == "unspecified":
        ids = report_ids_unspecified_scoped(
            db,
            zone_ids,
            captured_from,
            captured_to,
            limit,
            reviewed_only=reviewed_only,
            geom_snapshots=geom_snapshots,
            crisis_context_id=crisis_id,
        )
    elif view == "all":
        if crisis_id is not None and reviewed_only is None:
            ids, link_status_map = report_ids_for_crisis_browse(
                db,
                crisis_id,
                zone_ids,
                captured_from,
                captured_to,
                limit,
                geom_snapshots=geom_snapshots,
            )
        else:
            ids = report_ids_all_scoped(
                db,
                zone_ids,
                captured_from,
                captured_to,
                limit,
                reviewed_only=reviewed_only,
                geom_snapshots=geom_snapshots,
            )
    elif crisis_id is None:
        raise HTTPException(status_code=422, detail="crisis_id required for view=crisis")
    else:
        ids = report_ids_for_crisis_scoped(
            db,
            crisis_id,
            zone_ids,
            captured_from,
            captured_to,
            limit,
            reviewed_only=reviewed_only,
            geom_snapshots=geom_snapshots,
        )
        link_status_map = {rid: "linked" for rid in ids}
    rows = db.query(Report).filter(Report.id.in_(list(ids))).all() if ids else []
    if rows and ids:
        order = {rid: i for i, rid in enumerate(ids)}
        rows.sort(key=lambda r: order.get(r.id, 9999))
    items = [
        OpsReportSummary(
            id=r.id,
            crisis_id=r.crisis_id,
            building_id=r.building_id,
            damage_level=r.damage_level,
            site_status=site_status_from_appendix(r.appendix_answers),
            captured_at_client=r.captured_at_client,
            received_at_server=r.received_at_server,
            geom=_report_geom_json(db, r.id, r.building_id),
            description_preview=r.description[:120] + ("…" if len(r.description) > 120 else ""),
            admin_reviewed=bool(r.admin_reviewed),
            admin_flagged=bool(r.admin_flagged),
            debris_clearing_required=bool(r.debris_clearing_required),
            crisis_types=list(r.crisis_types or []),
            infrastructure_types=list(r.infrastructure_types or []),
            crisis_link_status=link_status_map.get(r.id) if link_status_map else None,
        )
        for r in rows
    ]
    linked_n = sum(1 for s in link_status_map.values() if s == "linked") if link_status_map else None
    candidate_n = sum(1 for s in link_status_map.values() if s == "candidate") if link_status_map else None
    other_linked_n = sum(1 for s in link_status_map.values() if s == "other_linked") if link_status_map else None
    return {
        "items": items,
        "view": view,
        "saved_report_id": str(saved_report_id) if saved_report_id else None,
        "saved_report_name": saved_name,
        "zone_scope": [str(z) for z in zone_ids] if zone_ids is not None else None,
        "crisis_linked_count": linked_n,
        "crisis_candidate_count": candidate_n,
        "crisis_other_linked_count": other_linked_n,
    }


@router.get("/crises/{crisis_id}/archive-summary")
def ops_crisis_archive_summary(
    crisis_id: UUID,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    crisis = db.query(Crisis).filter(Crisis.id == crisis_id).first()
    if not crisis:
        raise HTTPException(status_code=404, detail="Crisis not found")
    if _is_system_unspecified(crisis):
        raise HTTPException(status_code=422, detail="System unspecified crisis")
    if not principal.can_view_crisis_archive_summary(crisis_id):
        raise HTTPException(status_code=403, detail="Crisis archive summary requires crisis lead or admin")
    return _archive_summary(db, crisis)


@router.post("/reports/batch-review")
def ops_batch_review_reports(
    body: BatchReviewBody,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    if not body.report_ids:
        return {"ok": True, "updated": 0}
    updated = 0
    for rid in body.report_ids:
        if not principal_can_access_report(db, principal, rid):
            continue
        r = db.query(Report).filter(Report.id == rid).first()
        if not r:
            continue
        if body.reviewed is not None:
            r.admin_reviewed = body.reviewed
        if body.flagged is not None:
            r.admin_flagged = body.flagged
        updated += 1
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="report.batch_review",
        entity_type="report",
        entity_id=None,
        detail={"count": updated, "reviewed": body.reviewed, "flagged": body.flagged},
    )
    db.commit()
    return {"ok": True, "updated": updated}


@router.patch("/reports/{report_id}")
def ops_patch_report(
    report_id: UUID,
    body: OpsReportPatchBody,
    crisis_id: UUID | None = None,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    q = db.query(Report).filter(Report.id == report_id)
    if crisis_id is not None:
        q = q.filter(Report.crisis_id == crisis_id)
    r = q.first()
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    if not principal_can_access_report(db, principal, r.id, crisis_id):
        raise HTTPException(status_code=403, detail="Report outside your zones")
    if body.reviewed is not None:
        r.admin_reviewed = body.reviewed
    if body.flagged is not None:
        r.admin_flagged = body.flagged
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="report.review",
        entity_type="report",
        entity_id=report_id,
        detail={"reviewed": body.reviewed, "flagged": body.flagged},
    )
    db.commit()
    return {"ok": True, "id": str(report_id)}


@router.get("/users")
def ops_list_users(
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    users = db.query(OpsUser).order_by(OpsUser.email.asc()).all()
    return {"items": [_user_out(db, u) for u in users]}


@router.get("/users/assignable")
def ops_list_assignable_users(
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    if not principal.is_system_admin() and not principal.crisis_lead_ids:
        raise HTTPException(status_code=403, detail="Not allowed")
    users = (
        db.query(OpsUser)
        .filter(OpsUser.role == "coordinator", OpsUser.is_active.is_(True))
        .order_by(OpsUser.email.asc())
        .all()
    )
    return {
        "items": [
            {"id": str(u.id), "email": u.email, "display_name": u.display_name}
            for u in users
        ]
    }


@router.post("/users")
def ops_create_user(
    body: UserCreateBody,
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    if body.role not in ("coordinator", "system_admin"):
        raise HTTPException(status_code=422, detail="role must be coordinator or system_admin")
    email = body.email.strip().lower()
    if db.query(OpsUser).filter(OpsUser.email == email).first():
        raise HTTPException(status_code=409, detail="Email already exists")
    user = OpsUser(
        email=email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        role=body.role,
    )
    db.add(user)
    try:
        db.flush()
        log_ops_action(
            db,
            actor_user_id=principal.user_id,
            action="user.create",
            entity_type="ops_user",
            entity_id=user.id,
            detail={"email": email, "role": body.role},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already exists") from exc
    db.refresh(user)
    return _user_out(db, user)


@router.patch("/users/{user_id}")
def ops_patch_user(
    user_id: UUID,
    body: UserPatchBody,
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(OpsUser).filter(OpsUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role is not None:
        if body.role not in ("coordinator", "system_admin"):
            raise HTTPException(status_code=422, detail="role must be coordinator or system_admin")
        user.role = body.role
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.password:
        user.password_hash = hash_password(body.password)
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="user.update",
        entity_type="ops_user",
        entity_id=user.id,
        detail={"email": user.email},
    )
    db.commit()
    db.refresh(user)
    return _user_out(db, user)


@router.post("/users/{user_id}/crises/{crisis_id}")
def assign_crisis_lead(
    user_id: UUID,
    crisis_id: UUID,
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(OpsUser).filter(OpsUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "system_admin":
        raise HTTPException(status_code=422, detail="System admin does not need crisis lead assignment")
    crisis = db.query(Crisis).filter(Crisis.id == crisis_id).first()
    if not crisis:
        raise HTTPException(status_code=404, detail="Crisis not found")
    if _is_system_unspecified(crisis):
        raise HTTPException(status_code=422, detail="Cannot assign lead to system unspecified crisis")
    existing = (
        db.query(CrisisLeadAssignment)
        .filter(CrisisLeadAssignment.user_id == user_id, CrisisLeadAssignment.crisis_id == crisis_id)
        .first()
    )
    if not existing:
        db.add(CrisisLeadAssignment(user_id=user_id, crisis_id=crisis_id))
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="user.crisis_lead_assign",
        entity_type="ops_user",
        entity_id=user_id,
        detail={"crisis_id": str(crisis_id)},
    )
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/crises/{crisis_id}")
def unassign_crisis_lead(
    user_id: UUID,
    crisis_id: UUID,
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    row = (
        db.query(CrisisLeadAssignment)
        .filter(CrisisLeadAssignment.user_id == user_id, CrisisLeadAssignment.crisis_id == crisis_id)
        .first()
    )
    if row:
        log_ops_action(
            db,
            actor_user_id=principal.user_id,
            action="user.crisis_lead_unassign",
            entity_type="ops_user",
            entity_id=user_id,
            detail={"crisis_id": str(crisis_id)},
        )
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.post("/users/{user_id}/zones/{zone_id}")
def assign_user_zone(
    user_id: UUID,
    zone_id: UUID,
    body: ZoneAssignBody,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    if body.assignment_role != "coordinator":
        raise HTTPException(
            status_code=422,
            detail="Zone assignment is coordinator only; use crisis lead assignment for leads",
        )
    user = db.query(OpsUser).filter(OpsUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "system_admin":
        raise HTTPException(status_code=422, detail="System admin does not need zone assignments")
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    if not principal.can_assign_coordinator(zone.crisis_id):
        raise HTTPException(status_code=403, detail="Cannot assign coordinator for this zone")
    existing = (
        db.query(UserZoneAssignment)
        .filter(UserZoneAssignment.user_id == user_id, UserZoneAssignment.zone_id == zone_id)
        .first()
    )
    if existing:
        existing.assignment_role = "coordinator"
    else:
        db.add(
            UserZoneAssignment(
                user_id=user_id,
                zone_id=zone_id,
                assignment_role="coordinator",
            )
        )
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="user.zone_assign",
        entity_type="ops_user",
        entity_id=user_id,
        detail={"zone_id": str(zone_id), "assignment_role": "coordinator"},
    )
    db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/zones/{zone_id}")
def unassign_user_zone(
    user_id: UUID,
    zone_id: UUID,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    if not principal.can_assign_coordinator(zone.crisis_id):
        raise HTTPException(status_code=403, detail="Cannot unassign coordinator for this zone")
    row = (
        db.query(UserZoneAssignment)
        .filter(UserZoneAssignment.user_id == user_id, UserZoneAssignment.zone_id == zone_id)
        .first()
    )
    if row:
        log_ops_action(
            db,
            actor_user_id=principal.user_id,
            action="user.zone_unassign",
            entity_type="ops_user",
            entity_id=user_id,
            detail={"zone_id": str(zone_id)},
        )
        db.delete(row)
        db.commit()
    return {"ok": True}


class OrgSettingsPatchBody(BaseModel):
    default_public_report_months: int | None = Field(None, ge=1, le=24)
    default_ops_view_months: int | None = Field(None, ge=1, le=24)
    show_demo_cold_start_hint: bool | None = None


@router.get("/settings")
def ops_get_settings(
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    org = get_org_settings(db)
    return {
        "default_public_report_months": org.default_public_report_months,
        "default_ops_view_months": org.default_ops_view_months,
        "show_demo_cold_start_hint": org.show_demo_cold_start_hint,
    }


@router.patch("/settings")
def ops_patch_settings(
    body: OrgSettingsPatchBody,
    principal: OpsPrincipal = Depends(require_system_admin()),
    db: Session = Depends(get_db),
) -> dict:
    org = get_org_settings(db)
    public_months = body.default_public_report_months or org.default_public_report_months
    ops_months = body.default_ops_view_months or org.default_ops_view_months
    demo_hint = org.show_demo_cold_start_hint if body.show_demo_cold_start_hint is None else body.show_demo_cold_start_hint
    db.execute(
        text(
            """
            UPDATE org_settings
            SET default_public_report_months = :pub,
                default_ops_view_months = :ops,
                show_demo_cold_start_hint = :hint,
                updated_at = now()
            """
        ),
        {"pub": public_months, "ops": ops_months, "hint": demo_hint},
    )
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="settings.update",
        entity_type="org_settings",
        entity_id=None,
        detail={
            "default_public_report_months": public_months,
            "default_ops_view_months": ops_months,
            "show_demo_cold_start_hint": demo_hint,
        },
    )
    db.commit()
    return {
        "default_public_report_months": public_months,
        "default_ops_view_months": ops_months,
        "show_demo_cold_start_hint": demo_hint,
    }


@router.get("/saved-reports")
def ops_list_saved_reports(
    crisis_id: UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    q = (
        db.query(OpsSavedReport, OpsUser.email)
        .outerjoin(OpsUser, OpsUser.id == OpsSavedReport.created_by)
    )
    if crisis_id is not None:
        q = q.filter(OpsSavedReport.crisis_id == crisis_id)
    if principal.is_system_admin():
        pass
    elif principal.crisis_lead_ids:
        from sqlalchemy import or_

        q = q.filter(
            or_(
                OpsSavedReport.crisis_id.in_(principal.crisis_lead_ids),
                OpsSavedReport.created_by == principal.user_id,
            )
        )
    else:
        q = q.filter(OpsSavedReport.created_by == principal.user_id)
    rows = q.order_by(OpsSavedReport.updated_at.desc()).limit(limit).all()
    return {
        "items": [_saved_report_out(row, email) for row, email in rows],
    }


@router.post("/saved-reports")
def ops_create_saved_report(
    body: SavedReportCreateBody,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    if body.report_view == "crisis" and not body.crisis_id:
        raise HTTPException(status_code=422, detail="crisis_id required for crisis view")
    if body.report_view in ("all", "unspecified") and not principal.can_browse_wide_views():
        raise HTTPException(status_code=403, detail="Wide browse views require crisis lead or admin")
    zone_snapshots = None
    if body.zone_snapshots:
        zone_snapshots = [s.model_dump(mode="json") for s in body.zone_snapshots]
    row = OpsSavedReport(
        name=body.name.strip(),
        created_by=principal.user_id,
        report_view=body.report_view,
        crisis_id=body.crisis_id,
        zone_id=body.zone_id,
        browse_from=body.browse_from,
        browse_to=body.browse_to,
        review_filter=body.review_filter,
        snapshot_total=body.snapshot_total,
        snapshot_linked=body.snapshot_linked,
        snapshot_candidate=body.snapshot_candidate,
        zone_snapshots=zone_snapshots,
    )
    db.add(row)
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="saved_report.create",
        entity_type="saved_report",
        entity_id=row.id,
        detail={"name": row.name, "report_view": row.report_view},
    )
    db.commit()
    db.refresh(row)
    return _saved_report_out(row, principal.user.email)


@router.get("/saved-reports/{report_id}")
def ops_get_saved_report(
    report_id: UUID,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    row = db.query(OpsSavedReport).filter(OpsSavedReport.id == report_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Saved report not found")
    if not principal.can_access_saved_report(row):
        raise HTTPException(status_code=403, detail="Cannot access this saved report")
    creator = db.query(OpsUser.email).filter(OpsUser.id == row.created_by).scalar()
    return _saved_report_out(row, creator)


@router.delete("/saved-reports/{report_id}")
def ops_delete_saved_report(
    report_id: UUID,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    row = db.query(OpsSavedReport).filter(OpsSavedReport.id == report_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Saved report not found")
    if row.created_by != principal.user_id and not principal.is_system_admin():
        raise HTTPException(status_code=403, detail="Cannot delete this saved report")
    log_ops_action(
        db,
        actor_user_id=principal.user_id,
        action="saved_report.delete",
        entity_type="saved_report",
        entity_id=report_id,
        detail={"name": row.name},
    )
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/bootstrap-admin")
def bootstrap_admin(db: Session = Depends(get_db)) -> dict:
    """Create first system_admin when OPS_BOOTSTRAP_PASSWORD is set and no users exist."""
    from app.config import settings

    if not settings.ops_bootstrap_password:
        raise HTTPException(status_code=503, detail="OPS_BOOTSTRAP_PASSWORD not configured")
    if db.query(OpsUser).count() > 0:
        raise HTTPException(status_code=409, detail="Users already exist")
    email = settings.ops_bootstrap_email.strip().lower()
    user = OpsUser(
        email=email,
        password_hash=hash_password(settings.ops_bootstrap_password),
        display_name=settings.ops_bootstrap_display_name,
        role="system_admin",
    )
    db.add(user)
    db.commit()
    return {"ok": True, "email": email, "role": "system_admin"}
