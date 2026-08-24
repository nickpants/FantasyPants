from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "GridironAI"
    sleeper_base_url: str = "https://api.sleeper.app/v1"
    database_url: str = f"sqlite+aiosqlite:///{DATA_DIR / 'gridiron.db'}"
    redis_url: str | None = None
    rate_limit_per_minute: int = 1000
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )
    xai_api_key: str | None = None
    grok_code_xai_api_key: str | None = None
    grok_api_key: str | None = None
    xai_base_url: str = "https://api.x.ai/v1"
    xai_model: str = "grok-4.6"
    player_cache_ttl_seconds: int = 60 * 60 * 24
    nfl_state_ttl_seconds: int = 5 * 60
    projection_ttl_seconds: int = 30 * 60
    nflverse_enabled: bool = True
    nflverse_ttl_seconds: int = 6 * 60 * 60
    monte_carlo_iterations: int = 10_000

    @field_validator(
        "redis_url",
        "xai_api_key",
        "grok_code_xai_api_key",
        "grok_api_key",
        mode="before",
    )
    @classmethod
    def empty_optional_is_none(cls, value: str | None) -> str | None:
        if value is None or str(value).strip() == "":
            return None
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return Settings()
