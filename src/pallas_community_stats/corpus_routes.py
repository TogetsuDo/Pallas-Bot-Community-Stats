from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from pallas_community_stats.config import Settings
from pallas_community_stats.corpus_models import (
    CorpusContributeBody,
    CorpusContributeResponse,
    CorpusEnrollBody,
    CorpusEnrollResponse,
    CorpusPolicy,
    CorpusUsageResponse,
)
from pallas_community_stats.corpus_store import CorpusStore, CorpusTokenRecord


def corpus_api_base(request: Request, settings: Settings) -> str:
    configured = (settings.corpus_public_api_base or "").strip().rstrip("/")
    if configured:
        return configured
    root = str(request.base_url).rstrip("/")
    return f"{root}/v1/corpus"


def build_corpus_token_checker(store: CorpusStore) -> Callable[..., CorpusTokenRecord]:
    def require_corpus_token(authorization: str | None = Header(default=None)) -> CorpusTokenRecord:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")
        token = authorization.removeprefix("Bearer ").strip()
        record = store.resolve_token(token)
        if record is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid or expired corpus token")
        return record

    return require_corpus_token


def build_corpus_router(
    *,
    store: CorpusStore,
    settings: Settings,
    require_heartbeat_auth,
) -> APIRouter:
    router = APIRouter(prefix="/v1/corpus", tags=["corpus"])
    require_corpus_token = build_corpus_token_checker(store)
    enroll_deps = [Depends(require_heartbeat_auth)] if settings.corpus_enroll_requires_heartbeat_token else []

    @router.post("/enroll", response_model=CorpusEnrollResponse, dependencies=enroll_deps)
    async def corpus_enroll(request: Request, body: CorpusEnrollBody) -> CorpusEnrollResponse:
        if not settings.corpus_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="corpus disabled")
        token, expires = store.enroll(
            deployment_id=body.deployment_id,
            read_enabled=settings.corpus_default_read,
            contribute_enabled=settings.corpus_default_contribute,
            token_ttl_sec=settings.corpus_token_ttl_sec or None,
        )
        return CorpusEnrollResponse(
            corpus_token=token,
            api_base=corpus_api_base(request, settings),
            policy=CorpusPolicy(
                read=settings.corpus_default_read,
                contribute=settings.corpus_default_contribute,
                merge_strategy=settings.corpus_default_merge_strategy,
                read_rpm=settings.corpus_read_rpm,
                contribute_per_day=settings.corpus_contribute_per_day,
            ),
            expires_at=expires,
        )

    @router.get("/usage", response_model=CorpusUsageResponse)
    async def corpus_usage(token: CorpusTokenRecord = Depends(require_corpus_token)) -> CorpusUsageResponse:
        if not settings.corpus_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="corpus disabled")
        usage = store.get_usage(token.deployment_id)
        return CorpusUsageResponse(
            deployment_id=token.deployment_id,
            read_lookups=int(usage["read_lookups"]),
            read_hits=int(usage["read_hits"]),
            contribute_ok=int(usage["contribute_ok"]),
            updated_at=usage["updated_at"],
        )

    @router.get("/context")
    async def corpus_get_context(
        keywords: str,
        token: CorpusTokenRecord = Depends(require_corpus_token),
    ):
        if not settings.corpus_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="corpus disabled")
        if not token.read_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="read not allowed")
        kw = (keywords or "").strip()
        if not kw:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="keywords required")
        store.bump_usage(token.deployment_id, read_lookup=True)
        ctx = store.get_context(kw)
        if ctx is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="context not found")
        store.bump_usage(token.deployment_id, read_hit=True)
        return ctx

    @router.post("/contribute", response_model=CorpusContributeResponse)
    async def corpus_contribute(
        body: CorpusContributeBody,
        token: CorpusTokenRecord = Depends(require_corpus_token),
    ) -> CorpusContributeResponse:
        if not settings.corpus_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="corpus disabled")
        if not token.contribute_enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="contribute not allowed")
        if body.op == "upsert_answer":
            if not body.keywords or not body.answer_keywords:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="keywords and answer_keywords required",
                )
            store.upsert_answer(
                keywords=body.keywords,
                group_id=int(body.group_id or 0),
                answer_keywords=body.answer_keywords,
                answer_time=int(body.answer_time or 0),
                message=str(body.message or ""),
                append_on_existing=bool(body.append_on_existing),
            )
            store.bump_usage(token.deployment_id, contribute=True)
            return CorpusContributeResponse()
        if body.op == "insert":
            ctx = body.context
            if not isinstance(ctx, dict) or not ctx.get("keywords"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="context.keywords required")
            answers = ctx.get("answers")
            if not isinstance(answers, list):
                answers = []
            store.insert_context(
                keywords=str(ctx["keywords"]),
                time=int(ctx.get("time") or 0),
                answers=[a for a in answers if isinstance(a, dict)],
            )
            store.bump_usage(token.deployment_id, contribute=True)
            return CorpusContributeResponse()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unsupported op")

    return router
