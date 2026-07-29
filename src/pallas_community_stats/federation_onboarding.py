"""构建 GET /v1/federation/onboarding 响应（供 Bot 控制台展示 Phase 2 入池说明）。"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from urllib.parse import urlparse, urlunparse

from pallas_community_stats.config import Settings
from pallas_community_stats.db import StatsStore
from pallas_community_stats.federation_monitor import build_federation_monitor
from pallas_community_stats.federation_onboarding_models import (
    FederationCoordPublic,
    FederationOnboardingResponse,
    FederationOnboardingStep,
    FederationPoolStatsPublic,
)

_logger = logging.getLogger(__name__)

# 与 Pallas-Bot community_stats.endpoints 主备一致（HTTP 接口可 failover）
STATS_PRIMARY_BASE = "https://stats.pallasbot.top"
STATS_FALLBACK_BASE = "https://pallas.togetsudo.com"


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


def build_federation_onboarding(settings: Settings, store: StatsStore | None = None) -> FederationOnboardingResponse:
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
            title="保持多机协同开启",
            detail="控制台 → 通用配置 → 多机协同（联邦控制面）；「控制面」默认已开启，一般不用改。",
        ),
        FederationOnboardingStep(
            order=2,
            title="新版本可自动入池",
            detail=(
                "较新版本 Bot：密钥可留空，启动时会从本中心自动写入入池密钥，"
                "并拉取协同池编号与去重服务器地址。旧版本仍可把本页「入池密钥」粘贴到「实例密钥」后保存。"
            ),
        ),
        FederationOnboardingStep(
            order=3,
            title="确认已领到配置",
            detail=(
                "在「统计与语料 → 多机协同」看本部署状态：入池密钥应为已配置，中心配置应为已获取；"
                "「重复消息去重」保持「自动」或「开启」。"
            ),
        ),
        FederationOnboardingStep(
            order=4,
            title="多套牛牛共用同一池",
            detail="同一协同池内的部署才会互相去重、并把对方认成 bot；中心不转发群消息，牛牛直连去重服务。",
        ),
        FederationOnboardingStep(
            order=5,
            title="可与共享语料一起用",
            detail="共享语料用另一套口令，与入池密钥无关；可以先开语料，再加入联邦池。",
        ),
    ]

    summary = (
        "加入同一社区联邦池后，多套自托管牛牛不会对同一条群消息各回复一遍。"
        "较新版本可自动写入入池密钥并领取去重地址；牛牛直连去重服务，聊天内容不经中心转发。"
    )
    secret_hint = (
        "这是加入联邦池的口令。新版本一般会自动写入，也可手动复制到「多机协同 → 实例密钥」。"
        "请勿发到公开群或提交到 git。与共享语料口令、统计心跳无关。"
    )

    coord_hint = (
        "去重走专用地址（下方 host:端口），不是网页链接；含密码的完整连接由中心在领取配置时下发。"
        "备站域名只替代统计/语料等网页接口，不能代替去重服务器地址。"
    )
    failover_note = (
        f"中心网页接口：主站 {STATS_PRIMARY_BASE} 连不上时，牛牛会自动改连备站 {STATS_FALLBACK_BASE}。"
        "去重 Redis 始终连 coord 子域（如下），与主备站无关。"
    )

    pool_stats: FederationPoolStatsPublic | None = None
    if store is not None:
        try:
            monitor = build_federation_monitor(settings, store)
        except Exception:
            _logger.exception("federation onboarding: pool_stats unavailable")
            monitor = None
        if monitor is not None:
            pool_stats = FederationPoolStatsPublic(
                members_total=monitor.members_total,
                members_online=monitor.members_online,
                members_recent_24h=monitor.members_recent_24h,
                coord_active_deployments=monitor.coord_active_deployments,
            )

    return FederationOnboardingResponse(
        available=federation_onboarding_enabled(settings),
        title="社区联邦：避免多套牛牛重复回复",
        summary=summary,
        bootstrap_enabled=bootstrap_on,
        federate_id=federate_id,
        coord=coord,
        coord_redis_hint=coord_hint,
        stats_primary_url=STATS_PRIMARY_BASE,
        stats_fallback_url=STATS_FALLBACK_BASE,
        stats_failover_note=failover_note,
        instance_secret=instance_secret,
        instance_secret_hint=secret_hint,
        steps=steps,
        ingress_note="牛牛直连去重服务器；中心只负责下发配置和本页说明，不转发每条群消息。",
        as_of=as_of,
        pool_stats=pool_stats,
    )
