"""可选 Redis 分布式心跳限流（多实例 stats 服务）。"""

from __future__ import annotations

from functools import lru_cache

from pallas_community_stats.repo_settings import setting_raw

_KEY_PREFIX = "pallas:stats:rl:"


def redis_rate_limit_mode() -> str:
    raw = setting_raw("STATS_REDIS_RATE_LIMIT_ENABLED")
    if raw is None:
        return "auto"
    s = raw.strip().lower()
    if s in ("0", "false", "no", "off"):
        return "false"
    if s in ("1", "true", "yes", "on"):
        return "true"
    return "auto"


def resolve_redis_url() -> str | None:
    val = setting_raw("REDIS_URL")
    if val and str(val).strip():
        return str(val).strip()
    return None


@lru_cache(maxsize=1)
def redis_rate_limit_enabled() -> bool:
    mode = redis_rate_limit_mode()
    if mode == "false":
        return False
    url = resolve_redis_url()
    if not url:
        return False
    return ping_redis(url)


def ping_redis(url: str) -> bool:
    try:
        import redis
    except ImportError:
        return False
    try:
        client = redis.Redis.from_url(url, socket_connect_timeout=1.0, socket_timeout=2.0)
        return bool(client.ping())
    except Exception:
        return False


@lru_cache(maxsize=1)
def get_redis_client():
    if not redis_rate_limit_enabled():
        return None
    url = resolve_redis_url()
    if not url:
        return None
    try:
        import redis
    except ImportError:
        return None
    return redis.Redis.from_url(url, socket_connect_timeout=1.0, socket_timeout=2.0)


def clear_redis_client_cache() -> None:
    get_redis_client.cache_clear()
    redis_rate_limit_enabled.cache_clear()


def check_heartbeat_rate_limit_redis(
    *,
    client_host: str,
    deployment_id: str,
    per_ip_per_min: int,
    min_interval_per_deployment_sec: float,
) -> bool:
    """True=已用 Redis 处理；False=应回退进程内限流。"""
    from pallas_community_stats.ratelimit import RateLimitExceeded

    client = get_redis_client()
    if client is None:
        return False
    try:
        if min_interval_per_deployment_sec > 0:
            dep_key = f"{_KEY_PREFIX}dep:{deployment_id}"
            if not client.set(dep_key, "1", nx=True, ex=max(1, int(min_interval_per_deployment_sec))):
                raise RateLimitExceeded("deployment heartbeat too frequent")
        if per_ip_per_min > 0:
            ip_key = f"{_KEY_PREFIX}ip:{client_host}"
            count = client.incr(ip_key)
            if count == 1:
                client.expire(ip_key, 60)
            if count > per_ip_per_min:
                raise RateLimitExceeded("ip rate limit exceeded")
        return True
    except RateLimitExceeded:
        raise
    except Exception:
        return False
