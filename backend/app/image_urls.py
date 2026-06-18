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
    """Return /v1/files path; frontend mediaUrl() rewrites to the live API origin."""
    _ = r2_enabled(settings)
    base = settings.public_base_url.rstrip("/")
    if base and "127.0.0.1" not in base and "localhost" not in base:
        return f"{base}/v1/files?key={quote(object_key, safe='')}"
    return f"/v1/files?key={quote(object_key, safe='')}"
