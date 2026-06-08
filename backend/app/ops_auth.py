from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Header
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import OpsUser, UserZoneAssignment

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

OPS_ROLES = frozenset({"coordinator", "crisis_lead", "system_admin"})


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


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
    def __init__(self, user: OpsUser, zone_ids: list[UUID]):
        self.user = user
        self.zone_ids = zone_ids

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def user_id(self) -> UUID:
        return self.user.id

    def can_manage_zones(self) -> bool:
        return self.role in ("crisis_lead", "system_admin")

    def can_manage_users(self) -> bool:
        return self.role == "system_admin"

    def sees_all_zones(self) -> bool:
        return self.role in ("crisis_lead", "system_admin")


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
    zone_ids = [
        row.zone_id
        for row in db.query(UserZoneAssignment)
        .filter(UserZoneAssignment.user_id == user.id)
        .all()
    ]
    return OpsPrincipal(user=user, zone_ids=zone_ids)


def require_ops_roles(*roles: str):
    def _dep(principal: OpsPrincipal = Depends(get_ops_principal)) -> OpsPrincipal:
        if principal.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return principal

    return _dep
