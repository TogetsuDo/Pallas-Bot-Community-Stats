from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

from pallas_community_stats.corpus_util import (
    context_payload,
    dumps_messages,
    hash_corpus_token,
    keywords_hash,
    loads_messages,
    new_corpus_token,
)


@dataclass(frozen=True)
class CorpusTokenRecord:
    deployment_id: str
    read_enabled: bool
    contribute_enabled: bool
    expires_unix: int | None


class CorpusStore:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._lock = Lock()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS corpus_tokens (
                    token_hash TEXT PRIMARY KEY,
                    deployment_id TEXT NOT NULL UNIQUE,
                    read_enabled INTEGER NOT NULL DEFAULT 1,
                    contribute_enabled INTEGER NOT NULL DEFAULT 0,
                    created_unix INTEGER NOT NULL,
                    expires_unix INTEGER
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS corpus_contexts (
                    keywords_hash TEXT PRIMARY KEY,
                    keywords TEXT NOT NULL,
                    time INTEGER NOT NULL,
                    trigger_count INTEGER NOT NULL DEFAULT 1,
                    clear_time INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS corpus_answers (
                    keywords_hash TEXT NOT NULL,
                    answer_keywords TEXT NOT NULL,
                    group_id INTEGER NOT NULL DEFAULT 0,
                    count INTEGER NOT NULL DEFAULT 1,
                    time INTEGER NOT NULL,
                    messages_json TEXT NOT NULL DEFAULT '[]',
                    PRIMARY KEY (keywords_hash, group_id, answer_keywords)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_corpus_answers_hash ON corpus_answers(keywords_hash)")
            conn.commit()

    def enroll(
        self,
        *,
        deployment_id: str,
        read_enabled: bool,
        contribute_enabled: bool,
        token_ttl_sec: int | None,
    ) -> tuple[str, int | None]:
        token = new_corpus_token()
        token_hash = hash_corpus_token(token)
        now = int(time.time())
        expires = now + token_ttl_sec if token_ttl_sec and token_ttl_sec > 0 else None
        read_i = 1 if read_enabled else 0
        contrib_i = 1 if contribute_enabled else 0
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM corpus_tokens WHERE deployment_id = ?", (deployment_id,))
            conn.execute(
                """
                INSERT INTO corpus_tokens (
                    token_hash, deployment_id, read_enabled, contribute_enabled,
                    created_unix, expires_unix
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (token_hash, deployment_id, read_i, contrib_i, now, expires),
            )
            conn.commit()
        return token, expires

    def resolve_token(self, token: str) -> CorpusTokenRecord | None:
        token_hash = hash_corpus_token(token)
        now = int(time.time())
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT deployment_id, read_enabled, contribute_enabled, expires_unix
                FROM corpus_tokens WHERE token_hash = ?
                """,
                (token_hash,),
            ).fetchone()
        if row is None:
            return None
        expires = row["expires_unix"]
        if expires is not None and int(expires) < now:
            return None
        return CorpusTokenRecord(
            deployment_id=str(row["deployment_id"]),
            read_enabled=bool(row["read_enabled"]),
            contribute_enabled=bool(row["contribute_enabled"]),
            expires_unix=int(expires) if expires is not None else None,
        )

    def get_context(self, keywords: str) -> dict[str, Any] | None:
        khash = keywords_hash(keywords)
        with self._lock, self._connect() as conn:
            ctx = conn.execute(
                "SELECT keywords, time, trigger_count, clear_time FROM corpus_contexts WHERE keywords_hash = ?",
                (khash,),
            ).fetchone()
            if ctx is None:
                return None
            answer_rows = conn.execute(
                """
                SELECT answer_keywords, group_id, count, time, messages_json
                FROM corpus_answers WHERE keywords_hash = ?
                ORDER BY count DESC, time DESC
                """,
                (khash,),
            ).fetchall()
        answers = [
            {
                "keywords": str(r["answer_keywords"]),
                "group_id": int(r["group_id"]),
                "count": int(r["count"]),
                "time": int(r["time"]),
                "messages": loads_messages(r["messages_json"]),
            }
            for r in answer_rows
        ]
        return context_payload(
            keywords=str(ctx["keywords"]),
            time=int(ctx["time"]),
            trigger_count=int(ctx["trigger_count"]),
            clear_time=int(ctx["clear_time"]),
            answers=answers,
        )

    def insert_context(self, *, keywords: str, time: int, answers: list[dict[str, Any]]) -> None:
        khash = keywords_hash(keywords)
        now = int(time.time())
        ctx_time = int(time) if time > 0 else now
        trigger = max(1, len(answers))
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO corpus_contexts (keywords_hash, keywords, time, trigger_count, clear_time)
                VALUES (?, ?, ?, ?, 0)
                ON CONFLICT(keywords_hash) DO UPDATE SET
                    time = excluded.time,
                    trigger_count = MAX(corpus_contexts.trigger_count, excluded.trigger_count)
                """,
                (khash, keywords, ctx_time, trigger),
            )
            for ans in answers:
                self._upsert_answer_row(
                    conn,
                    khash=khash,
                    group_id=int(ans.get("group_id") or 0),
                    answer_keywords=str(ans.get("keywords") or ""),
                    answer_time=int(ans.get("time") or now),
                    message=None,
                    append_on_existing=True,
                    preset_count=int(ans.get("count") or 1),
                    preset_messages=[str(m) for m in (ans.get("messages") or []) if m is not None],
                )
            conn.commit()

    def upsert_answer(
        self,
        *,
        keywords: str,
        group_id: int,
        answer_keywords: str,
        answer_time: int,
        message: str,
        append_on_existing: bool,
    ) -> None:
        khash = keywords_hash(keywords)
        now = int(time.time())
        atime = int(answer_time) if answer_time > 0 else now
        with self._lock, self._connect() as conn:
            exists = conn.execute(
                "SELECT 1 FROM corpus_contexts WHERE keywords_hash = ?",
                (khash,),
            ).fetchone()
            if not exists:
                conn.execute(
                    """
                    INSERT INTO corpus_contexts (keywords_hash, keywords, time, trigger_count, clear_time)
                    VALUES (?, ?, ?, 1, 0)
                    """,
                    (khash, keywords, atime),
                )
            else:
                conn.execute(
                    """
                    UPDATE corpus_contexts
                    SET trigger_count = trigger_count + 1, time = ?
                    WHERE keywords_hash = ?
                    """,
                    (atime, khash),
                )
            self._upsert_answer_row(
                conn,
                khash=khash,
                group_id=int(group_id),
                answer_keywords=answer_keywords,
                answer_time=atime,
                message=message,
                append_on_existing=append_on_existing,
            )
            conn.commit()

    def _upsert_answer_row(
        self,
        conn: sqlite3.Connection,
        *,
        khash: str,
        group_id: int,
        answer_keywords: str,
        answer_time: int,
        message: str | None,
        append_on_existing: bool,
        preset_count: int | None = None,
        preset_messages: list[str] | None = None,
    ) -> None:
        row = conn.execute(
            """
            SELECT count, time, messages_json FROM corpus_answers
            WHERE keywords_hash = ? AND group_id = ? AND answer_keywords = ?
            """,
            (khash, group_id, answer_keywords),
        ).fetchone()
        if row is None:
            messages = list(preset_messages or [])
            if message and (append_on_existing or not messages):
                if message not in messages:
                    messages.append(message)
            conn.execute(
                """
                INSERT INTO corpus_answers (
                    keywords_hash, answer_keywords, group_id, count, time, messages_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    khash,
                    answer_keywords,
                    group_id,
                    int(preset_count or 1),
                    answer_time,
                    dumps_messages(messages),
                ),
            )
            return
        count = int(row["count"]) + 1 if preset_count is None else int(preset_count)
        messages = loads_messages(row["messages_json"])
        if preset_messages:
            for m in preset_messages:
                if m not in messages:
                    messages.append(m)
        if message and append_on_existing and message not in messages:
            messages.append(message)
        conn.execute(
            """
            UPDATE corpus_answers
            SET count = ?, time = ?, messages_json = ?
            WHERE keywords_hash = ? AND group_id = ? AND answer_keywords = ?
            """,
            (count, answer_time, dumps_messages(messages), khash, group_id, answer_keywords),
        )
