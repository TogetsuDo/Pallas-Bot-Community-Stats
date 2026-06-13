from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from pallas_community_stats.roster_util import bot_key_for_qq, qq_avatar_url, qq_profile_deep_link


@dataclass(frozen=True)
class RosterUpsertEntry:
    qq: int
    nickname: str
    online: bool
    message_weight: int


@dataclass(frozen=True)
class BubbleBotRow:
    bot_key: str
    qq: int
    nickname: str
    avatar_url: str
    profile_url: str
    online: bool
    message_weight: int


class RosterStore:
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
                CREATE TABLE IF NOT EXISTS roster_bots (
                    deployment_id TEXT NOT NULL,
                    bot_key TEXT NOT NULL,
                    qq INTEGER NOT NULL,
                    nickname TEXT NOT NULL DEFAULT '',
                    online INTEGER NOT NULL DEFAULT 0,
                    message_weight INTEGER NOT NULL DEFAULT 0,
                    updated_unix INTEGER NOT NULL,
                    PRIMARY KEY (deployment_id, bot_key)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_roster_bots_bot_key ON roster_bots(bot_key)")
            conn.commit()

    def clear_deployment_roster(self, deployment_id: str) -> None:
        dep = (deployment_id or "").strip().lower()
        if not dep:
            return
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM roster_bots WHERE deployment_id = ?", (dep,))
            conn.commit()

    def replace_deployment_roster(
        self,
        *,
        deployment_id: str,
        entries: list[RosterUpsertEntry],
        seen_unix: int,
    ) -> None:
        dep = (deployment_id or "").strip().lower()
        if not dep:
            return
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM roster_bots WHERE deployment_id = ?", (dep,))
            for entry in entries:
                conn.execute(
                    """
                    INSERT INTO roster_bots (
                        deployment_id, bot_key, qq, nickname, online,
                        message_weight, updated_unix
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        dep,
                        bot_key_for_qq(entry.qq),
                        int(entry.qq),
                        (entry.nickname or "").strip()[:64],
                        1 if entry.online else 0,
                        int(entry.message_weight),
                        seen_unix,
                    ),
                )
            conn.commit()

    def aggregate_bubble(self, *, online_ttl_sec: int) -> list[BubbleBotRow]:
        cutoff = int(time.time()) - online_ttl_sec
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT rb.bot_key, rb.qq, rb.nickname, rb.online,
                       rb.message_weight, rb.updated_unix
                FROM roster_bots rb
                INNER JOIN deployments d ON d.deployment_id = rb.deployment_id
                WHERE d.last_seen_unix >= ?
                ORDER BY rb.updated_unix DESC
                """,
                (cutoff,),
            ).fetchall()

        merged: dict[str, dict[str, object]] = {}
        for row in rows:
            key = str(row["bot_key"])
            bucket = merged.get(key)
            if bucket is None:
                merged[key] = {
                    "qq": int(row["qq"]),
                    "nickname": str(row["nickname"] or ""),
                    "online": bool(row["online"]),
                    "message_weight": int(row["message_weight"]),
                    "updated_unix": int(row["updated_unix"]),
                }
                continue
            bucket["online"] = bool(bucket["online"]) or bool(row["online"])
            bucket["message_weight"] = max(int(bucket["message_weight"]), int(row["message_weight"]))
            nick = str(row["nickname"] or "").strip()
            if nick and int(row["updated_unix"]) >= int(bucket["updated_unix"]):
                bucket["nickname"] = nick
                bucket["updated_unix"] = int(row["updated_unix"])

        out: list[BubbleBotRow] = []
        for bot_key, data in merged.items():
            qq = int(data["qq"])
            out.append(
                BubbleBotRow(
                    bot_key=bot_key,
                    qq=qq,
                    nickname=str(data["nickname"] or f"牛 {qq % 10000}"),
                    avatar_url=qq_avatar_url(qq),
                    profile_url=qq_profile_deep_link(qq),
                    online=bool(data["online"]),
                    message_weight=int(data["message_weight"]),
                )
            )
        out.sort(key=lambda row: (-row.message_weight, row.nickname.lower(), row.bot_key))
        return out
