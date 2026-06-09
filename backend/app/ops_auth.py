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
from app.models import OpsUser, UserZoneAssignment

ACCOUNT_ROLES = frozenset({"coordinator", "crisis_lead", "system_admin"})
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
    def __init__(self, user: OpsUser, assignments: list[ZoneAssignment]):
        self.user = user
        self.assignments = assignments

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def user_id(self) -> UUID:
        return self.user.id

    @property
    def zone_ids(self) -> list[UUID]:
        return [a.zone_id for a in self.assignments]

    def lead_zone_ids(self) -> list[UUID]:
        return [a.zone_id for a in self.assignments if a.assignment_role == "lead"]

    def is_system_admin(self) -> bool:
        return self.role == "system_admin"

    def sees_all_zones(self) -> bool:
        return self.is_system_admin()

    def can_manage_users(self) -> bool:
        return self.is_system_admin()

    def can_create_zones(self) -> bool:
        return self.is_system_admin()

    def can_delete_zone(self, _zone_id: UUID) -> bool:
        return self.is_system_admin()

    def can_edit_zone(self, zone_id: UUID) -> bool:
        return self.is_system_admin() or zone_id in self.lead_zone_ids()

    def can_run_archive(self) -> bool:
        return self.is_system_admin() or bool(self.lead_zone_ids())

    def can_manage_crisis_meta(self) -> bool:
        return self.is_system_admin() or bool(self.lead_zone_ids())


def _load_assignments(db: Session, user_id: UUID) -> list[ZoneAssignment]:
    return [
        ZoneAssignment(zone_id=row.zone_id, assignment_role=row.assignment_role or "coordinator")
        for row in db.query(UserZoneAssignment).filter(UserZoneAssignment.user_id == user_id).all()
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
    return OpsPrincipal(user=user, assignments=_load_assignments(db, user.id))


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


def require_ops_roles(*roles: str):
    def _dep(principal: OpsPrincipal = Depends(get_ops_principal)) -> OpsPrincipal:
        if principal.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return principal

    return _dep
