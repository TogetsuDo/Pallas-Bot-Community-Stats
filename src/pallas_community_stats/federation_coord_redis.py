"""协调 Redis：统计当前仍有 ingress claim 的 deployment 数（近似「正在使用去重」）。"""

from __future__ import annotations

_SCAN_KEY_LIMIT = 8000


def count_coord_active_deployments(redis_url: str, key_prefix: str) -> int | None:
    raw_url = (redis_url or "").strip()
    prefix = (key_prefix or "").strip().rstrip(":")
    if not raw_url or not prefix:
        return None
    try:
        import redis
    except ImportError:
        return None
    pattern = f"{prefix}:ingress:*"
    try:
        client = redis.Redis.from_url(
            raw_url,
            socket_connect_timeout=1.5,
            socket_timeout=2.0,
            decode_responses=True,
        )
        owners: set[str] = set()
        scanned = 0
        for key in client.scan_iter(match=pattern, count=200):
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
