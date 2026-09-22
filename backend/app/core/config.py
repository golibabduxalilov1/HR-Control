from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Face ID Workplace"
    secret_key: str = "change-me-in-production"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/faceid"
    redis_url: str = ""
    upload_dir: str = "./uploads"
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    access_token_minutes: int = 60 * 24
    platform_admin_username: str = "platform"
    platform_admin_password: str = "platform"
    default_timezone: str = "Asia/Tashkent"
    hik_poll_seconds: int = 45
    telegram_polling_enabled: bool = Field(default=True)
    scheduler_enabled: bool = Field(default=True)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
