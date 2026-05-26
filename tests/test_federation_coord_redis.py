from unittest.mock import patch

from pallas_community_stats.federation_coord_redis import (
    clear_coord_active_cache,
    count_coord_active_deployments,
)


def test_coord_active_cache_reuses_scan_result() -> None:
    clear_coord_active_cache()
    calls = {"n": 0}

    def fake_scan(raw_url: str, prefix: str) -> int:
        calls["n"] += 1
        assert raw_url == "redis://127.0.0.1:6399/2"
        assert prefix == "pallas:fed:test"
        return 4

    with patch(
        "pallas_community_stats.federation_coord_redis.scan_coord_active_deployments",
        side_effect=fake_scan,
    ):
        url = "redis://127.0.0.1:6399/2"
        prefix = "pallas:fed:test"
        assert count_coord_active_deployments(url, prefix) == 4
        assert count_coord_active_deployments(url, prefix) == 4
        assert calls["n"] == 1

    clear_coord_active_cache()
