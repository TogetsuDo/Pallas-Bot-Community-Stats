"""协调 Redis：统计当前仍有 ingress claim 的 deployment 数（近似「正在使用去重」）。"""

from __future__ import annotations

import time

_SCAN_KEY_LIMIT = 8000
_SCAN_DEADLINE_SEC = 3.0
_CACHE_TTL_SEC = 60.0

_coord_active_cache: dict[str, tuple[int | None, float]] = {}


def clear_coord_active_cache() -> None:
    _coord_active_cache.clear()


def count_coord_active_deployments(redis_url: str, key_prefix: str) -> int | None:
    raw_url = (redis_url or "").strip()
    prefix = (key_prefix or "").strip().rstrip(":")
    if not raw_url or not prefix:
        return None
    cache_key = f"{raw_url}\0{prefix}"
    now = time.monotonic()
    hit = _coord_active_cache.get(cache_key)
    if hit is not None and now < hit[1]:
        return hit[0]
    value = scan_coord_active_deployments(raw_url, prefix)
    _coord_active_cache[cache_key] = (value, now + _CACHE_TTL_SEC)
    return value


def scan_coord_active_deployments(raw_url: str, prefix: str) -> int | None:
    try:
        import redis
    except ImportError:
        return None
    pattern = f"{prefix}:ingress:*"
    try:
        client = redis.Redis.from_url(
            raw_url,
            socket_connect_timeout=1.0,
            socket_timeout=1.0,
            decode_responses=True,
        )
        owners: set[str] = set()
        scanned = 0
        deadline = time.monotonic() + _SCAN_DEADLINE_SEC
        for key in client.scan_iter(match=pattern, count=200):
            if time.monotonic() >= deadline:
                break
            scanned += 1
            if scanned > _SCAN_KEY_LIMIT:
                break
            try:
                owner = client.get(key)
            except Exception:
                continue
            if owner:
                owners.add(str(owner).strip().lower())
        return len(owners)
    except Exception:
        return None
