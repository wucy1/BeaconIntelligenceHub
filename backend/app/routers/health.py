from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(db: Session = Depends(get_db)) -> HealthResponse:
    row = db.execute(text("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')")).scalar()
    return HealthResponse(ok=True, postgis=bool(row))
