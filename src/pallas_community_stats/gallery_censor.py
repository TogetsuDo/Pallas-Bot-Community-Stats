from __future__ import annotations

from dataclasses import dataclass

from pallas_community_stats.baidu_censor import BaiduCensorClient, CensorDecision, CensorVerdict, merge_verdicts
from pallas_community_stats.config import Settings


@dataclass(frozen=True)
class GalleryModerationResult:
    status: str  # published | pending
    rejected: bool = False
    detail: str = ""


def build_baidu_censor(settings: Settings) -> BaiduCensorClient:
    return BaiduCensorClient(
        api_key=settings.baidu_censor_api_key,
        secret_key=settings.baidu_censor_secret_key,
    )


def on_error_policy(settings: Settings) -> str:
    raw = (settings.gallery_censor_on_error or "pending").strip().lower()
    return raw if raw in {"pending", "reject"} else "pending"


async def moderate_gallery_content(
    *,
    censor: BaiduCensorClient | None,
    settings: Settings,
    text: str,
    image_bytes: bytes | None,
) -> GalleryModerationResult:
    client = censor
    if client is None or not client.enabled:
        return GalleryModerationResult(status="published")

    decisions: list[CensorDecision] = []
    body = (text or "").strip()
    if body:
        decisions.append(await client.censor_text(body))
    if image_bytes and settings.gallery_censor_image:
        decisions.append(await client.censor_image(image_bytes))
    if not decisions:
        return GalleryModerationResult(status="published")

    merged = merge_verdicts(*decisions)
    if merged.verdict == CensorVerdict.COMPLIANT:
        return GalleryModerationResult(status="published")
    if merged.verdict == CensorVerdict.NON_COMPLIANT:
        return GalleryModerationResult(status="hidden", rejected=True, detail=merged.detail or "non_compliant")
    if merged.verdict == CensorVerdict.SUSPECTED:
        return GalleryModerationResult(status="pending", detail=merged.detail or "suspected")

    # ERROR
    if on_error_policy(settings) == "reject":
        return GalleryModerationResult(status="hidden", rejected=True, detail=merged.detail or "censor_error")
    return GalleryModerationResult(status="pending", detail=merged.detail or "censor_error")
