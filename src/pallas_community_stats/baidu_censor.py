from __future__ import annotations

import base64
import logging
import time
from dataclasses import dataclass
from enum import StrEnum
from threading import Lock
from typing import Any
from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

TOKEN_URL = "https://aip.baidubce.com/oauth/2.0/token"
TEXT_CENSOR_URL = "https://aip.baidubce.com/rest/2.0/solution/v1/text_censor/v2/user_defined"
IMG_CENSOR_URL = "https://aip.baidubce.com/rest/2.0/solution/v1/img_censor/v2/user_defined"


class CensorVerdict(StrEnum):
    COMPLIANT = "compliant"
    NON_COMPLIANT = "non_compliant"
    SUSPECTED = "suspected"
    ERROR = "error"


@dataclass(frozen=True)
class CensorDecision:
    verdict: CensorVerdict
    detail: str = ""


class BaiduCensorClient:
    """百度内容审核（文本 / 图片）。未配置 AK/SK 时 enabled=False。"""

    def __init__(
        self,
        *,
        api_key: str,
        secret_key: str,
        timeout_sec: float = 8.0,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._secret_key = (secret_key or "").strip()
        self._timeout = max(2.0, float(timeout_sec))
        self._lock = Lock()
        self._token = ""
        self._token_expire_unix = 0

    @property
    def enabled(self) -> bool:
        return bool(self._api_key and self._secret_key)

    async def censor_text(self, text: str) -> CensorDecision:
        body = (text or "").strip()
        if not body:
            return CensorDecision(CensorVerdict.COMPLIANT)
        if not self.enabled:
            return CensorDecision(CensorVerdict.COMPLIANT, "censor disabled")
        try:
            token = await self._access_token()
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    TEXT_CENSOR_URL,
                    params={"access_token": token},
                    data={"text": body},
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            return self._parse_response(resp)
        except Exception as exc:
            logger.warning("baidu text censor failed: %s", exc)
            return CensorDecision(CensorVerdict.ERROR, str(exc))

    async def censor_image(self, image_bytes: bytes) -> CensorDecision:
        if not image_bytes:
            return CensorDecision(CensorVerdict.COMPLIANT)
        if not self.enabled:
            return CensorDecision(CensorVerdict.COMPLIANT, "censor disabled")
        try:
            token = await self._access_token()
            payload = urlencode({"image": base64.b64encode(image_bytes).decode("ascii")})
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(
                    IMG_CENSOR_URL,
                    params={"access_token": token},
                    content=payload,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            return self._parse_response(resp)
        except Exception as exc:
            logger.warning("baidu image censor failed: %s", exc)
            return CensorDecision(CensorVerdict.ERROR, str(exc))

    async def _access_token(self) -> str:
        now = int(time.time())
        with self._lock:
            if self._token and now < self._token_expire_unix - 60:
                return self._token
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                TOKEN_URL,
                params={
                    "grant_type": "client_credentials",
                    "client_id": self._api_key,
                    "client_secret": self._secret_key,
                },
            )
        resp.raise_for_status()
        data = resp.json()
        token = str(data.get("access_token") or "").strip()
        if not token:
            raise RuntimeError(f"baidu token missing: {data}")
        expires_in = int(data.get("expires_in") or 2592000)
        with self._lock:
            self._token = token
            self._token_expire_unix = now + max(60, expires_in)
        return token

    def _parse_response(self, resp: httpx.Response) -> CensorDecision:
        try:
            data: dict[str, Any] = resp.json()
        except Exception:
            return CensorDecision(CensorVerdict.ERROR, f"http {resp.status_code} non-json")
        if resp.status_code >= 400 or data.get("error_code"):
            return CensorDecision(
                CensorVerdict.ERROR,
                str(data.get("error_msg") or data.get("error_code") or f"http {resp.status_code}"),
            )
        conclusion_type = data.get("conclusionType")
        try:
            ctype = int(conclusion_type)
        except (TypeError, ValueError):
            return CensorDecision(CensorVerdict.ERROR, f"bad conclusionType: {conclusion_type}")
        # 1 合规 2 不合规 3 疑似 4 审核失败
        if ctype == 1:
            return CensorDecision(CensorVerdict.COMPLIANT)
        if ctype == 2:
            return CensorDecision(CensorVerdict.NON_COMPLIANT, str(data.get("conclusion") or "non_compliant"))
        if ctype == 3:
            return CensorDecision(CensorVerdict.SUSPECTED, str(data.get("conclusion") or "suspected"))
        return CensorDecision(CensorVerdict.ERROR, str(data.get("conclusion") or f"type={ctype}"))


def merge_verdicts(*decisions: CensorDecision) -> CensorDecision:
    """取最严重结果：不合规 > 疑似 > 错误 > 合规。"""
    order = {
        CensorVerdict.NON_COMPLIANT: 3,
        CensorVerdict.SUSPECTED: 2,
        CensorVerdict.ERROR: 1,
        CensorVerdict.COMPLIANT: 0,
    }
    best = CensorDecision(CensorVerdict.COMPLIANT)
    for d in decisions:
        if order[d.verdict] > order[best.verdict]:
            best = d
    return best
