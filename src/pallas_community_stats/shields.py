"""shields.io Endpoint Badge 响应格式。"""

from __future__ import annotations

from typing import Any

_BADGE_COLOR = "fe7d37"


def shields_endpoint_payload(*, label: str, message: str, color: str = _BADGE_COLOR) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "label": label,
        "message": message,
        "color": color,
    }
