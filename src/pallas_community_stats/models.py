import re
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


class RosterEntryBody(BaseModel):
    qq: Annotated[int, Field(ge=1, le=999_999_999_999)]
    nickname: Annotated[str, Field(default="", max_length=64)] = ""
    online: bool = False
    message_weight: Annotated[int, Field(ge=0, le=10_000_000)] = 0


class HeartbeatBody(BaseModel):
    deployment_id: Annotated[str, Field(min_length=36, max_length=36)]
    ts: int | None = None
    version: Annotated[str, Field(default="", max_length=64)] = ""
    online_bots: Annotated[int, Field(ge=0, le=10_000)] = 0
    catalog_bots: Annotated[int, Field(ge=0, le=10_000)] = 0
    sharded: bool = False
    shard_workers: Annotated[int | None, Field(ge=0, le=256)] = None
    roster_public: bool = False
    roster: Annotated[list[RosterEntryBody], Field(max_length=256)] = Field(default_factory=list)

    @field_validator("deployment_id")
    @classmethod
    def validate_deployment_id(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _UUID_RE.fullmatch(normalized):
            raise ValueError("deployment_id must be a UUID")
        return normalized


class HeartbeatResponse(BaseModel):
    ok: bool = True
    server_ts: int


class StatsResponse(BaseModel):
    deployments_total: int
    deployments_online: int
    bots_online_sum: int
    online_ttl_sec: int
    as_of: str
    deployments_online_sharded: int = 0
    shard_workers_online_sum: int = 0
    corpus: dict[str, int] | None = None


class VersionCount(BaseModel):
    version: str
    count: int


class DeploymentMonitorStats(BaseModel):
    deployments_total: int
    deployments_online: int
    bots_online_sum: int
    catalog_bots_online_sum: int
    deployments_online_sharded: int
    shard_workers_online_sum: int
    active_recent_24h: int
    online_versions: list[VersionCount] = Field(default_factory=list)


class FederationPoolStats(BaseModel):
    members_total: int = 0
    members_online: int = 0
    members_recent_24h: int = 0
    coord_active_deployments: int | None = None


class FederationMonitorStats(FederationPoolStats):
    bootstrap_enabled: bool = False
    federate_id: str | None = None
    coord_redis_configured: bool = False


class CorpusMonitorStats(BaseModel):
    contexts_total: int
    answers_total: int
    answer_hits_sum: int
    enrollments_total: int
    enrollments_online: int
    enrollments_recent_24h: int
    read_enabled_total: int
    contribute_enabled_total: int


class CorpusStatsResponse(BaseModel):
    online_ttl_sec: int
    as_of: str
    corpus: CorpusMonitorStats


class MonitorOverviewResponse(BaseModel):
    online_ttl_sec: int
    as_of: str
    corpus_enabled: bool
    deployments: DeploymentMonitorStats
    corpus: CorpusMonitorStats | None = None
    federation: FederationMonitorStats | None = None


class BubbleBotPublic(BaseModel):
    bot_key: str
    nickname: str
    avatar_url: str
    online: bool
    message_weight: int


class RosterBubbleResponse(BaseModel):
    online_ttl_sec: int
    as_of: str
    bots_total: int
    bots_online: int
    bots: list[BubbleBotPublic]
