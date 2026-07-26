from __future__ import annotations

import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from threading import Lock


@dataclass(frozen=True)
class GalleryPostRow:
    id: str
    deployment_id: str
    text: str
    source: str
    keywords: str
    bot_qq: int | None
    nickname: str
    avatar_url: str
    image_path: str | None
    status: str
    created_unix: int


class GalleryStore:
    def __init__(self, db_path: Path, *, media_root: Path) -> None:
        self._db_path = db_path
        self._media_root = media_root
        self._lock = Lock()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        media_root.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @property
    def media_root(self) -> Path:
        return self._media_root

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS gallery_posts (
                    id TEXT NOT NULL PRIMARY KEY,
                    deployment_id TEXT NOT NULL,
                    text TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT 'manual',
                    keywords TEXT NOT NULL DEFAULT '',
                    bot_qq INTEGER,
                    nickname TEXT NOT NULL DEFAULT '',
                    avatar_url TEXT NOT NULL DEFAULT '',
                    image_path TEXT,
                    status TEXT NOT NULL DEFAULT 'published',
                    created_unix INTEGER NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_gallery_posts_created ON gallery_posts(created_unix DESC)")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_gallery_posts_deployment "
                "ON gallery_posts(deployment_id, created_unix DESC)"
            )
            conn.commit()

    def count_since(self, *, deployment_id: str, since_unix: int) -> int:
        dep = (deployment_id or "").strip().lower()
        if not dep:
            return 0
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS n FROM gallery_posts
                WHERE deployment_id = ? AND created_unix >= ? AND status != 'hidden'
                """,
                (dep, int(since_unix)),
            ).fetchone()
            return int(row["n"] if row else 0)

    def create_post(
        self,
        *,
        deployment_id: str,
        text: str,
        source: str,
        keywords: str,
        bot_qq: int | None,
        nickname: str,
        avatar_url: str,
        image_relpath: str | None,
        created_unix: int | None = None,
    ) -> GalleryPostRow:
        dep = (deployment_id or "").strip().lower()
        if not dep:
            raise ValueError("deployment_id required")
        post_id = uuid.uuid4().hex
        now = int(created_unix if created_unix is not None else time.time())
        src = (source or "manual").strip() or "manual"
        if src not in {"manual", "local_corpus"}:
            src = "manual"
        row = GalleryPostRow(
            id=post_id,
            deployment_id=dep,
            text=(text or "").strip(),
            source=src,
            keywords=(keywords or "").strip()[:128],
            bot_qq=bot_qq,
            nickname=(nickname or "").strip()[:64],
            avatar_url=(avatar_url or "").strip()[:512],
            image_path=image_relpath,
            status="published",
            created_unix=now,
        )
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO gallery_posts (
                    id, deployment_id, text, source, keywords, bot_qq, nickname,
                    avatar_url, image_path, status, created_unix
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row.id,
                    row.deployment_id,
                    row.text,
                    row.source,
                    row.keywords,
                    row.bot_qq,
                    row.nickname,
                    row.avatar_url,
                    row.image_path,
                    row.status,
                    row.created_unix,
                ),
            )
            conn.commit()
        return row

    def get_post(self, post_id: str) -> GalleryPostRow | None:
        pid = (post_id or "").strip()
        if not pid:
            return None
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM gallery_posts WHERE id = ?", (pid,)).fetchone()
        return self._row_to_post(row) if row else None

    def hide_post(self, *, post_id: str, deployment_id: str) -> bool:
        pid = (post_id or "").strip()
        dep = (deployment_id or "").strip().lower()
        if not pid or not dep:
            return False
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE gallery_posts SET status = 'hidden'
                WHERE id = ? AND deployment_id = ? AND status = 'published'
                """,
                (pid, dep),
            )
            conn.commit()
            return cur.rowcount > 0

    def hide_post_any(self, *, post_id: str) -> bool:
        pid = (post_id or "").strip()
        if not pid:
            return False
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE gallery_posts SET status = 'hidden'
                WHERE id = ? AND status = 'published'
                """,
                (pid,),
            )
            conn.commit()
            return cur.rowcount > 0

    def list_published(
        self,
        *,
        limit: int = 48,
        before_unix: int | None = None,
        deployment_id: str | None = None,
    ) -> list[GalleryPostRow]:
        lim = max(1, min(int(limit), 100))
        params: list[object] = []
        where = ["status = 'published'"]
        if before_unix is not None:
            where.append("created_unix < ?")
            params.append(int(before_unix))
        if deployment_id:
            where.append("deployment_id = ?")
            params.append(deployment_id.strip().lower())
        params.append(lim)
        sql = f"""
            SELECT * FROM gallery_posts
            WHERE {" AND ".join(where)}
            ORDER BY created_unix DESC
            LIMIT ?
        """
        with self._lock, self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._row_to_post(r) for r in rows]

    def resolve_image_path(self, relpath: str) -> Path | None:
        rel = (relpath or "").strip().lstrip("/")
        if not rel or ".." in rel.split("/"):
            return None
        path = (self._media_root / rel).resolve()
        try:
            path.relative_to(self._media_root.resolve())
        except ValueError:
            return None
        return path if path.is_file() else None

    @staticmethod
    def _row_to_post(row: sqlite3.Row) -> GalleryPostRow:
        qq_raw = row["bot_qq"]
        return GalleryPostRow(
            id=str(row["id"]),
            deployment_id=str(row["deployment_id"]),
            text=str(row["text"] or ""),
            source=str(row["source"] or "manual"),
            keywords=str(row["keywords"] or ""),
            bot_qq=int(qq_raw) if qq_raw is not None else None,
            nickname=str(row["nickname"] or ""),
            avatar_url=str(row["avatar_url"] or ""),
            image_path=str(row["image_path"]) if row["image_path"] else None,
            status=str(row["status"] or "published"),
            created_unix=int(row["created_unix"]),
        )
