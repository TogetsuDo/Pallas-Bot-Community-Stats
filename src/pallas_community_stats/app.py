from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse

from pallas_community_stats.bootstrap_routes import build_bootstrap_router
from pallas_community_stats.config import Settings, get_settings
from pallas_community_stats.corpus_models import (
    CorpusHotResponse,
    HotCorpusAnswer,
    HotCorpusItem,
    HotCorpusMode,
    HotCorpusPeriod,
)
from pallas_community_stats.corpus_routes import build_corpus_router
from pallas_community_stats.corpus_store import HOT_CORPUS_PERIOD_SEC, CorpusStore
from pallas_community_stats.db import StatsStore
from pallas_community_stats.federation_monitor import build_federation_monitor
from pallas_community_stats.federation_onboarding import (
    build_federation_onboarding,
    federation_onboarding_enabled,
)
from pallas_community_stats.federation_onboarding_models import FederationOnboardingResponse
from pallas_community_stats.hub_routes import register_hub_routes
from pallas_community_stats.models import (
    BubbleBotPublic,
    CorpusMonitorStats,
    CorpusStatsResponse,
    DeploymentMonitorStats,
    HeartbeatBody,
    HeartbeatResponse,
    MonitorOverviewResponse,
    RosterBubbleResponse,
    StatsResponse,
    VersionCount,
)
from pallas_community_stats.ratelimit import RateLimitExceeded, check_heartbeat_rate_limit, client_ip
from pallas_community_stats.roster_store import RosterStore, RosterUpsertEntry
from pallas_community_stats.shields import shields_endpoint_payload


def _app_settings(request: Request) -> Settings:
    return request.app.state.settings


def _require_bootstrap_auth(
    settings: Settings = Depends(_app_settings),
    authorization: str | None = Header(default=None),
) -> None:
    if not settings.bootstrap_enabled:
        return
    secret = (settings.instance_secret or "").strip()
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="bootstrap enabled but INSTANCE_SECRET not configured",
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
    if authorization.removeprefix("Bearer ").strip() != secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid bearer token")


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
    roster_store = RosterStore(cfg.db_path)

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
        if body.roster_public and body.roster:
            roster_store.replace_deployment_roster(
                deployment_id=body.deployment_id,
                entries=[
                    RosterUpsertEntry(
                        qq=entry.qq,
                        nickname=entry.nickname,
                        online=entry.online,
                        message_weight=entry.message_weight,
                        show_qq=entry.show_qq,
                    )
                    for entry in body.roster
                ],
                seen_unix=server_ts,
                show_qq=body.roster_show_qq,
                show_profile=body.roster_show_profile,
            )
        else:
            roster_store.clear_deployment_roster(body.deployment_id)
        if body.corpus_hot_snapshot and cfg.corpus_enabled:
            snap = body.corpus_hot_snapshot
            items_raw = snap.get("items") if isinstance(snap, dict) else None
            if isinstance(items_raw, list):
                as_of = int(snap.get("as_of") or server_ts) if isinstance(snap, dict) else server_ts
                corpus_store.upsert_hot_snapshot(
                    deployment_id=body.deployment_id,
                    as_of_unix=as_of,
                    items=[item for item in items_raw if isinstance(item, dict)],
                )
        return HeartbeatResponse(server_ts=server_ts)

    @app.get("/v1/stats", response_model=StatsResponse)
    async def stats(settings: Settings = Depends(_app_settings)) -> StatsResponse:
        snap = store.aggregate_stats(online_ttl_sec=settings.online_ttl_sec)
        as_of = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        corpus_stats: dict[str, int] | None = None
        if cfg.corpus_enabled:
            corpus_stats = corpus_store.aggregate_public_stats()
        return StatsResponse(
            deployments_total=snap.deployments_total,
            deployments_online=snap.deployments_online,
            bots_online_sum=snap.bots_online_sum,
            deployments_online_sharded=snap.deployments_online_sharded,
            shard_workers_online_sum=snap.shard_workers_online_sum,
            online_ttl_sec=settings.online_ttl_sec,
            as_of=as_of,
            corpus=corpus_stats,
        )

    def monitor_as_of() -> str:
        return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    def build_corpus_monitor(settings: Settings) -> CorpusMonitorStats | None:
        if not cfg.corpus_enabled:
            return None
        cutoff = int(time.time()) - settings.online_ttl_sec
        raw = corpus_store.aggregate_monitor_stats(online_cutoff_unix=cutoff)
        return CorpusMonitorStats(**raw)

    @app.get("/v1/stats/corpus", response_model=CorpusStatsResponse)
    async def stats_corpus(settings: Settings = Depends(_app_settings)) -> CorpusStatsResponse:
        corpus = build_corpus_monitor(settings)
        if corpus is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="corpus disabled",
            )
        return CorpusStatsResponse(
            online_ttl_sec=settings.online_ttl_sec,
            as_of=monitor_as_of(),
            corpus=corpus,
        )

    @app.get("/v1/monitor/overview", response_model=MonitorOverviewResponse)
    async def monitor_overview(settings: Settings = Depends(_app_settings)) -> MonitorOverviewResponse:
        dep_raw = store.aggregate_deployment_monitor(online_ttl_sec=settings.online_ttl_sec)
        versions = [VersionCount(**row) for row in dep_raw.pop("online_versions", [])]
        deployments = DeploymentMonitorStats(**dep_raw, online_versions=versions)
        federation = await asyncio.to_thread(build_federation_monitor, settings, store)
        return MonitorOverviewResponse(
            online_ttl_sec=settings.online_ttl_sec,
            as_of=monitor_as_of(),
            corpus_enabled=cfg.corpus_enabled,
            deployments=deployments,
            corpus=build_corpus_monitor(settings),
            federation=federation,
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

    @app.get("/v1/roster/bubble", response_model=RosterBubbleResponse)
    async def roster_bubble(
        response: Response,
        settings: Settings = Depends(_app_settings),
    ) -> RosterBubbleResponse:
        rows = roster_store.aggregate_bubble(online_ttl_sec=settings.online_ttl_sec)
        bots = [
            BubbleBotPublic(
                bot_key=row.bot_key,
                qq=row.qq if row.show_qq else None,
                nickname=row.nickname,
                avatar_url=row.avatar_url,
                profile_url=row.profile_url,
                online=row.online,
                message_weight=row.message_weight,
                deployment_ids=list(row.deployment_ids),
            )
            for row in rows
        ]
        response.headers["Cache-Control"] = "public, max-age=60"
        return RosterBubbleResponse(
            online_ttl_sec=settings.online_ttl_sec,
            as_of=monitor_as_of(),
            bots_total=len(bots),
            bots_online=sum(1 for bot in bots if bot.online),
            bots=bots,
        )

    @app.get("/v1/federation/onboarding", response_model=FederationOnboardingResponse)
    async def federation_onboarding(
        settings: Settings = Depends(_app_settings),
    ) -> FederationOnboardingResponse:
        if not federation_onboarding_enabled(settings):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="federation onboarding disabled",
            )
        return build_federation_onboarding(settings, store)

    app.include_router(
        build_bootstrap_router(
            settings=cfg,
            store=store,
            require_bootstrap_auth=_require_bootstrap_auth,
        )
    )

    if cfg.corpus_enabled:

        @app.get("/v1/corpus/hot", response_model=CorpusHotResponse)
        async def corpus_hot(
            response: Response,
            mode: HotCorpusMode = Query(default="fleet"),
            period: HotCorpusPeriod = Query(default="day"),
            limit: int = Query(default=40, ge=5, le=80),
            settings: Settings = Depends(_app_settings),
        ) -> CorpusHotResponse:
            if mode == "pool":
                window_sec = 0
            elif mode == "fleet":
                window_sec = 86400
            else:
                window_sec = int(HOT_CORPUS_PERIOD_SEC.get(period, 86400))
            rows = corpus_store.aggregate_hot_keywords(mode=mode, period=period, limit=limit)
            response.headers["Cache-Control"] = "public, max-age=120"
            return CorpusHotResponse(
                mode=mode,
                period=period,
                window_sec=window_sec,
                as_of=monitor_as_of(),
                items=[
                    HotCorpusItem(
                        keywords=str(row["keywords"]),
                        score=int(row["score"]),
                        answers=[
                            HotCorpusAnswer(
                                answer_keywords=str(ans["answer_keywords"]),
                                message=str(ans.get("message") or ""),
                                count=int(ans.get("count") or 0),
                            )
                            for ans in (row.get("answers") or [])
                            if isinstance(ans, dict)
                        ],
                    )
                    for row in rows
                ],
            )

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
    app.state.roster_store = roster_store
    register_hub_routes(app)
    return app
