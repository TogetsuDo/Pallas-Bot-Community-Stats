from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

GallerySource = Literal["manual", "local_corpus"]
GalleryStatus = Literal["published", "hidden"]


class GalleryBotSnapshot(BaseModel):
    qq: int | None = None
    nickname: str = ""
    avatar_url: str = ""


class GalleryPostPublic(BaseModel):
    id: str
    text: str = ""
    source: GallerySource = "manual"
    keywords: str = ""
    nickname: str = ""
    avatar_url: str = ""
    qq: int | None = None
    image_url: str | None = None
    created_at: str
    created_unix: int


class GalleryListResponse(BaseModel):
    as_of: str
    posts: list[GalleryPostPublic]
    next_cursor: str | None = None


class GalleryCreateResponse(BaseModel):
    id: str
    created_at: str


class GalleryDeleteResponse(BaseModel):
    ok: bool = True
    id: str
