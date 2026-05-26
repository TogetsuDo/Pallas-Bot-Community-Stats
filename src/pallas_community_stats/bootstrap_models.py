from __future__ import annotations

from pydantic import BaseModel, Field


class BootstrapCoordResponse(BaseModel):
    redis_url: str = ""
    redis_prefix: str = ""
    claim_ttl_sec: int = Field(default=86400, ge=60, le=86400 * 7)


class BootstrapResponse(BaseModel):
    schema_version: int = 1
    deployment_id: str
    tenant_id: str | None = None
    federate_id: str | None = None
    coord: BootstrapCoordResponse | None = None
    expires_at: int | None = None
