from __future__ import annotations

import hashlib
import json
import secrets
from typing import Any


def keywords_hash(keywords: str) -> str:
    clean = keywords.replace("\x00", "") if keywords and "\x00" in keywords else keywords
    return hashlib.md5((clean or "").encode("utf-8", errors="replace")).hexdigest()


def hash_corpus_token(token: str) -> str:
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()


def new_corpus_token() -> str:
    return f"pc_{secrets.token_urlsafe(32)}"


def dumps_messages(messages: list[str]) -> str:
    return json.dumps(messages, ensure_ascii=False)


def loads_messages(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [str(m) for m in data if m is not None]


def context_payload(
    *,
    keywords: str,
    time: int,
    trigger_count: int,
    clear_time: int,
    answers: list[dict[str, Any]],
    ban: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "keywords": keywords,
        "time": time,
        "trigger_count": trigger_count,
        "clear_time": clear_time,
        "answers": answers,
        "ban": ban or [],
    }
