"""联邦入池 / 协调 Redis 监控聚合。"""

from __future__ import annotations

from pallas_community_stats.bootstrap_routes import federate_redis_prefix_for_settings
from pallas_community_stats.config import Settings
from pallas_community_stats.db import StatsStore
from pallas_community_stats.federation_coord_redis import count_coord_active_deployments
from pallas_community_stats.models import FederationMonitorStats


def build_federation_monitor(settings: Settings, store: StatsStore) -> FederationMonitorStats | None:
    if not settings.bootstrap_enabled and not (settings.federate_id or "").strip():
        return None
    raw = store.aggregate_federation_monitor(online_ttl_sec=settings.online_ttl_sec)
    coord_active: int | None = None
    redis_url = (settings.federate_coord_redis_url or "").strip()
    if redis_url:
        prefix = federate_redis_prefix_for_settings(settings)
        coord_active = count_coord_active_deployments(redis_url, prefix)
    return FederationMonitorStats(
        bootstrap_enabled=bool(settings.bootstrap_enabled),
        federate_id=(settings.federate_id or "").strip() or None,
        coord_redis_configured=bool(redis_url),
        coord_active_deployments=coord_active,
        **raw,
    )
