from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health_live() -> HealthResponse:
    """Render liveness：立即回 200，不連資料庫（冷啟動／Neon 喚醒可能 >5s）。"""
    return HealthResponse(ok=True)


@router.get("/health/ready", response_model=HealthResponse)
def health_ready(db: Session = Depends(get_db)) -> HealthResponse:
    """深度健康檢查：驗證 DB 與 PostGIS（手動監控用，勿設為 Render health check）。"""
    row = db.execute(text("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')")).scalar()
    return HealthResponse(ok=True, postgis=bool(row))
