import re

_PLACEHOLDER_MARKERS = ("USER:PASS", "USER:PASSWORD", "ep-xxxx", "@ep-xxxx.")


def is_placeholder_database_url(url: str) -> bool:
    return any(m in url for m in _PLACEHOLDER_MARKERS)


def normalize_database_url(url: str) -> str:
    """Normalize Postgres URLs for SQLAlchemy + psycopg2 (Neon / local)."""
    u = url.strip()
    if u.startswith("postgres://"):
        u = "postgresql+psycopg2://" + u[len("postgres://") :]
    elif u.startswith("postgresql://") and "+psycopg2" not in u:
        u = "postgresql+psycopg2://" + u[len("postgresql://") :]

    # Windows + Neon: channel_binding 常導致連線被伺服器關閉
    u = re.sub(r"([?&])channel_binding=[^&]*&?", r"\1", u)
    u = u.replace("?&", "?").rstrip("?&")

    if "neon.tech" in u:
        if "sslmode=" not in u:
            u += "&sslmode=require" if "?" in u else "?sslmode=require"
        # Neon 冷啟動 + 跨區網路較慢時，預設 5s 易 timeout
        if "connect_timeout=" not in u:
            u += "&connect_timeout=30" if "?" in u else "?connect_timeout=30"

    return u
