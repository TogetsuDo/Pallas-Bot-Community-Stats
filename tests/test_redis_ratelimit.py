from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from pallas_community_stats.ratelimit import RateLimitExceeded
from pallas_community_stats.redis_ratelimit import check_heartbeat_rate_limit_redis, clear_redis_client_cache


@pytest.fixture(autouse=True)
def clear_caches():
    clear_redis_client_cache()
    from pallas_community_stats.config import get_settings
    from pallas_community_stats.repo_settings import clear_settings_cache

    get_settings.cache_clear()
    clear_settings_cache()
    yield
    clear_redis_client_cache()
    get_settings.cache_clear()
    clear_settings_cache()


def test_redis_deployment_too_frequent(monkeypatch) -> None:
    client = MagicMock()
    client.set.return_value = False
    monkeypatch.setattr("pallas_community_stats.redis_ratelimit.get_redis_client", lambda: client)

    with pytest.raises(RateLimitExceeded):
        check_heartbeat_rate_limit_redis(
            client_host="1.2.3.4",
            deployment_id="550e8400-e29b-41d4-a716-446655440000",
            per_ip_per_min=0,
            min_interval_per_deployment_sec=30.0,
        )


def test_redis_ip_rate_exceeded(monkeypatch) -> None:
    client = MagicMock()
    client.set.return_value = True
    client.incr.return_value = 61
    monkeypatch.setattr("pallas_community_stats.redis_ratelimit.get_redis_client", lambda: client)

    with pytest.raises(RateLimitExceeded):
        check_heartbeat_rate_limit_redis(
            client_host="1.2.3.4",
            deployment_id="550e8400-e29b-41d4-a716-446655440000",
            per_ip_per_min=60,
            min_interval_per_deployment_sec=0,
        )
