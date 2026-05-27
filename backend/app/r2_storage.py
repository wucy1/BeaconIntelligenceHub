"""Cloudflare R2 via S3-compatible API (optional; falls back to local storage when unset)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from app.config import Settings


def r2_client(settings: Settings) -> Any:
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def r2_enabled(settings: Settings) -> bool:
    return bool(
        settings.r2_account_id.strip()
        and settings.r2_access_key_id.strip()
        and settings.r2_secret_access_key.strip()
        and settings.r2_bucket.strip()
    )


def upload_via_api(settings: Settings) -> bool:
    """Browser PUTs to this API; server writes to R2 or local disk (avoids R2 bucket CORS)."""
    if not r2_enabled(settings):
        return True
    if settings.upload_via_api is not None:
        return settings.upload_via_api
    base = settings.public_base_url.lower()
    return "127.0.0.1" in base or "localhost" in base


def browser_uploads_to_r2(settings: Settings) -> bool:
    return r2_enabled(settings) and not upload_via_api(settings)


def object_exists(client: Any, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def presigned_put(client: Any, bucket: str, key: str, mime: str, expires_in: int) -> str:
    return client.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": mime},
        ExpiresIn=expires_in,
        HttpMethod="PUT",
    )


def presigned_get(client: Any, bucket: str, key: str, expires_in: int) -> str:
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires_in,
    )
