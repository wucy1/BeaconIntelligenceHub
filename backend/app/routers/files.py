from pathlib import Path
from urllib.parse import unquote

from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse

from app.config import settings
from app.r2_storage import r2_client, r2_enabled
from app.storage import safe_join

router = APIRouter(prefix="/v1", tags=["files"])


def _has_r2_credentials() -> bool:
    return bool(
        settings.r2_account_id.strip()
        and settings.r2_access_key_id.strip()
        and settings.r2_secret_access_key.strip()
        and settings.r2_bucket.strip()
    )


def _stream_from_r2(safe_key: str) -> Response:
    client = r2_client(settings)
    try:
        obj = client.get_object(Bucket=settings.r2_bucket, Key=safe_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            raise HTTPException(status_code=404, detail="Not found") from exc
        raise HTTPException(status_code=502, detail=f"R2 read failed: {code}") from exc
    body = obj["Body"].read()
    media_type = obj.get("ContentType") or "application/octet-stream"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/files", response_model=None)
def get_file(key: str = Query(..., description="Object storage key")) -> Response:
    """Stream object bytes through API (avoids cross-origin redirect issues in the PWA)."""
    safe_key = unquote(key)

    if r2_enabled(settings):
        return _stream_from_r2(safe_key)

    base = Path(settings.storage_path)
    path = safe_join(base, safe_key)
    if path.is_file():
        return FileResponse(path)

    # Presigned browser PUT may have stored in R2 while API disk (Render) is ephemeral.
    if _has_r2_credentials():
        return _stream_from_r2(safe_key)

    raise HTTPException(status_code=404, detail="Not found")
