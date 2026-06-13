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
    plain_message_text,
)


@dataclass(frozen=True)
class CorpusTokenRecord:
    deployment_id: str
    read_enabled: bool
    contribute_enabled: bool
    expires_unix: int | None


HOT_CORPUS_PERIOD_SEC = {"day": 86400, "week": 604800, "month": 2592000}


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
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_corpus_answers_group_hash ON corpus_answers(group_id, keywords_hash)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS corpus_hot_snapshot (
                    deployment_id TEXT NOT NULL,
                    keywords_hash TEXT NOT NULL,
                    keywords TEXT NOT NULL,
                    score INTEGER NOT NULL,
                    as_of_unix INTEGER NOT NULL,
                    PRIMARY KEY (deployment_id, keywords_hash)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_corpus_hot_snapshot_as_of ON corpus_hot_snapshot(as_of_unix)")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS corpus_deployment_usage (
                    deployment_id TEXT PRIMARY KEY,
                    read_lookups INTEGER NOT NULL DEFAULT 0,
                    read_hits INTEGER NOT NULL DEFAULT 0,
                    contribute_ok INTEGER NOT NULL DEFAULT 0,
                    updated_unix INTEGER NOT NULL DEFAULT 0
                )
                """
            )
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
                "keywords": plain_message_text(str(r["answer_keywords"])),
                "group_id": int(r["group_id"]),
                "count": int(r["count"]),
                "time": int(r["time"]),
                "messages": [t for m in loads_messages(r["messages_json"]) if (t := plain_message_text(str(m)))],
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

    def insert_context(self, *, keywords: str, context_time: int, answers: list[dict[str, Any]]) -> None:
        khash = keywords_hash(keywords)
        now = int(time.time())
        ctx_time = int(context_time) if context_time > 0 else now
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
                    group_id=0,
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
        message = plain_message_text(message or "") or None
        preset_messages = [plain_message_text(m) for m in (preset_messages or []) if plain_message_text(m)]
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

    def bump_usage(
        self,
        deployment_id: str,
        *,
        read_lookup: bool = False,
        read_hit: bool = False,
        contribute: bool = False,
    ) -> None:
        if not (read_lookup or read_hit or contribute):
            return
        dep = (deployment_id or "").strip().lower()
        if not dep:
            return
        now = int(time.time())
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO corpus_deployment_usage (
                    deployment_id, read_lookups, read_hits, contribute_ok, updated_unix
                ) VALUES (?, 0, 0, 0, ?)
                ON CONFLICT(deployment_id) DO NOTHING
                """,
                (dep, now),
            )
            if read_lookup:
                conn.execute(
                    """
                    UPDATE corpus_deployment_usage
                    SET read_lookups = read_lookups + 1, updated_unix = ?
                    WHERE deployment_id = ?
                    """,
                    (now, dep),
                )
            if read_hit:
                conn.execute(
                    """
                    UPDATE corpus_deployment_usage
                    SET read_hits = read_hits + 1, updated_unix = ?
                    WHERE deployment_id = ?
                    """,
                    (now, dep),
                )
            if contribute:
                conn.execute(
                    """
                    UPDATE corpus_deployment_usage
                    SET contribute_ok = contribute_ok + 1, updated_unix = ?
                    WHERE deployment_id = ?
                    """,
                    (now, dep),
                )
            conn.commit()

    def get_usage(self, deployment_id: str) -> dict[str, int | None]:
        dep = (deployment_id or "").strip().lower()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT read_lookups, read_hits, contribute_ok, updated_unix
                FROM corpus_deployment_usage WHERE deployment_id = ?
                """,
                (dep,),
            ).fetchone()
        if row is None:
            return {
                "read_lookups": 0,
                "read_hits": 0,
                "contribute_ok": 0,
                "updated_at": None,
            }
        updated = int(row["updated_unix"]) if row["updated_unix"] else None
        return {
            "read_lookups": int(row["read_lookups"]),
            "read_hits": int(row["read_hits"]),
            "contribute_ok": int(row["contribute_ok"]),
            "updated_at": updated if updated else None,
        }

    def aggregate_public_stats(self) -> dict[str, int]:
        return {
            k: int(v)
            for k, v in self.aggregate_monitor_stats(online_cutoff_unix=0).items()
            if k
            in {
                "contexts_total",
                "answers_total",
                "enrollments_total",
                "contribute_enabled_total",
            }
        }

    def aggregate_monitor_stats(self, *, online_cutoff_unix: int) -> dict[str, int]:
        recent_cutoff = int(time.time()) - 86400
        with self._lock, self._connect() as conn:
            ctx_row = conn.execute("SELECT COUNT(*) AS c FROM corpus_contexts").fetchone()
            ans_row = conn.execute("SELECT COUNT(*) AS c FROM corpus_answers").fetchone()
            hits_row = conn.execute("SELECT COALESCE(SUM(count), 0) AS s FROM corpus_answers").fetchone()
            enr_row = conn.execute("SELECT COUNT(*) AS c FROM corpus_tokens").fetchone()
            read_row = conn.execute("SELECT COUNT(*) AS c FROM corpus_tokens WHERE read_enabled = 1").fetchone()
            contrib_row = conn.execute(
                "SELECT COUNT(*) AS c FROM corpus_tokens WHERE contribute_enabled = 1"
            ).fetchone()
            recent_row = conn.execute(
                "SELECT COUNT(*) AS c FROM corpus_tokens WHERE created_unix >= ?",
                (recent_cutoff,),
            ).fetchone()
            if online_cutoff_unix > 0:
                online_row = conn.execute(
                    """
                    SELECT COUNT(*) AS c
                    FROM corpus_tokens t
                    INNER JOIN deployments d ON d.deployment_id = t.deployment_id
                    WHERE d.last_seen_unix >= ?
                    """,
                    (online_cutoff_unix,),
                ).fetchone()
            else:
                online_row = None
        enrollments_online = int(online_row["c"] if online_row else 0)
        return {
            "contexts_total": int(ctx_row["c"] if ctx_row else 0),
            "answers_total": int(ans_row["c"] if ans_row else 0),
            "answer_hits_sum": int(hits_row["s"] if hits_row else 0),
            "enrollments_total": int(enr_row["c"] if enr_row else 0),
            "enrollments_online": enrollments_online,
            "enrollments_recent_24h": int(recent_row["c"] if recent_row else 0),
            "read_enabled_total": int(read_row["c"] if read_row else 0),
            "contribute_enabled_total": int(contrib_row["c"] if contrib_row else 0),
        }

    _HOT_PERIOD_SEC = HOT_CORPUS_PERIOD_SEC

    def aggregate_hot_keywords(
        self,
        *,
        mode: str = "pool",
        period: str = "day",
        limit: int = 40,
        answers_per_keyword: int = 3,
    ) -> list[dict[str, object]]:
        mode = mode if mode in ("pool", "recent", "fleet") else "pool"
        limit = max(5, min(int(limit), 80))
        answers_per_keyword = max(1, min(int(answers_per_keyword), 8))
        if mode == "recent":
            window_sec = int(HOT_CORPUS_PERIOD_SEC.get(period, 86400))
            cutoff = int(time.time()) - window_sec
            time_filter = "AND a.time >= ?"
            keyword_params: tuple[int | str, ...] = (cutoff,)
            answer_time_filter = "AND time >= ?"
        elif mode == "fleet":
            return self.aggregate_hot_keywords_fleet(limit=limit)
        else:
            time_filter = ""
            keyword_params = ()
            answer_time_filter = ""
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT c.keywords_hash, c.keywords, SUM(a.count) AS score
                FROM corpus_answers a
                INNER JOIN corpus_contexts c ON c.keywords_hash = a.keywords_hash
                WHERE a.group_id = 0 {time_filter}
                GROUP BY c.keywords_hash
                ORDER BY score DESC, c.keywords ASC
                LIMIT ?
                """,
                (*keyword_params, max(limit * 4, limit)),
            ).fetchall()
            out: list[dict[str, object]] = []
            for row in rows:
                label = plain_message_text(str(row["keywords"] or ""))
                if not label:
                    continue
                khash = str(row["keywords_hash"])
                answer_params: tuple[int | str, ...] = (khash, *keyword_params, answers_per_keyword)
                answer_rows = conn.execute(
                    f"""
                    SELECT answer_keywords, count, messages_json
                    FROM corpus_answers
                    WHERE keywords_hash = ? AND group_id = 0 {answer_time_filter}
                    ORDER BY count DESC, answer_keywords ASC
                    LIMIT ?
                    """,
                    answer_params,
                ).fetchall()
                answers: list[dict[str, object]] = []
                for ans in answer_rows:
                    messages = loads_messages(ans["messages_json"])
                    message = ""
                    for raw in messages:
                        text = plain_message_text(str(raw))
                        if text:
                            message = text
                            break
                    if not message:
                        message = plain_message_text(str(ans["answer_keywords"] or ""))
                    if not message:
                        continue
                    if len(message) > 120:
                        message = message[:117] + "…"
                    answers.append(
                        {
                            "answer_keywords": str(ans["answer_keywords"] or ""),
                            "message": message,
                            "count": int(ans["count"] or 0),
                        }
                    )
                if not answers:
                    continue
                out.append(
                    {
                        "keywords": label,
                        "score": int(row["score"] or 0),
                        "answers": answers,
                    }
                )
                if len(out) >= limit:
                    break
        return out

    def upsert_hot_snapshot(
        self,
        *,
        deployment_id: str,
        as_of_unix: int,
        items: list[dict[str, object]],
    ) -> None:
        dep = (deployment_id or "").strip().lower()
        if not dep:
            return
        now = int(time.time())
        as_of = int(as_of_unix) if as_of_unix > 0 else now
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM corpus_hot_snapshot WHERE deployment_id = ?", (dep,))
            for row in items[:40]:
                label = plain_message_text(str(row.get("keywords") or ""))
                if not label:
                    continue
                khash = keywords_hash(label)
                score = max(0, int(row.get("score") or 0))
                conn.execute(
                    """
                    INSERT INTO corpus_hot_snapshot (
                        deployment_id, keywords_hash, keywords, score, as_of_unix
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (dep, khash, label, score, as_of),
                )
            conn.commit()

    def aggregate_hot_keywords_fleet(
        self,
        *,
        limit: int = 40,
        ttl_sec: int = 86400,
    ) -> list[dict[str, object]]:
        limit = max(5, min(int(limit), 80))
        cutoff = int(time.time()) - max(3600, int(ttl_sec))
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT keywords_hash, MAX(keywords) AS keywords, SUM(score) AS score
                FROM corpus_hot_snapshot
                WHERE as_of_unix >= ?
                GROUP BY keywords_hash
                ORDER BY score DESC, keywords ASC
                LIMIT ?
                """,
                (cutoff, limit),
            ).fetchall()
        out: list[dict[str, object]] = []
        for row in rows:
            label = plain_message_text(str(row["keywords"] or ""))
            if not label:
                continue
            out.append({"keywords": label, "score": int(row["score"] or 0), "answers": []})
        return out
