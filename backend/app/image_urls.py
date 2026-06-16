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
    # Always route through /v1/files so every image request gets a fresh R2 presign.
    # Direct presigned URLs can expire while markers are cached on the map.
    if r2_enabled(settings):
        return f"{settings.public_base_url.rstrip('/')}/v1/files?key={quote(object_key, safe='')}"
    return f"{settings.public_base_url.rstrip('/')}/v1/files?key={quote(object_key, safe='')}"
