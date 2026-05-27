from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse, RedirectResponse

from app.config import settings
from app.r2_storage import presigned_get, r2_client, r2_enabled
from app.storage import safe_join

router = APIRouter(prefix="/v1", tags=["files"])


@router.get("/files", response_model=None)
def get_file(key: str = Query(..., description="Object storage key")) -> Response:
    """Serve stored object by object_key (local dev) or redirect to R2 presigned GET."""
    if r2_enabled(settings):
        client = r2_client(settings)
        safe_key = unquote(key)
        url = presigned_get(client, settings.r2_bucket, safe_key, settings.upload_token_ttl_seconds)
        return RedirectResponse(url=url, status_code=307)

    base = Path(settings.storage_path)
    path = safe_join(base, key)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path)
