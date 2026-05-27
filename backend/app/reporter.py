import hashlib

from app.config import settings


def device_id_header(x_device_id: str | None) -> str | None:
    if not x_device_id or not x_device_id.strip():
        return None
    return x_device_id.strip()[:128]


def reporter_hash_from_device(device_id: str) -> str:
    salt = settings.reporter_salt or "bih-dev-salt"
    return hashlib.sha256(f"{device_id}:{salt}".encode()).hexdigest()
