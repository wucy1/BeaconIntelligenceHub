from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.config import settings
from app.database import engine
from app.db_url import is_placeholder_database_url
from app.routers import admin, analytics, buildings, crises, export, files, health, ops, public, reports, uploads

@asynccontextmanager
async def lifespan(_app: FastAPI):
    if is_placeholder_database_url(settings.database_url):
        print(
            "\n[BIH] ERROR: DATABASE_URL 仍是範例（USER:PASS / ep-xxxx）。\n"
            "       請到 Neon Console → Connection details 複製「Pooled connection」\n"
            "       貼到 backend/.env 的 DATABASE_URL= 那一行，然後重啟 uvicorn。\n"
        )
    else:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("[BIH] Database connection OK")
        except Exception as exc:
            print(f"[BIH] WARNING: Database not reachable at startup: {exc}")
    yield


app = FastAPI(
    title="Beacon Intelligence Hub (BIH) API",
    version="0.1.0",
    contact={"name": "BIH Team", "email": "info@crointel.com"},
    lifespan=lifespan,
)


def _db_error_hint() -> str:
    url = settings.database_url
    if "127.0.0.1" in url or "localhost" in url:
        return (
            "本機 Postgres 未在 5432 監聽。請在專案根目錄執行：docker compose up -d "
            "（或改 .env 的 DATABASE_URL 為 Neon 連線字串）。"
        )
    if "neon.tech" in url:
        return (
            "Neon 連線失敗。若為 timeout：多半是本機網路無法連到 AWS:5432（公司防火牆／地區限制），"
            "可改用手機熱點、VPN，或開發期先用 docker compose up -d 本機 PostGIS。"
            "若網路正常：到 Neon Console 喚醒專案、用 pooled 連線字串，並在 SQL Editor 執行 init.sql。"
        )
    return "請檢查 backend/.env 的 DATABASE_URL 是否正確，且資料庫已啟動並已套用 schema。"


def _db_error_response(exc: BaseException) -> JSONResponse:
    if is_placeholder_database_url(settings.database_url):
        hint = (
            "DATABASE_URL 仍是範例佔位符（USER:PASS / ep-xxxx）。"
            "請開啟 Neon Console → 你的專案 → Connect → 複製 Pooled connection string，"
            "整行貼到 backend/.env，覆蓋 DATABASE_URL=..."
        )
    else:
        hint = _db_error_hint()
    orig = getattr(exc, "orig", exc)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database unavailable",
            "error": str(orig),
            "hint": hint,
        },
    )


@app.exception_handler(OperationalError)
async def database_unavailable(_request: Request, exc: OperationalError) -> JSONResponse:
    return _db_error_response(exc)


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_unavailable(_request: Request, exc: SQLAlchemyError) -> JSONResponse:
    return _db_error_response(exc)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(public.router)
app.include_router(crises.router)
app.include_router(uploads.router)
app.include_router(files.router)
app.include_router(reports.router)
app.include_router(buildings.router)
app.include_router(export.router)
app.include_router(analytics.router)
app.include_router(admin.router)
app.include_router(ops.router)
