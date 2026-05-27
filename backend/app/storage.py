from pathlib import Path

from fastapi import HTTPException


def safe_join(base: Path, object_key: str) -> Path:
    """Prevent path traversal for object storage keys."""
    p = (base / object_key).resolve()
    if not str(p).startswith(str(base.resolve())):
        raise HTTPException(status_code=400, detail="Invalid object key")
    return p
