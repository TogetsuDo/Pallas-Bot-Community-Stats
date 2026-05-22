"""进程内限流：token 未配置时的开放写入防护。"""

from __future__ import annotations

import threading
import time
from collections import defaultdict

_lock = threading.Lock()
_ip_hits: dict[str, list[float]] = defaultdict(list)
_deployment_last: dict[str, float] = {}


def client_ip(request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    if request.client and request.client.host:
        return str(request.client.host)
    return "unknown"


def check_heartbeat_rate_limit(
    *,
    client_host: str,
    deployment_id: str,
    per_ip_per_min: int,
    min_interval_per_deployment_sec: float,
) -> None:
    if per_ip_per_min <= 0 and min_interval_per_deployment_sec <= 0:
        return
    from pallas_community_stats.redis_ratelimit import check_heartbeat_rate_limit_redis

    if check_heartbeat_rate_limit_redis(
        client_host=client_host,
        deployment_id=deployment_id,
        per_ip_per_min=per_ip_per_min,
        min_interval_per_deployment_sec=min_interval_per_deployment_sec,
    ):
        return
    now = time.time()
    with _lock:
        if min_interval_per_deployment_sec > 0:
            last = _deployment_last.get(deployment_id)
            if last is not None and now - last < min_interval_per_deployment_sec:
                raise RateLimitExceeded("deployment heartbeat too frequent")
            _deployment_last[deployment_id] = now
        if per_ip_per_min > 0:
            window_start = now - 60.0
            hits = [t for t in _ip_hits[client_host] if t >= window_start]
            if len(hits) >= per_ip_per_min:
                raise RateLimitExceeded("ip rate limit exceeded")
            hits.append(now)
            _ip_hits[client_host] = hits


def clear_rate_limit_state_for_tests() -> None:
    with _lock:
        _ip_hits.clear()
        _deployment_last.clear()


class RateLimitExceeded(Exception):
    pass
