from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse

from pallas_community_stats.baidu_censor import BaiduCensorClient
from pallas_community_stats.config import Settings
from pallas_community_stats.corpus_store import CorpusStore
from pallas_community_stats.gallery_censor import moderate_gallery_content
from pallas_community_stats.gallery_models import (
    GalleryCreateResponse,
    GalleryDeleteResponse,
    GalleryListResponse,
    GalleryPostPublic,
)
from pallas_community_stats.gallery_store import GalleryStore
from pallas_community_stats.ratelimit import RateLimitExceeded, check_heartbeat_rate_limit, client_ip
from pallas_community_stats.roster_util import qq_avatar_url

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_TEXT_CHARS = 500


def _as_of() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _iso_from_unix(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _public_post(request: Request, row) -> GalleryPostPublic:
    image_url = None
    if row.image_path:
        image_url = str(request.url_for("gallery_image", post_id=row.id))
    return GalleryPostPublic(
        id=row.id,
        text=row.text,
        source=row.source if row.source in {"manual", "local_corpus"} else "manual",
        keywords=row.keywords,
        nickname=row.nickname,
        avatar_url=row.avatar_url or (qq_avatar_url(row.bot_qq) if row.bot_qq else ""),
        qq=row.bot_qq,
        image_url=image_url,
        created_at=_iso_from_unix(row.created_unix),
        created_unix=row.created_unix,
    )


def _public_deployment_id(visitor_id: str) -> str:
    return f"web-{visitor_id}"


def _validate_visitor_id(raw: str | None) -> str:
    vid = (raw or "").strip().lower()
    try:
        uuid.UUID(vid)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid visitor_id") from exc
    return vid


async def _read_image_upload(image: UploadFile | None) -> tuple[bytes | None, str | None]:
    if image is None or not image.filename:
        return None, None
    content_type = (image.content_type or "").split(";")[0].strip().lower()
    image_ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if not image_ext:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unsupported image type")
    image_raw = await image.read()
    if len(image_raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="image too large")
    if not image_raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty image")
    return image_raw, image_ext


def _check_gallery_rate_limit(
    *,
    store: GalleryStore,
    deployment_id: str,
    per_hour: int,
    per_day: int,
) -> None:
    now = int(time.time())
    hour_n = store.count_since(deployment_id=deployment_id, since_unix=now - 3600)
    if hour_n >= per_hour:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="hourly limit exceeded")
    day_n = store.count_since(deployment_id=deployment_id, since_unix=now - 86400)
    if day_n >= per_day:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="daily limit exceeded")


async def _create_gallery_post(
    *,
    store: GalleryStore,
    settings: Settings,
    censor: BaiduCensorClient | None,
    deployment_id: str,
    text: str,
    source: str,
    keywords: str,
    nickname: str,
    avatar_url: str,
    bot_qq: int | None,
    image_raw: bytes | None,
    image_ext: str | None,
    per_hour: int,
    per_day: int,
    require_image: bool = False,
) -> GalleryCreateResponse:
    body = (text or "").strip()
    if len(body) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text too long")
    nick = (nickname or "").strip() or "牛牛"

    _check_gallery_rate_limit(
        store=store,
        deployment_id=deployment_id,
        per_hour=per_hour,
        per_day=per_day,
    )

    if require_image and not image_raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="image required")
    if not body and not image_raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text or image required")

    mod = await moderate_gallery_content(
        censor=censor,
        settings=settings,
        text=body,
        image_bytes=image_raw,
    )
    if mod.rejected:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="content rejected by moderation",
        )

    image_rel: str | None = None
    if image_raw and image_ext:
        yyyy = datetime.now(UTC).strftime("%Y")
        rel = f"{yyyy}/{uuid_name()}{image_ext}"
        dest = store.media_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(image_raw)
        image_rel = rel

    av = (avatar_url or "").strip()
    if not av and bot_qq:
        av = qq_avatar_url(int(bot_qq))

    now = int(time.time())
    row = store.create_post(
        deployment_id=deployment_id,
        text=body,
        source=source,
        keywords=keywords,
        bot_qq=int(bot_qq) if bot_qq else None,
        nickname=nick,
        avatar_url=av,
        image_relpath=image_rel,
        created_unix=now,
        status=mod.status,
    )
    return GalleryCreateResponse(
        id=row.id,
        created_at=_iso_from_unix(row.created_unix),
        status=row.status if row.status in {"published", "pending", "hidden"} else "published",
    )


def build_gallery_router(
    *,
    store: GalleryStore,
    corpus_store: CorpusStore,
    settings: Settings,
    censor: BaiduCensorClient | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/v1/gallery", tags=["gallery"])

    def deployment_from_auth(authorization: str | None, deployment_id: str | None) -> str:
        if authorization and authorization.startswith("Bearer "):
            token = authorization.removeprefix("Bearer ").strip()
            record = corpus_store.resolve_token(token)
            if record is not None:
                return record.deployment_id
            hb = (settings.heartbeat_token or "").strip()
            if hb and token == hb:
                dep = (deployment_id or "").strip().lower()
                if not dep:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="deployment_id required")
                return dep
            if hb:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid bearer token")

        if not (settings.heartbeat_token or "").strip():
            dep = (deployment_id or "").strip().lower()
            if not dep:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="deployment_id required")
            return dep

        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing bearer token")

    @router.get("/posts", response_model=GalleryListResponse)
    async def list_posts(
        request: Request,
        limit: int = Query(default=48, ge=1, le=100),
        cursor: str | None = Query(default=None),
        deployment_id: str | None = Query(default=None),
    ) -> GalleryListResponse:
        before = None
        if cursor:
            try:
                before = int(cursor)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid cursor") from exc
        rows = store.list_published(limit=limit, before_unix=before, deployment_id=deployment_id)
        next_cursor = str(rows[-1].created_unix) if len(rows) >= limit else None
        return GalleryListResponse(
            as_of=_as_of(),
            posts=[_public_post(request, r) for r in rows],
            next_cursor=next_cursor,
        )

    @router.get("/images/{post_id}", name="gallery_image")
    async def gallery_image(post_id: str):
        row = store.get_post(post_id)
        if row is None or row.status != "published" or not row.image_path:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="image not found")
        path = store.resolve_image_path(row.image_path)
        if path is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="image missing")
        return FileResponse(path)

    @router.post("/posts", response_model=GalleryCreateResponse)
    async def create_post(
        text: str = Form(default=""),
        source: str = Form(default="manual"),
        keywords: str = Form(default=""),
        nickname: str = Form(default=""),
        avatar_url: str = Form(default=""),
        bot_qq: int | None = Form(default=None),
        deployment_id: str | None = Form(default=None),
        image: UploadFile | None = File(default=None),
        authorization: str | None = Header(default=None),
    ) -> GalleryCreateResponse:
        if not settings.gallery_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gallery disabled")
        deployment_id = deployment_from_auth(authorization, deployment_id)
        image_raw, image_ext = await _read_image_upload(image)
        return await _create_gallery_post(
            store=store,
            settings=settings,
            censor=censor,
            deployment_id=deployment_id,
            text=text,
            source=source,
            keywords=keywords,
            nickname=nickname,
            avatar_url=avatar_url,
            bot_qq=bot_qq,
            image_raw=image_raw,
            image_ext=image_ext,
            per_hour=settings.gallery_per_hour,
            per_day=settings.gallery_per_day,
        )

    @router.post("/public/posts", response_model=GalleryCreateResponse)
    async def create_public_post(
        request: Request,
        visitor_id: str = Form(...),
        image: UploadFile = File(...),
    ) -> GalleryCreateResponse:
        if not settings.gallery_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gallery disabled")
        if not settings.gallery_public_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gallery public disabled")
        vid = _validate_visitor_id(visitor_id)
        deployment_id = _public_deployment_id(vid)
        try:
            check_heartbeat_rate_limit(
                client_host=client_ip(request),
                deployment_id=deployment_id,
                per_ip_per_min=settings.heartbeat_rate_per_ip_per_min,
                min_interval_per_deployment_sec=settings.heartbeat_min_interval_sec,
            )
        except RateLimitExceeded as exc:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)) from exc
        image_raw, image_ext = await _read_image_upload(image)
        return await _create_gallery_post(
            store=store,
            settings=settings,
            censor=censor,
            deployment_id=deployment_id,
            text="",
            source="manual",
            keywords="",
            nickname="",
            avatar_url="",
            bot_qq=None,
            image_raw=image_raw,
            image_ext=image_ext,
            per_hour=settings.gallery_public_per_hour,
            per_day=settings.gallery_public_per_day,
            require_image=True,
        )

    @router.delete("/posts/{post_id}", response_model=GalleryDeleteResponse)
    async def delete_post(
        post_id: str,
        deployment_id: str | None = Query(default=None),
        authorization: str | None = Header(default=None),
    ) -> GalleryDeleteResponse:
        if not settings.gallery_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gallery disabled")
        dep = deployment_from_auth(authorization, deployment_id)
        ok = store.hide_post(post_id=post_id, deployment_id=dep)
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="post not found")
        return GalleryDeleteResponse(id=post_id)

    return router


def uuid_name() -> str:
    import uuid

    return uuid.uuid4().hex
