from __future__ import annotations

from pydantic import BaseModel, Field


class FederationOnboardingStep(BaseModel):
    order: int = Field(ge=1, le=20)
    title: str = ""
    detail: str = ""


class FederationCoordPublic(BaseModel):
    redis_url_display: str = ""
    host: str = ""
    port: int | None = None
    db: int | None = None


class FederationOnboardingResponse(BaseModel):
    schema_version: int = 1
    phase: int = 2
    available: bool = True
    title: str = ""
    summary: str = ""
    bootstrap_enabled: bool = False
    federate_id: str | None = None
    coord: FederationCoordPublic | None = None
    coord_redis_hint: str = ""
    stats_primary_url: str = ""
    stats_fallback_url: str = ""
    stats_failover_note: str = ""
    instance_secret: str | None = None
    instance_secret_label: str = "入池密钥"
    instance_secret_hint: str = ""
    steps: list[FederationOnboardingStep] = Field(default_factory=list)
    ingress_note: str = ""
    config_section_id: str = "control_plane"
    as_of: str = ""
