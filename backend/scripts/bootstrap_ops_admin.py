#!/usr/bin/env python3
"""Create the first system_admin ops user when the table is empty."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.models import OpsUser  # noqa: E402
from app.ops_auth import hash_password  # noqa: E402


def main() -> int:
    if not settings.ops_bootstrap_password:
        print("Set OPS_BOOTSTRAP_PASSWORD in backend/.env", file=sys.stderr)
        return 1
    if not settings.ops_jwt_secret:
        print("Set OPS_JWT_SECRET in backend/.env", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        if db.query(OpsUser).count() > 0:
            print("ops_users already has rows; skipping bootstrap.")
            return 0
        email = settings.ops_bootstrap_email.strip().lower()
        user = OpsUser(
            email=email,
            password_hash=hash_password(settings.ops_bootstrap_password),
            display_name=settings.ops_bootstrap_display_name,
            role="system_admin",
        )
        db.add(user)
        db.commit()
        print(f"Created system_admin: {email}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
