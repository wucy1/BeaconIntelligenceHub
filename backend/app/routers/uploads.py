import secrets
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Crisis
from botocore.exceptions import ClientError

from app.r2_storage import browser_uploads_to_r2, presigned_put, r2_client, r2_enabled
from app.schemas import PresignResponse
from app.storage import safe_join

router = APIRouter(prefix="/v1/uploads", tags=["uploads"])

# Dev-only in-memory upload sessions (Phase 1). Replace with signed JWT or Redis for production.
_tokens: dict[str, dict] = {}
_r2_put_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="r2-put")
R2_PUT_TIMEOUT_SEC = 20


def _put_object_to_r2(object_key: str, body: bytes, mime: str) -> None:
    client = r2_client(settings)
    client.put_object(
        Bucket=settings.r2_bucket,
        Key=object_key,
        Body=body,
        ContentType=mime,
    )


@router.get("/presign", response_model=PresignResponse)
def presign(
    crisisId: UUID,
    mimeType: str,
    checksumSha256: str,
    size_bytes: int = Query(..., alias="bytes", ge=1, le=50 * 1024 * 1024),
    db: Session = Depends(get_db),
) -> PresignResponse:
    c = db.query(Crisis).filter(Crisis.id == crisisId).first()
    if not c:
        raise HTTPException(status_code=404, detail="Crisis not found")

    ext = ".jpg"
    if "png" in mimeType.lower():
        ext = ".png"
    elif "webp" in mimeType.lower():
        ext = ".webp"
    object_key = f"{crisisId}/{secrets.token_hex(16)}{ext}"

    if browser_uploads_to_r2(settings):
        client = r2_client(settings)
        ttl = settings.upload_token_ttl_seconds
        put_url = presigned_put(client, settings.r2_bucket, object_key, mimeType, ttl)
        return PresignResponse(
            putUrl=put_url,
            objectKey=object_key,
            expiresAt=datetime.now(timezone.utc) + timedelta(seconds=ttl),
        )

    token = secrets.token_urlsafe(32)
    expires_at = time.time() + settings.upload_token_ttl_seconds
    _tokens[token] = {
        "object_key": object_key,
        "mime": mimeType,
        "crisis_id": str(crisisId),
        "exp": expires_at,
        "bytes_max": size_bytes,
    }
    put_url = f"{settings.public_base_url.rstrip('/')}/v1/uploads/receive/{token}"

    return PresignResponse(
        putUrl=put_url,
        objectKey=object_key,
        expiresAt=datetime.fromtimestamp(expires_at, tz=timezone.utc),
    )


@router.put("/receive/{token}")
async def receive_upload(token: str, request: Request) -> Response:
    meta = _tokens.get(token)
    if not meta:
        raise HTTPException(status_code=404, detail="Invalid or expired token")
    if time.time() > meta["exp"]:
        _tokens.pop(token, None)
        raise HTTPException(status_code=410, detail="Token expired")
    body = await request.body()
    if len(body) > meta["bytes_max"] * 2:  # loose guard
        raise HTTPException(status_code=413, detail="Payload too large")

    if r2_enabled(settings):
        try:
            fut = _r2_put_executor.submit(_put_object_to_r2, meta["object_key"], body, meta["mime"])
            fut.result(timeout=R2_PUT_TIMEOUT_SEC)
        except FuturesTimeoutError as exc:
            raise HTTPException(
                status_code=504,
                detail=(
                    "R2 upload timed out from API host. "
                    "Set UPLOAD_VIA_API=false and enable R2 bucket CORS for direct browser upload."
                ),
            ) from exc
        except ClientError as exc:
            raise HTTPException(status_code=502, detail=f"R2 upload failed: {exc}") from exc
    else:
        base = Path(settings.storage_path)
        base.mkdir(parents=True, exist_ok=True)
        dest = safe_join(base, meta["object_key"])
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
    _tokens.pop(token, None)
    return Response(status_code=204)
