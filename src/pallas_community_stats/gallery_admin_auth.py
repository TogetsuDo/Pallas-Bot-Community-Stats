from __future__ import annotations

import hashlib
import hmac
import secrets
import time

COOKIE_NAME = "pcs_gallery_admin"
SESSION_TTL_SEC = 12 * 3600


def mint_admin_session(secret: str, *, now: int | None = None, ttl_sec: int = SESSION_TTL_SEC) -> str:
    exp = int(now if now is not None else time.time()) + max(60, int(ttl_sec))
    nonce = secrets.token_hex(8)
    payload = f"{exp}.{nonce}"
    sig = _sign(secret, payload)
    return f"{payload}.{sig}"


def verify_admin_session(secret: str, value: str | None, *, now: int | None = None) -> bool:
    raw_secret = (secret or "").strip()
    token = (value or "").strip()
    if not raw_secret or not token:
        return False
    parts = token.split(".")
    if len(parts) != 3:
        return False
    exp_s, nonce, sig = parts
    if not exp_s.isdigit() or not nonce or not sig:
        return False
    try:
        exp = int(exp_s)
    except ValueError:
        return False
    ts = int(now if now is not None else time.time())
    if exp < ts:
        return False
    payload = f"{exp_s}.{nonce}"
    expected = _sign(raw_secret, payload)
    return secrets.compare_digest(expected, sig)


def _sign(secret: str, payload: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
