from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class OrgSettingsRow:
    default_public_report_months: int
    default_ops_view_months: int
    show_demo_cold_start_hint: bool


def get_org_settings(db: Session) -> OrgSettingsRow:
    row = db.execute(
        text(
            """
            SELECT default_public_report_months, default_ops_view_months, show_demo_cold_start_hint
            FROM org_settings
            ORDER BY updated_at DESC
            LIMIT 1
            """
        )
    ).mappings().first()
    if not row:
        return OrgSettingsRow(2, 2, True)
    return OrgSettingsRow(
        int(row["default_public_report_months"]),
        int(row["default_ops_view_months"]),
        bool(row["show_demo_cold_start_hint"]),
    )


def effective_capture_window(
    *,
    months: int,
    event_start: datetime | None,
    event_end: datetime | None,
    now: datetime | None = None,
) -> tuple[datetime, datetime]:
    current = now or datetime.now(timezone.utc)
    start = current - timedelta(days=months * 30)
    end = current
    if event_start is not None and event_start <= current and event_start > start:
        start = event_start
    if event_end is not None and event_end < end:
        end = event_end
    return start, end
