"""M14 duplicate heuristic — warn, do not block."""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import Report

DUPLICATE_WINDOW_MINUTES = 10


def find_possible_duplicate(
    db: Session,
    *,
    crisis_id: UUID,
    building_id: UUID | None,
    reporter_hash: str | None,
    before: datetime | None = None,
) -> Report | None:
    if not building_id or not reporter_hash:
        return None
    cutoff = (before or datetime.now(timezone.utc)) - timedelta(minutes=DUPLICATE_WINDOW_MINUTES)
    return (
        db.query(Report)
        .filter(
            Report.crisis_id == crisis_id,
            Report.building_id == building_id,
            Report.reporter_hash == reporter_hash,
            Report.received_at_server >= cutoff,
        )
        .order_by(Report.received_at_server.desc())
        .first()
    )
