from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator

from pallas_community_stats.models import _UUID_RE

CorpusOp = Literal["upsert_answer", "insert"]


class CorpusEnrollBody(BaseModel):
    deployment_id: Annotated[str, Field(min_length=36, max_length=36)]
    display_name: Annotated[str, Field(default="", max_length=128)] = ""

    @field_validator("deployment_id")
    @classmethod
    def validate_deployment_id(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _UUID_RE.fullmatch(normalized):
            raise ValueError("deployment_id must be a UUID")
        return normalized


class CorpusPolicy(BaseModel):
    read: bool = True
    contribute: bool = False
    merge_strategy: str = "local_first"
    read_rpm: int = 120
    contribute_per_day: int = 0


class CorpusEnrollResponse(BaseModel):
    corpus_token: str
    api_base: str
    policy: CorpusPolicy
    expires_at: int | None = None


class CorpusAnswerBody(BaseModel):
    keywords: str
    group_id: int = 0
    count: int = 1
    time: int = 0
    messages: list[str] = Field(default_factory=list)


class CorpusContextResponse(BaseModel):
    keywords: str
    time: int
    trigger_count: int
    clear_time: int = 0
    answers: list[CorpusAnswerBody]
    ban: list[dict[str, Any]] = Field(default_factory=list)


class CorpusContributeBody(BaseModel):
    op: CorpusOp
    keywords: str | None = None
    group_id: int = 0
    answer_keywords: str | None = None
    answer_time: int | None = None
    message: str | None = None
    append_on_existing: bool = True
    deployment_id: str | None = None
    context: dict[str, Any] | None = None

    @field_validator("deployment_id")
    @classmethod
    def validate_optional_deployment_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not _UUID_RE.fullmatch(normalized):
            raise ValueError("deployment_id must be a UUID")
        return normalized


class CorpusContributeResponse(BaseModel):
    ok: bool = True
    accepted: bool = True


class CorpusUsageResponse(BaseModel):
    deployment_id: str
    read_lookups: int = 0
    read_hits: int = 0
    contribute_ok: int = 0
    updated_at: int | None = None


HotCorpusPeriod = Literal["day", "week", "month"]


class HotCorpusAnswer(BaseModel):
    answer_keywords: str
    message: str = ""
    count: int = 0


class HotCorpusItem(BaseModel):
    keywords: str
    score: int
    answers: list[HotCorpusAnswer] = Field(default_factory=list)


class CorpusHotResponse(BaseModel):
    period: HotCorpusPeriod
    window_sec: int
    as_of: str
    items: list[HotCorpusItem] = Field(default_factory=list)
