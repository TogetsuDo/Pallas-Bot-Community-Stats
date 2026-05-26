"""构建 GET /v1/federation/onboarding 响应（供 Bot 控制台展示 Phase 2 入池说明）。"""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlparse, urlunparse

from pallas_community_stats.config import Settings
from pallas_community_stats.federation_onboarding_models import (
    FederationCoordPublic,
    FederationOnboardingResponse,
    FederationOnboardingStep,
)


def federation_onboarding_enabled(settings: Settings) -> bool:
    if settings.federation_onboarding_enabled is not None:
        return bool(settings.federation_onboarding_enabled)
    return bool(settings.bootstrap_enabled and (settings.instance_secret or "").strip())


def redis_url_public_display(redis_url: str) -> FederationCoordPublic | None:
    raw = (redis_url or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    if parsed.scheme not in ("redis", "rediss"):
        return FederationCoordPublic(redis_url_display=raw)
    host = parsed.hostname or ""
    port = parsed.port
    if parsed.scheme == "rediss" and port is None:
        port = 6380
    if parsed.scheme == "redis" and port is None:
        port = 6379
    path = (parsed.path or "").strip("/")
    db: int | None = None
    if path.isdigit():
        db = int(path)
    netloc = host
    if port is not None:
        netloc = f"{host}:{port}" if host else str(port)
    display = urlunparse((parsed.scheme, netloc, parsed.path or "", "", "", ""))
    return FederationCoordPublic(
        redis_url_display=display,
        host=host,
        port=port,
        db=db,
    )


def build_federation_onboarding(settings: Settings) -> FederationOnboardingResponse:
    as_of = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    bootstrap_on = bool(settings.bootstrap_enabled)
    federate_id = (settings.federate_id or "").strip() or None
    coord_raw = (settings.federate_coord_redis_url or "").strip()
    coord = redis_url_public_display(coord_raw) if coord_raw else None

    publish = bool(settings.federation_onboarding_publish_secret)
    secret = (settings.instance_secret or "").strip()
    instance_secret: str | None = None
    if publish and bootstrap_on and secret:
        instance_secret = secret

    steps = [
        FederationOnboardingStep(
            order=1,
            title="打开联邦控制面",
            detail="控制台 → 通用配置 → 联邦控制面；保持「控制面」开启（默认已开）。",
        ),
        FederationOnboardingStep(
            order=2,
            title="填写入池密钥",
            detail="将本页「入池密钥」完整填入「实例密钥 / PALLAS_INSTANCE_SECRET」，保存并执行热重载。",
        ),
        FederationOnboardingStep(
            order=3,
            title="自动拉取 bootstrap",
            detail="Bot 携带该密钥向中心 GET /v1/bootstrap，落盘 federate_id 与协调 Redis；勿把分片 REDIS_URL 填到联邦协调 Redis。",
        ),
        FederationOnboardingStep(
            order=4,
            title="启用 ingress 去重",
            detail="「ingress 去重」保持 auto 或 true；各 deployment 直连协调 Redis，中心不转发群消息。",
        ),
        FederationOnboardingStep(
            order=5,
            title="与共享语料并存",
            detail="共享语料 enroll 使用语料 token，与入池密钥无关；可先接入语料再入联邦池。",
        ),
    ]

    summary = (
        "Phase 2：同联邦池内多 deployment 对同一条入站消息只处理一次（Redis SET NX）。"
        "协调 Redis 与 bootstrap 由中心下发，Bot 直连 Redis，不经中心 HTTP 转发消息。"
    )
    secret_hint = (
        "与中心 INSTANCE_SECRET 一致，用于 bootstrap 鉴权；填入 WebUI 后请勿泄露到公开仓库。"
        "与语料 enroll token、心跳 HEARTBEAT_TOKEN 均不同。"
    )

    return FederationOnboardingResponse(
        available=federation_onboarding_enabled(settings),
        title="联邦 Phase 2：跨 deployment ingress 去重",
        summary=summary,
        bootstrap_enabled=bootstrap_on,
        federate_id=federate_id,
        coord=coord,
        instance_secret=instance_secret,
        instance_secret_hint=secret_hint,
        steps=steps,
        ingress_note="Bot 直连协调 Redis；中心仅提供 bootstrap 与公开说明，不代理每条群消息。",
        as_of=as_of,
    )
