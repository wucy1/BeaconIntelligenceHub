from fastapi import Header, HTTPException

from app.config import settings


def require_admin(x_admin_token: str | None = Header(None, alias="X-Admin-Token")) -> None:
    if not settings.admin_token:
        raise HTTPException(status_code=503, detail="Admin API not configured (set ADMIN_TOKEN)")
    if not x_admin_token or x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Invalid admin token")
