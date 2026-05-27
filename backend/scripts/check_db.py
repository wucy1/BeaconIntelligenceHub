"""Quick DB connectivity check. Run from backend/: python scripts/check_db.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text

from app.config import settings
from app.db_url import is_placeholder_database_url, normalize_database_url

if is_placeholder_database_url(settings.database_url):
    print("FAILED: DATABASE_URL 仍是範例（USER:PASS / ep-xxxx）。請從 Neon Console 貼真實連線字串。")
    raise SystemExit(1)

url = normalize_database_url(settings.database_url)
print("DATABASE_URL host:", url.split("@")[-1].split("/")[0] if "@" in url else url[:60])

engine = create_engine(url, connect_args={"connect_timeout": 12}, pool_pre_ping=True)
try:
    with engine.connect() as conn:
        v = conn.execute(text("SELECT 1")).scalar()
        postgis = conn.execute(
            text("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis')")
        ).scalar()
        crises = conn.execute(
            text(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'crises')"
            )
        ).scalar()
        print("OK: connected, SELECT 1 =", v)
        print("postgis extension:", bool(postgis))
        print("crises table:", bool(crises))
        if crises:
            n = conn.execute(text("SELECT COUNT(*) FROM crises")).scalar()
            print("crises rows:", n)
except Exception as e:
    print("FAILED:", type(e).__name__, e)
    raise SystemExit(1) from e
