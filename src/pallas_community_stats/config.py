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
    # HEARTBEAT_TOKEN 为空时启用：按 IP / deployment_id 限流，供公开自托管写入
    heartbeat_rate_per_ip_per_min: int = Field(
        default=60,
        ge=0,
        le=10_000,
        validation_alias="HEARTBEAT_RATE_PER_IP_PER_MIN",
    )
    heartbeat_min_interval_sec: float = Field(
        default=30.0,
        ge=0.0,
        le=3600.0,
        validation_alias="HEARTBEAT_MIN_INTERVAL_SEC",
    )


def get_settings() -> Settings:
    return Settings()
