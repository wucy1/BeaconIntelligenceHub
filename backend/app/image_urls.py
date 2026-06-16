from urllib.parse import quote

from sqlalchemy.orm import Session

from app.config import settings
from app.models import ReportImage
from app.r2_storage import r2_enabled


def thumb_url_for_report(db: Session, report_id) -> str | None:
    img = db.query(ReportImage).filter(ReportImage.report_id == report_id).first()
    if not img:
        return None
    return thumb_url_for_object_key(img.object_key)


def thumb_url_for_object_key(object_key: str) -> str:
    # Always use same-origin /v1/files so clients avoid cross-origin image policy issues
    # and each request gets a fresh backend presign for R2.
    _ = r2_enabled(settings)
    return f"/v1/files?key={quote(object_key, safe='')}"
