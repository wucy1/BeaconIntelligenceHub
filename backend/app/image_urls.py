from urllib.parse import quote

from sqlalchemy.orm import Session

from app.config import settings
from app.models import ReportImage
from app.r2_storage import presigned_get, r2_client, r2_enabled


def thumb_url_for_report(db: Session, report_id) -> str | None:
    img = db.query(ReportImage).filter(ReportImage.report_id == report_id).first()
    if not img:
        return None
    return thumb_url_for_object_key(img.object_key)


def thumb_url_for_object_key(object_key: str) -> str:
    ttl = min(settings.upload_token_ttl_seconds, 3600)
    if r2_enabled(settings):
        client = r2_client(settings)
        return presigned_get(client, settings.r2_bucket, object_key, ttl)
    return f"{settings.public_base_url.rstrip('/')}/v1/files?key={quote(object_key, safe='')}"
