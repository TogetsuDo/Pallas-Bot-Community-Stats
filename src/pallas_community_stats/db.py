from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock


@dataclass(frozen=True)
class DeploymentSnapshot:
    deployment_id: str
    first_seen_unix: int
    last_seen_unix: int
    version: str
    online_bots: int
    catalog_bots: int
    sharded: bool
    shard_workers: int | None


@dataclass(frozen=True)
class StatsSnapshot:
    deployments_total: int
    deployments_online: int
    bots_online_sum: int
    deployments_online_sharded: int = 0
    shard_workers_online_sum: int = 0


class StatsStore:
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
                CREATE TABLE IF NOT EXISTS deployments (
                    deployment_id TEXT PRIMARY KEY,
                    first_seen_unix INTEGER NOT NULL,
                    last_seen_unix INTEGER NOT NULL,
                    version TEXT NOT NULL DEFAULT '',
                    online_bots INTEGER NOT NULL DEFAULT 0,
                    catalog_bots INTEGER NOT NULL DEFAULT 0,
                    sharded INTEGER NOT NULL DEFAULT 0,
                    shard_workers INTEGER
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_deployments_last_seen ON deployments(last_seen_unix)")
            conn.commit()

    def upsert_heartbeat(
        self,
        *,
        deployment_id: str,
        seen_unix: int,
        version: str,
        online_bots: int,
        catalog_bots: int,
        sharded: bool,
        shard_workers: int | None,
    ) -> None:
        sharded_int = 1 if sharded else 0
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO deployments (
                    deployment_id, first_seen_unix, last_seen_unix,
                    version, online_bots, catalog_bots, sharded, shard_workers
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(deployment_id) DO UPDATE SET
                    last_seen_unix = excluded.last_seen_unix,
                    version = excluded.version,
                    online_bots = excluded.online_bots,
                    catalog_bots = excluded.catalog_bots,
                    sharded = excluded.sharded,
                    shard_workers = excluded.shard_workers
                """,
                (
                    deployment_id,
                    seen_unix,
                    seen_unix,
                    version,
                    online_bots,
                    catalog_bots,
                    sharded_int,
                    shard_workers,
                ),
            )
            conn.commit()

    def aggregate_stats(self, *, online_ttl_sec: int) -> StatsSnapshot:
        cutoff = int(time.time()) - online_ttl_sec
        with self._lock, self._connect() as conn:
            total_row = conn.execute("SELECT COUNT(*) AS c FROM deployments").fetchone()
            online_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS deployments_online,
                    COALESCE(SUM(online_bots), 0) AS bots_online_sum,
                    COALESCE(SUM(CASE WHEN sharded = 1 THEN 1 ELSE 0 END), 0)
                        AS deployments_online_sharded,
                    COALESCE(SUM(CASE WHEN sharded = 1 THEN COALESCE(shard_workers, 0) ELSE 0 END), 0)
                        AS shard_workers_online_sum
                FROM deployments
                WHERE last_seen_unix >= ?
                """,
                (cutoff,),
            ).fetchone()
        return StatsSnapshot(
            deployments_total=int(total_row["c"] if total_row else 0),
            deployments_online=int(online_row["deployments_online"] if online_row else 0),
            bots_online_sum=int(online_row["bots_online_sum"] if online_row else 0),
            deployments_online_sharded=int(
                online_row["deployments_online_sharded"] if online_row else 0
            ),
            shard_workers_online_sum=int(
                online_row["shard_workers_online_sum"] if online_row else 0
            ),
        )
