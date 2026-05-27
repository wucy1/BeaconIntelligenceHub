from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.db_url import normalize_database_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://crisis:crisis@127.0.0.1:5432/crisis"

    @model_validator(mode="after")
    def _normalize_database_url(self) -> "Settings":
        self.database_url = normalize_database_url(self.database_url)
        return self
    storage_path: str = "./storage"
    public_base_url: str = "http://127.0.0.1:8000"
    upload_token_ttl_seconds: int = 3600
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    # Optional Cloudflare R2 (S3 API). When all are set, presign uses R2 PUT; omit for local dev.
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    # None = auto (localhost PUBLIC_BASE_URL → proxy). true/false to force.
    upload_via_api: bool | None = None
    admin_token: str = ""
    reporter_salt: str = "change-me-in-production"
    active_crisis_id: str = ""


settings = Settings()
