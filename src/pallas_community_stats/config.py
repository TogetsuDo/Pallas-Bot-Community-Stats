from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    host: str = Field(default="0.0.0.0", validation_alias="HOST")
    port: int = Field(default=8099, validation_alias="PORT")
    db_path: Path = Field(default=Path("data/stats.db"), validation_alias="DB_PATH")
    heartbeat_token: str = Field(default="", validation_alias="HEARTBEAT_TOKEN")
    online_ttl_sec: int = Field(default=900, ge=60, le=86400, validation_alias="ONLINE_TTL_SEC")
    max_clock_skew_sec: int = Field(default=300, ge=0, le=3600, validation_alias="MAX_CLOCK_SKEW_SEC")


def get_settings() -> Settings:
    return Settings()
