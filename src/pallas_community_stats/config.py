from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
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
    corpus_enabled: bool = Field(default=True, validation_alias="CORPUS_ENABLED")
    corpus_public_api_base: str = Field(default="", validation_alias="CORPUS_PUBLIC_API_BASE")
    corpus_enroll_requires_heartbeat_token: bool = Field(
        default=False,
        validation_alias="CORPUS_ENROLL_REQUIRES_HEARTBEAT_TOKEN",
    )
    corpus_default_read: bool = Field(default=True, validation_alias="CORPUS_DEFAULT_READ")
    corpus_default_contribute: bool = Field(default=True, validation_alias="CORPUS_DEFAULT_CONTRIBUTE")
    corpus_default_merge_strategy: str = Field(default="local_first", validation_alias="CORPUS_DEFAULT_MERGE_STRATEGY")
    corpus_read_rpm: int = Field(default=120, ge=1, le=10_000, validation_alias="CORPUS_READ_RPM")
    corpus_contribute_per_day: int = Field(default=0, ge=0, le=1_000_000, validation_alias="CORPUS_CONTRIBUTE_PER_DAY")
    corpus_token_ttl_sec: int = Field(default=0, ge=0, le=86400 * 366, validation_alias="CORPUS_TOKEN_TTL_SEC")
    bootstrap_enabled: bool = Field(default=False, validation_alias="BOOTSTRAP_ENABLED")
    instance_secret: str = Field(default="", validation_alias="INSTANCE_SECRET")
    bootstrap_ttl_sec: int = Field(default=86400, ge=300, le=86400 * 30, validation_alias="BOOTSTRAP_TTL_SEC")
    federate_id: str = Field(default="", validation_alias="FEDERATE_ID")
    federate_coord_redis_url: str = Field(default="", validation_alias="FEDERATE_COORD_REDIS_URL")
    federate_redis_prefix: str = Field(default="", validation_alias="FEDERATE_REDIS_PREFIX")
    federate_claim_ttl_sec: int = Field(
        default=86400,
        ge=60,
        le=86400 * 7,
        validation_alias="FEDERATE_CLAIM_TTL_SEC",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    from pallas_community_stats.repo_settings import apply_settings_to_environ

    apply_settings_to_environ()
    return Settings()
