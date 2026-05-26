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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS federation_bootstrap (
                    deployment_id TEXT PRIMARY KEY,
                    federate_id TEXT NOT NULL,
                    first_bootstrap_unix INTEGER NOT NULL,
                    last_bootstrap_unix INTEGER NOT NULL,
                    bootstrap_count INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_federation_bootstrap_last ON federation_bootstrap(last_bootstrap_unix)"
            )
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

    def record_federation_bootstrap(
        self,
        *,
        deployment_id: str,
        federate_id: str,
        seen_unix: int,
    ) -> None:
        dep = (deployment_id or "").strip().lower()
        fid = (federate_id or "").strip()
        if not dep or not fid:
            return
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT bootstrap_count FROM federation_bootstrap WHERE deployment_id = ?",
                (dep,),
            ).fetchone()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO federation_bootstrap (
                        deployment_id, federate_id, first_bootstrap_unix,
                        last_bootstrap_unix, bootstrap_count
                    ) VALUES (?, ?, ?, ?, 1)
                    """,
                    (dep, fid, seen_unix, seen_unix),
                )
            else:
                conn.execute(
                    """
                    UPDATE federation_bootstrap
                    SET federate_id = ?, last_bootstrap_unix = ?, bootstrap_count = bootstrap_count + 1
                    WHERE deployment_id = ?
                    """,
                    (fid, seen_unix, dep),
                )
            conn.commit()

    def aggregate_federation_monitor(self, *, online_ttl_sec: int) -> dict[str, int]:
        cutoff = int(time.time()) - online_ttl_sec
        recent_cutoff = int(time.time()) - 86400
        with self._lock, self._connect() as conn:
            total_row = conn.execute("SELECT COUNT(*) AS c FROM federation_bootstrap").fetchone()
            recent_row = conn.execute(
                "SELECT COUNT(*) AS c FROM federation_bootstrap WHERE last_bootstrap_unix >= ?",
                (recent_cutoff,),
            ).fetchone()
            online_row = conn.execute(
                """
                SELECT COUNT(*) AS c
                FROM federation_bootstrap f
                INNER JOIN deployments d ON d.deployment_id = f.deployment_id
                WHERE d.last_seen_unix >= ?
                """,
                (cutoff,),
            ).fetchone()
        return {
            "members_total": int(total_row["c"] if total_row else 0),
            "members_online": int(online_row["c"] if online_row else 0),
            "members_recent_24h": int(recent_row["c"] if recent_row else 0),
        }

    def aggregate_deployment_monitor(self, *, online_ttl_sec: int) -> dict[str, int | list[dict[str, int | str]]]:
        cutoff = int(time.time()) - online_ttl_sec
        recent_cutoff = int(time.time()) - 86400
        with self._lock, self._connect() as conn:
            total_row = conn.execute("SELECT COUNT(*) AS c FROM deployments").fetchone()
            online_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS deployments_online,
                    COALESCE(SUM(online_bots), 0) AS bots_online_sum,
                    COALESCE(SUM(catalog_bots), 0) AS catalog_bots_online_sum,
                    COALESCE(SUM(CASE WHEN sharded = 1 THEN 1 ELSE 0 END), 0)
                        AS deployments_online_sharded,
                    COALESCE(SUM(CASE WHEN sharded = 1 THEN COALESCE(shard_workers, 0) ELSE 0 END), 0)
                        AS shard_workers_online_sum
                FROM deployments
                WHERE last_seen_unix >= ?
                """,
                (cutoff,),
            ).fetchone()
            recent_row = conn.execute(
                "SELECT COUNT(*) AS c FROM deployments WHERE last_seen_unix >= ?",
                (recent_cutoff,),
            ).fetchone()
            version_rows = conn.execute(
                """
                SELECT version, COUNT(*) AS c
                FROM deployments
                WHERE last_seen_unix >= ? AND version != ''
                GROUP BY version
                ORDER BY c DESC, version ASC
                LIMIT 5
                """,
                (cutoff,),
            ).fetchall()
        online_versions = [{"version": str(row["version"]), "count": int(row["c"])} for row in version_rows]
        return {
            "deployments_total": int(total_row["c"] if total_row else 0),
            "deployments_online": int(online_row["deployments_online"] if online_row else 0),
            "bots_online_sum": int(online_row["bots_online_sum"] if online_row else 0),
            "catalog_bots_online_sum": int(online_row["catalog_bots_online_sum"] if online_row else 0),
            "deployments_online_sharded": int(online_row["deployments_online_sharded"] if online_row else 0),
            "shard_workers_online_sum": int(online_row["shard_workers_online_sum"] if online_row else 0),
            "active_recent_24h": int(recent_row["c"] if recent_row else 0),
            "online_versions": online_versions,
        }

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
            deployments_online_sharded=int(online_row["deployments_online_sharded"] if online_row else 0),
            shard_workers_online_sum=int(online_row["shard_workers_online_sum"] if online_row else 0),
        )
