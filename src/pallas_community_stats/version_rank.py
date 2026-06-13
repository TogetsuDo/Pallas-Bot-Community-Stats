"""Bot 版本字符串排序：数量相同时较新版本优先。"""

from __future__ import annotations

import re

_SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)")
_COMMITS_AFTER_RE = re.compile(r"^-(\d+)-g", re.IGNORECASE)


def normalize_version_display(version: str) -> str:
    """展示用主版本号：保留 major.minor.patch，去掉 dirty / git describe 等后缀。"""
    raw = (version or "").strip()
    if not raw:
        return ""
    has_v_prefix = raw[0] in "vV"
    core = raw.lstrip("vV")
    m = _SEMVER_RE.match(core)
    if not m:
        return raw
    semver = f"{m.group(1)}.{m.group(2)}.{m.group(3)}"
    return f"v{semver}" if has_v_prefix else semver


def version_newness_key(version: str) -> tuple[int, int, int, int, int]:
    """越大表示版本越新，用于同数量部署时的 tie-break。"""
    raw = (version or "").strip().lstrip("vV")
    if not raw:
        return (0, 0, 0, 0, 0)
    m = _SEMVER_RE.match(raw)
    if not m:
        return (0, 0, 0, 0, 0)
    major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3))
    rest = raw[m.end() :]
    commits_after = 0
    dirty = 0
    cm = _COMMITS_AFTER_RE.match(rest)
    if cm:
        commits_after = int(cm.group(1))
    if "dirty" in rest.lower():
        dirty = 1
    return (major, minor, patch, commits_after, dirty)


def rank_online_versions(
    rows: list[tuple[str, int]],
    *,
    limit: int = 5,
) -> list[dict[str, int | str]]:
    merged: dict[str, int] = {}
    for version, count in rows:
        display = normalize_version_display(version)
        if not display:
            continue
        merged[display] = merged.get(display, 0) + count
    ranked = sorted(
        merged.items(),
        key=lambda item: (
            -item[1],
            tuple(-x for x in version_newness_key(item[0])),
            item[0],
        ),
    )
    return [{"version": version, "count": count} for version, count in ranked[:limit]]
