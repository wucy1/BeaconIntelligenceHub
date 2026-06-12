from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import CrisisLeadAssignment, OpsUser, UserZoneAssignment

ZONE_ASSIGNMENT_ROLES = frozenset({"lead", "coordinator"})


@dataclass(frozen=True)
class ZoneAssignment:
    zone_id: UUID
    assignment_role: str


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: UUID, role: str, email: str) -> str:
    if not settings.ops_jwt_secret:
        raise HTTPException(status_code=503, detail="OPS_JWT_SECRET not configured")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "email": email,
        "iat": now,
        "exp": now + timedelta(hours=settings.ops_jwt_ttl_hours),
    }
    return jwt.encode(payload, settings.ops_jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    if not settings.ops_jwt_secret:
        raise HTTPException(status_code=503, detail="OPS_JWT_SECRET not configured")
    try:
        return jwt.decode(token, settings.ops_jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc


class OpsPrincipal:
    def __init__(
        self,
        user: OpsUser,
        zone_assignments: list[ZoneAssignment],
        crisis_lead_ids: list[UUID],
    ):
        self.user = user
        self.assignments = zone_assignments
        self.crisis_lead_ids = crisis_lead_ids

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def user_id(self) -> UUID:
        return self.user.id

    @property
    def zone_ids(self) -> list[UUID]:
        return [a.zone_id for a in self.assignments]

    def is_system_admin(self) -> bool:
        return self.role == "system_admin"

    def is_crisis_lead(self, crisis_id: UUID) -> bool:
        return self.is_system_admin() or crisis_id in self.crisis_lead_ids

    def sees_all_zones(self) -> bool:
        return self.is_system_admin()

    def uses_coordinator_zone_filter(self, crisis_id: UUID | None = None) -> bool:
        """Coordinators are limited to assigned zones; leads/admins use crisis-wide scope."""
        if self.is_system_admin():
            return False
        if crisis_id is not None and self.is_crisis_lead(crisis_id):
            return False
        if not self.zone_ids:
            return False
        return True

    def can_manage_users(self) -> bool:
        return self.is_system_admin()

    def can_manage_crisis(self, crisis_id: UUID) -> bool:
        return self.is_crisis_lead(crisis_id)

    def can_create_zones(self, crisis_id: UUID) -> bool:
        return self.can_manage_crisis(crisis_id)

    def can_edit_zone(self, crisis_id: UUID | None) -> bool:
        if crisis_id is None:
            return self.is_system_admin()
        return self.can_manage_crisis(crisis_id)

    def can_delete_zone(self, crisis_id: UUID | None) -> bool:
        return self.can_edit_zone(crisis_id)

    def can_assign_coordinator(self, crisis_id: UUID | None) -> bool:
        return self.can_edit_zone(crisis_id)

    def can_run_archive(self, crisis_id: UUID | None = None) -> bool:
        if self.is_system_admin():
            return True
        if crisis_id is not None:
            return crisis_id in self.crisis_lead_ids
        return bool(self.crisis_lead_ids)

    def can_browse_wide_views(self) -> bool:
        """view=all / unspecified — Lead and system admin only."""
        return self.is_system_admin() or bool(self.crisis_lead_ids)

    def can_view_crisis_archive_summary(self, crisis_id: UUID) -> bool:
        return self.can_manage_crisis(crisis_id)

    def can_access_saved_report(self, row) -> bool:
        if self.is_system_admin():
            return True
        if row.created_by == self.user_id:
            return True
        if row.crisis_id and self.is_crisis_lead(row.crisis_id):
            return True
        return False

    def visible_crisis_ids(self) -> list[UUID] | None:
        """None = all crises (admin)."""
        if self.is_system_admin():
            return None
        return list(self.crisis_lead_ids)


def _load_zone_assignments(db: Session, user_id: UUID) -> list[ZoneAssignment]:
    return [
        ZoneAssignment(zone_id=row.zone_id, assignment_role=row.assignment_role or "coordinator")
        for row in db.query(UserZoneAssignment).filter(UserZoneAssignment.user_id == user_id).all()
    ]


def _load_crisis_lead_ids(db: Session, user_id: UUID) -> list[UUID]:
    return [
        row.crisis_id
        for row in db.query(CrisisLeadAssignment).filter(CrisisLeadAssignment.user_id == user_id).all()
    ]


def get_ops_principal(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> OpsPrincipal:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_access_token(token)
    user_id = UUID(payload["sub"])
    user = db.query(OpsUser).filter(OpsUser.id == user_id, OpsUser.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return OpsPrincipal(
        user=user,
        zone_assignments=_load_zone_assignments(db, user.id),
        crisis_lead_ids=_load_crisis_lead_ids(db, user.id),
    )


def require_system_admin():
    def _dep(principal: OpsPrincipal = Depends(get_ops_principal)) -> OpsPrincipal:
        if not principal.is_system_admin():
            raise HTTPException(status_code=403, detail="System admin required")
        return principal

    return _dep


def require_archive_permission():
    def _dep(principal: OpsPrincipal = Depends(get_ops_principal)) -> OpsPrincipal:
        if not principal.can_run_archive():
            raise HTTPException(status_code=403, detail="Archive permission required")
        return principal

    return _dep
