"""运行配置：stats.toml 为主，遗留 .env 只读合并。"""

from __future__ import annotations

import os
import tomllib
from functools import lru_cache
from pathlib import Path


def repo_root() -> Path:
    for candidate in (Path("/app"), Path.cwd(), Path(__file__).resolve().parents[2]):
        if (candidate / "config" / "stats.toml").is_file():
            return candidate
    return Path(__file__).resolve().parents[2]


def repo_config_path() -> Path:
    return repo_root() / "config" / "stats.toml"


def repo_env_path() -> Path:
    return repo_root() / ".env"


def _load_toml_upper() -> dict[str, str]:
    path = repo_config_path()
    if not path.is_file():
        return {}
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, str] = {}
    bootstrap = data.get("bootstrap")
    if isinstance(bootstrap, dict):
        mapping = {
            "host": "HOST",
            "port": "PORT",
            "db_path": "DB_PATH",
            "heartbeat_token": "HEARTBEAT_TOKEN",
            "heartbeat_rate_per_ip_per_min": "HEARTBEAT_RATE_PER_IP_PER_MIN",
            "heartbeat_min_interval_sec": "HEARTBEAT_MIN_INTERVAL_SEC",
            "online_ttl_sec": "ONLINE_TTL_SEC",
            "max_clock_skew_sec": "MAX_CLOCK_SKEW_SEC",
        }
        for key, env_key in mapping.items():
            if key in bootstrap and bootstrap[key] is not None:
                out[env_key] = str(bootstrap[key])
    env = data.get("env")
    if isinstance(env, dict):
        for k, v in env.items():
            if k and v is not None:
                out[str(k).upper()] = str(v)
    return out


def _load_legacy_dotenv_upper() -> dict[str, str]:
    try:
        from dotenv import dotenv_values
    except ImportError:
        return {}
    merged: dict[str, str] = {}
    path = repo_env_path()
    if path.is_file():
        for k, v in (dotenv_values(path) or {}).items():
            if k:
                merged[str(k).upper()] = "" if v is None else str(v)
    return merged


@lru_cache(maxsize=1)
def merged_settings_upper() -> dict[str, str]:
    merged: dict[str, str] = {}
    merged.update(_load_toml_upper())
    merged.update(_load_legacy_dotenv_upper())
    return merged


def setting_raw(key_upper: str) -> str | None:
    key = (key_upper or "").strip().upper()
    if not key:
        return None
    merged = merged_settings_upper()
    if key in merged:
        return merged[key]
    return os.environ.get(key)


def apply_settings_to_environ() -> None:
    for k, v in merged_settings_upper().items():
        if k not in os.environ:
            os.environ[k] = v


def clear_settings_cache() -> None:
    merged_settings_upper.cache_clear()
