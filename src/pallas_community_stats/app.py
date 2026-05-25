from __future__ import annotations

import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from pallas_community_stats.config import Settings, get_settings
from pallas_community_stats.corpus_routes import build_corpus_router
from pallas_community_stats.corpus_store import CorpusStore
from pallas_community_stats.db import StatsStore
from pallas_community_stats.models import HeartbeatBody, HeartbeatResponse, StatsResponse
from pallas_community_stats.ratelimit import RateLimitExceeded, check_heartbeat_rate_limit, client_ip
from pallas_community_stats.shields import shields_endpoint_payload


def _app_settings(request: Request) -> Settings:
    return request.app.state.settings


def _require_heartbeat_auth(
    settings: Settings = Depends(_app_settings),
    authorization: str | None = Header(default=None),
) -> None:
    token = (settings.heartbeat_token or "").strip()
    if not token:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    if authorization.removeprefix("Bearer ").strip() != token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid bearer token")


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()
    store = StatsStore(cfg.db_path)
    corpus_store = CorpusStore(cfg.db_path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield

    app = FastAPI(
        title="Pallas Community Stats",
        version="0.1.0",
        description="Pallas-Bot opt-in 部署与在线统计中心",
        lifespan=lifespan,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(
        "/v1/heartbeat",
        response_model=HeartbeatResponse,
        dependencies=[Depends(_require_heartbeat_auth)],
    )
    async def heartbeat(
        request: Request,
        body: HeartbeatBody,
        settings: Settings = Depends(_app_settings),
    ) -> HeartbeatResponse:
        server_ts = int(time.time())
        client_ts = body.ts if body.ts is not None else server_ts
        if settings.max_clock_skew_sec > 0 and abs(client_ts - server_ts) > settings.max_clock_skew_sec:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ts skew too large",
            )
        if not (settings.heartbeat_token or "").strip():
            try:
                check_heartbeat_rate_limit(
                    client_host=client_ip(request),
                    deployment_id=body.deployment_id,
                    per_ip_per_min=settings.heartbeat_rate_per_ip_per_min,
                    min_interval_per_deployment_sec=settings.heartbeat_min_interval_sec,
                )
            except RateLimitExceeded as e:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=str(e),
                ) from e
        store.upsert_heartbeat(
            deployment_id=body.deployment_id,
            seen_unix=server_ts,
            version=body.version.strip(),
            online_bots=body.online_bots,
            catalog_bots=body.catalog_bots,
            sharded=body.sharded,
            shard_workers=body.shard_workers,
        )
        return HeartbeatResponse(server_ts=server_ts)

    @app.get("/v1/stats", response_model=StatsResponse)
    async def stats(settings: Settings = Depends(_app_settings)) -> StatsResponse:
        snap = store.aggregate_stats(online_ttl_sec=settings.online_ttl_sec)
        as_of = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        return StatsResponse(
            deployments_total=snap.deployments_total,
            deployments_online=snap.deployments_online,
            bots_online_sum=snap.bots_online_sum,
            online_ttl_sec=settings.online_ttl_sec,
            as_of=as_of,
        )

    def _badge_response(label: str, message: str) -> JSONResponse:
        return JSONResponse(
            shields_endpoint_payload(label=label, message=message),
            headers={"Cache-Control": "public, max-age=300"},
        )

    @app.get("/v1/badges/deployments-online", include_in_schema=True)
    async def badge_deployments_online(settings: Settings = Depends(_app_settings)) -> JSONResponse:
        snap = store.aggregate_stats(online_ttl_sec=settings.online_ttl_sec)
        return _badge_response("社区部署", f"{snap.deployments_online} 套在线")

    @app.get("/v1/badges/bots-online", include_in_schema=True)
    async def badge_bots_online(settings: Settings = Depends(_app_settings)) -> JSONResponse:
        snap = store.aggregate_stats(online_ttl_sec=settings.online_ttl_sec)
        return _badge_response("在线牛", str(snap.bots_online_sum))

    if cfg.corpus_enabled:
        app.include_router(
            build_corpus_router(
                store=corpus_store,
                settings=cfg,
                require_heartbeat_auth=_require_heartbeat_auth,
            )
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    app.state.settings = cfg
    app.state.store = store
    app.state.corpus_store = corpus_store
    return app
