from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.shape import from_shape
from pydantic import BaseModel, Field
from shapely.geometry import shape
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import OpsUser, Report, UserZoneAssignment, Zone
from app.ops_auth import (
    OpsPrincipal,
    create_access_token,
    get_ops_principal,
    hash_password,
    require_ops_roles,
    verify_password,
)
from app.schemas import OpsReportSummary
from app.validation import site_status_from_appendix
from app.zone_scope import report_ids_in_zones, resolve_zone_filter_ids

router = APIRouter(prefix="/v1/ops", tags=["ops"])


class LoginBody(BaseModel):
    email: str
    password: str


class ZoneCreateBody(BaseModel):
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


def _polygon_from_geojson(geojson: dict[str, Any]):
    g = shape(geojson)
    if g.geom_type != "Polygon":
        raise HTTPException(status_code=422, detail="geom must be a GeoJSON Polygon")
    return from_shape(g, srid=4326)


def _zone_out(db: Session, zone: Zone) -> dict:
    gj = db.execute(
        text("SELECT ST_AsGeoJSON(geom)::json FROM zones WHERE id = :id"),
        {"id": zone.id},
    ).scalar_one()
    return {
        "id": str(zone.id),
        "name": zone.name,
        "description": zone.description,
        "parent_zone_id": str(zone.parent_zone_id) if zone.parent_zone_id else None,
        "geom": gj,
        "created_at": zone.created_at.isoformat() if zone.created_at else None,
        "updated_at": zone.updated_at.isoformat() if zone.updated_at else None,
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
    zone_ids = [
        str(row.zone_id)
        for row in db.query(UserZoneAssignment).filter(UserZoneAssignment.user_id == user.id).all()
    ]
    token = create_access_token(user.id, user.role, user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role,
            "zone_ids": zone_ids,
        },
    }


@router.get("/me")
def ops_me(principal: OpsPrincipal = Depends(get_ops_principal)) -> dict:
    u = principal.user
    return {
        "id": str(u.id),
        "email": u.email,
        "display_name": u.display_name,
        "role": u.role,
        "zone_ids": [str(z) for z in principal.zone_ids],
    }


@router.get("/zones")
def list_zones(
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    q = db.query(Zone).order_by(Zone.name.asc())
    if not principal.sees_all_zones():
        if not principal.zone_ids:
            return {"items": []}
        q = q.filter(Zone.id.in_(principal.zone_ids))
    zones = q.all()
    return {"items": [_zone_out(db, z) for z in zones]}


@router.post("/zones")
def create_zone(
    body: ZoneCreateBody,
    principal: OpsPrincipal = Depends(require_ops_roles("crisis_lead", "system_admin")),
    db: Session = Depends(get_db),
) -> dict:
    if body.parent_zone_id:
        parent = db.query(Zone).filter(Zone.id == body.parent_zone_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="parent_zone_id not found")
    zone = Zone(
        name=body.name.strip(),
        description=body.description,
        parent_zone_id=body.parent_zone_id,
        geom=_polygon_from_geojson(body.geom),
    )
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return _zone_out(db, zone)


@router.patch("/zones/{zone_id}")
def patch_zone(
    zone_id: UUID,
    body: ZonePatchBody,
    principal: OpsPrincipal = Depends(require_ops_roles("crisis_lead", "system_admin")),
    db: Session = Depends(get_db),
) -> dict:
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    if body.name is not None:
        zone.name = body.name.strip()
    if body.description is not None:
        zone.description = body.description
    if body.parent_zone_id is not None:
        zone.parent_zone_id = body.parent_zone_id
    if body.geom is not None:
        zone.geom = _polygon_from_geojson(body.geom)
    zone.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(zone)
    return _zone_out(db, zone)


@router.delete("/zones/{zone_id}")
def delete_zone(
    zone_id: UUID,
    principal: OpsPrincipal = Depends(require_ops_roles("crisis_lead", "system_admin")),
    db: Session = Depends(get_db),
) -> dict:
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    db.delete(zone)
    db.commit()
    return {"ok": True}


@router.get("/reports")
def ops_list_reports(
    crisis_id: UUID,
    zone_id: UUID | None = None,
    captured_from: datetime | None = None,
    captured_to: datetime | None = None,
    limit: int = Query(100, ge=1, le=500),
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    try:
        zone_ids = resolve_zone_filter_ids(principal, zone_id)
    except ValueError as exc:
        if str(exc) == "zone_not_allowed":
            raise HTTPException(status_code=403, detail="Zone not in your assignment") from exc
        raise
    ids = report_ids_in_zones(db, crisis_id, zone_ids, captured_from, captured_to, limit)
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
        )
        for r in rows
    ]
    return {
        "items": items,
        "zone_scope": [str(z) for z in zone_ids] if zone_ids is not None else None,
    }


@router.patch("/reports/{report_id}")
def ops_patch_report(
    report_id: UUID,
    body: OpsReportPatchBody,
    crisis_id: UUID,
    principal: OpsPrincipal = Depends(get_ops_principal),
    db: Session = Depends(get_db),
) -> dict:
    r = db.query(Report).filter(Report.id == report_id, Report.crisis_id == crisis_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    if not principal.sees_all_zones():
        visible = report_ids_in_zones(db, crisis_id, principal.zone_ids, None, None, 500)
        if r.id not in visible:
            raise HTTPException(status_code=403, detail="Report outside your zones")
    if body.reviewed is not None:
        r.admin_reviewed = body.reviewed
    if body.flagged is not None:
        r.admin_flagged = body.flagged
    db.commit()
    return {"ok": True, "id": str(report_id)}


@router.post("/users/{user_id}/zones/{zone_id}")
def assign_user_zone(
    user_id: UUID,
    zone_id: UUID,
    principal: OpsPrincipal = Depends(require_ops_roles("crisis_lead", "system_admin")),
    db: Session = Depends(get_db),
) -> dict:
    user = db.query(OpsUser).filter(OpsUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    existing = (
        db.query(UserZoneAssignment)
        .filter(UserZoneAssignment.user_id == user_id, UserZoneAssignment.zone_id == zone_id)
        .first()
    )
    if not existing:
        db.add(UserZoneAssignment(user_id=user_id, zone_id=zone_id))
        db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/zones/{zone_id}")
def unassign_user_zone(
    user_id: UUID,
    zone_id: UUID,
    principal: OpsPrincipal = Depends(require_ops_roles("crisis_lead", "system_admin")),
    db: Session = Depends(get_db),
) -> dict:
    row = (
        db.query(UserZoneAssignment)
        .filter(UserZoneAssignment.user_id == user_id, UserZoneAssignment.zone_id == zone_id)
        .first()
    )
    if row:
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
