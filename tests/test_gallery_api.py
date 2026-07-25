from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings


def _client(tmp_path: Path) -> TestClient:
    settings = Settings(
        db_path=tmp_path / "stats.db",
        heartbeat_token="",
        gallery_enabled=True,
        gallery_media_dir=tmp_path / "gallery",
        gallery_per_day=20,
        gallery_per_hour=20,
        corpus_enabled=True,
    )
    return TestClient(create_app(settings))


def test_gallery_create_list_and_delete(tmp_path: Path) -> None:
    client = _client(tmp_path)
    dep = "550e8400-e29b-41d4-a716-446655440000"

    created = client.post(
        "/v1/gallery/posts",
        data={
            "deployment_id": dep,
            "text": "摸摸牛牛",
            "nickname": "福牛一号",
            "bot_qq": "123456",
            "source": "manual",
        },
    )
    assert created.status_code == 200, created.text
    post_id = created.json()["id"]

    listed = client.get("/v1/gallery/posts")
    assert listed.status_code == 200
    body = listed.json()
    assert len(body["posts"]) == 1
    post = body["posts"][0]
    assert post["id"] == post_id
    assert post["text"] == "摸摸牛牛"
    assert post["nickname"] == "福牛一号"
    assert post["avatar_url"]

    deleted = client.delete(f"/v1/gallery/posts/{post_id}", params={"deployment_id": dep})
    assert deleted.status_code == 200
    listed2 = client.get("/v1/gallery/posts")
    assert listed2.json()["posts"] == []


def test_gallery_requires_nickname_and_content(tmp_path: Path) -> None:
    client = _client(tmp_path)
    resp = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": "dep-1", "text": "hi", "nickname": ""},
    )
    assert resp.status_code == 400
