"""GET /v1/bootstrap：向 Bot 下发 federate_id 与协调 Redis。"""

from __future__ import annotations

import re
import time

from fastapi import APIRouter, Depends, Header, HTTPException, status

from pallas_community_stats.bootstrap_models import BootstrapCoordResponse, BootstrapResponse
from pallas_community_stats.config import Settings

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _normalize_deployment_id(raw: str | None) -> str:
    dep = (raw or "").strip().lower()
    if not _UUID_RE.fullmatch(dep):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid deployment_id")
    return dep


def _federate_redis_prefix(federate_id: str, explicit: str) -> str:
    prefix = (explicit or "").strip().rstrip(":")
    if prefix:
        return prefix
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in federate_id)
    return f"pallas:fed:{safe}"


def build_bootstrap_router(
    *,
    settings: Settings,
    require_bootstrap_auth,
) -> APIRouter:
    router = APIRouter(tags=["bootstrap"])

    @router.get(
        "/v1/bootstrap",
        response_model=BootstrapResponse,
        dependencies=[Depends(require_bootstrap_auth)],
    )
    async def bootstrap(
        x_deployment_id: str | None = Header(default=None, alias="X-Deployment-Id"),
    ) -> BootstrapResponse:
        if not settings.bootstrap_enabled:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="bootstrap disabled",
            )
        deployment_id = _normalize_deployment_id(x_deployment_id)
        federate_id = (settings.federate_id or "").strip()
        coord: BootstrapCoordResponse | None = None
        redis_url = (settings.federate_coord_redis_url or "").strip()
        if federate_id and redis_url:
            coord = BootstrapCoordResponse(
                redis_url=redis_url,
                redis_prefix=_federate_redis_prefix(federate_id, settings.federate_redis_prefix),
                claim_ttl_sec=settings.federate_claim_ttl_sec,
            )
        expires_at = int(time.time()) + max(300, settings.bootstrap_ttl_sec)
        return BootstrapResponse(
            schema_version=1,
            deployment_id=deployment_id,
            federate_id=federate_id or None,
            coord=coord,
            expires_at=expires_at,
        )

    return router
