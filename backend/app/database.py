from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.config import settings

_connect_args: dict = {}
if settings.database_url.startswith("postgresql"):
    # 避免 DB 不可達時每個 API 請求無限期卡住（前端會一直 Loading）
    is_neon = "neon.tech" in settings.database_url
    _connect_args["connect_timeout"] = 30 if is_neon else 10
    if is_neon:
        _connect_args["sslmode"] = "require"
        _connect_args["keepalives"] = 1
        _connect_args["keepalives_idle"] = 30

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args=_connect_args or None,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
