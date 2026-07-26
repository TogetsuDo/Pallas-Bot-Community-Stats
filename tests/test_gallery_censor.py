from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.baidu_censor import BaiduCensorClient, CensorDecision, CensorVerdict
from pallas_community_stats.config import Settings
from pallas_community_stats.gallery_censor import moderate_gallery_content


class FakeCensor(BaiduCensorClient):
    def __init__(self, text_v: CensorVerdict, image_v: CensorVerdict = CensorVerdict.COMPLIANT) -> None:
        super().__init__(api_key="ak", secret_key="sk")
        self._text_v = text_v
        self._image_v = image_v

    @property
    def enabled(self) -> bool:
        return True

    async def censor_text(self, text: str) -> CensorDecision:
        return CensorDecision(self._text_v, text)

    async def censor_image(self, image_bytes: bytes) -> CensorDecision:
        return CensorDecision(self._image_v, "img")


def test_moderate_maps_verdicts() -> None:
    settings = Settings(gallery_censor_image=True, gallery_censor_on_error="pending")

    async def run() -> None:
        ok = await moderate_gallery_content(
            censor=FakeCensor(CensorVerdict.COMPLIANT),
            settings=settings,
            text="你好",
            image_bytes=None,
        )
        assert ok.status == "published" and not ok.rejected

        bad = await moderate_gallery_content(
            censor=FakeCensor(CensorVerdict.NON_COMPLIANT),
            settings=settings,
            text="违规",
            image_bytes=None,
        )
        assert bad.rejected

        pending = await moderate_gallery_content(
            censor=FakeCensor(CensorVerdict.SUSPECTED),
            settings=settings,
            text="疑似",
            image_bytes=None,
        )
        assert pending.status == "pending" and not pending.rejected

        err = await moderate_gallery_content(
            censor=FakeCensor(CensorVerdict.ERROR),
            settings=settings,
            text="x",
            image_bytes=None,
        )
        assert err.status == "pending"

    asyncio.run(run())


def test_create_pending_and_admin_approve(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(
        db_path=tmp_path / "stats.db",
        heartbeat_token="",
        gallery_enabled=True,
        gallery_media_dir=tmp_path / "gallery",
        gallery_per_day=20,
        gallery_per_hour=20,
        gallery_admin_secret="admin-secret",
        baidu_censor_api_key="ak",
        baidu_censor_secret_key="sk",
        corpus_enabled=True,
    )
    app = create_app(settings)

    async def fake_moderate(**_kwargs):
        from pallas_community_stats.gallery_censor import GalleryModerationResult

        return GalleryModerationResult(status="pending")

    monkeypatch.setattr("pallas_community_stats.gallery_routes.moderate_gallery_content", fake_moderate)
    client = TestClient(app)

    created = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": "dep-mod", "text": "待审内容", "nickname": "牛牛"},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["status"] == "pending"
    post_id = body["id"]

    public = client.get("/v1/gallery/posts")
    assert public.json()["posts"] == []

    login = client.post("/v1/gallery/admin/login", json={"secret": "admin-secret"})
    assert login.status_code == 200
    pending = client.get("/v1/gallery/admin/posts", params={"status": "pending"})
    assert pending.status_code == 200
    assert len(pending.json()["posts"]) == 1
    assert pending.json()["posts"][0]["id"] == post_id

    approved = client.post(f"/v1/gallery/admin/posts/{post_id}/approve")
    assert approved.status_code == 200
    public2 = client.get("/v1/gallery/posts")
    assert len(public2.json()["posts"]) == 1
    assert public2.json()["posts"][0]["text"] == "待审内容"


def test_create_rejected_not_stored(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(
        db_path=tmp_path / "stats.db",
        heartbeat_token="",
        gallery_enabled=True,
        gallery_media_dir=tmp_path / "gallery",
        gallery_admin_secret="admin-secret",
        baidu_censor_api_key="ak",
        baidu_censor_secret_key="sk",
    )
    app = create_app(settings)

    async def fake_moderate(**_kwargs):
        from pallas_community_stats.gallery_censor import GalleryModerationResult

        return GalleryModerationResult(status="hidden", rejected=True, detail="bad")

    monkeypatch.setattr("pallas_community_stats.gallery_routes.moderate_gallery_content", fake_moderate)
    client = TestClient(app)
    created = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": "dep-rej", "text": "违规"},
    )
    assert created.status_code == 422
    assert client.get("/v1/gallery/posts").json()["posts"] == []
