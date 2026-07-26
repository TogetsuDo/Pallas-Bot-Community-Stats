from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel

from pallas_community_stats.config import Settings
from pallas_community_stats.gallery_admin_auth import (
    COOKIE_NAME,
    SESSION_TTL_SEC,
    mint_admin_session,
    verify_admin_session,
)
from pallas_community_stats.gallery_models import (
    GalleryAdminLoginBody,
    GalleryAdminOkResponse,
    GalleryAdminStatusResponse,
    GalleryDeleteResponse,
    GalleryPostPublic,
)
from pallas_community_stats.gallery_store import GalleryStore
from pallas_community_stats.roster_util import qq_avatar_url


class GalleryAdminPost(GalleryPostPublic):
    deployment_id: str = ""
    has_image: bool = False


class GalleryAdminListResponse(BaseModel):
    as_of: str
    posts: list[GalleryAdminPost]
    next_cursor: str | None = None


def _as_of() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _iso_from_unix(ts: int) -> str:
    return datetime.fromtimestamp(int(ts), tz=UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _admin_secret(settings: Settings) -> str:
    return (settings.gallery_admin_secret or "").strip()


def _admin_enabled(settings: Settings) -> bool:
    return bool(settings.gallery_enabled and _admin_secret(settings))


def _cookie_kwargs(*, secure: bool) -> dict:
    return {
        "httponly": True,
        "samesite": "lax",
        "path": "/",
        "max_age": SESSION_TTL_SEC,
        "secure": secure,
    }


def build_gallery_admin_router(*, store: GalleryStore, settings: Settings) -> APIRouter:
    router = APIRouter(prefix="/v1/gallery/admin", tags=["gallery-admin"])

    def require_admin(request: Request) -> None:
        if not settings.gallery_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gallery disabled")
        secret = _admin_secret(settings)
        if not secret:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gallery admin disabled")
        token = request.cookies.get(COOKIE_NAME)
        if not verify_admin_session(secret, token):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="admin auth required")

    def public_admin_post(request: Request, row) -> GalleryAdminPost:
        image_url = None
        if row.image_path:
            image_url = str(request.url_for("gallery_image", post_id=row.id))
        return GalleryAdminPost(
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
            deployment_id=row.deployment_id,
            has_image=bool(row.image_path),
        )

    @router.get("/status", response_model=GalleryAdminStatusResponse)
    async def admin_status(request: Request) -> GalleryAdminStatusResponse:
        secret = _admin_secret(settings)
        enabled = _admin_enabled(settings)
        authed = bool(enabled and verify_admin_session(secret, request.cookies.get(COOKIE_NAME)))
        return GalleryAdminStatusResponse(enabled=enabled, authenticated=authed)

    @router.post("/login", response_model=GalleryAdminOkResponse)
    async def admin_login(body: GalleryAdminLoginBody, request: Request, response: Response) -> GalleryAdminOkResponse:
        if not settings.gallery_enabled:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gallery disabled")
        secret = _admin_secret(settings)
        if not secret:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gallery admin disabled")
        provided = (body.secret or "").strip()
        if not provided or not _secret_matches(secret, provided):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid admin secret")
        token = mint_admin_session(secret)
        secure = request.url.scheme == "https"
        response.set_cookie(COOKIE_NAME, token, **_cookie_kwargs(secure=secure))
        return GalleryAdminOkResponse()

    @router.post("/logout", response_model=GalleryAdminOkResponse)
    async def admin_logout(request: Request, response: Response) -> GalleryAdminOkResponse:
        secure = request.url.scheme == "https"
        response.delete_cookie(COOKIE_NAME, path="/", secure=secure, httponly=True, samesite="lax")
        return GalleryAdminOkResponse()

    @router.get("/posts", response_model=GalleryAdminListResponse)
    async def admin_list_posts(
        request: Request,
        limit: int = Query(default=48, ge=1, le=100),
        cursor: str | None = Query(default=None),
    ) -> GalleryAdminListResponse:
        require_admin(request)
        before = None
        if cursor:
            try:
                before = int(cursor)
            except ValueError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid cursor") from exc
        rows = store.list_published(limit=limit, before_unix=before)
        next_cursor = str(rows[-1].created_unix) if len(rows) >= limit else None
        return GalleryAdminListResponse(
            as_of=_as_of(),
            posts=[public_admin_post(request, r) for r in rows],
            next_cursor=next_cursor,
        )

    @router.delete("/posts/{post_id}", response_model=GalleryDeleteResponse)
    async def admin_delete_post(post_id: str, request: Request) -> GalleryDeleteResponse:
        require_admin(request)
        ok = store.hide_post_any(post_id=post_id)
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="post not found")
        return GalleryDeleteResponse(id=post_id)

    return router


def _secret_matches(expected: str, provided: str) -> bool:
    return hmac.compare_digest(
        hashlib.sha256(expected.encode("utf-8")).digest(),
        hashlib.sha256(provided.encode("utf-8")).digest(),
    )
