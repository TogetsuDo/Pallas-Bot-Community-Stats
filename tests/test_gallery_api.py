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


def test_gallery_defaults_nickname_and_requires_content(tmp_path: Path) -> None:
    client = _client(tmp_path)
    empty = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": "dep-1", "text": "", "nickname": ""},
    )
    assert empty.status_code == 400

    created = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": "dep-1", "text": "仅正文", "nickname": ""},
    )
    assert created.status_code == 200, created.text
    listed = client.get("/v1/gallery/posts")
    assert listed.json()["posts"][0]["nickname"] == "牛牛"


def test_gallery_image_only_without_bot(tmp_path: Path) -> None:
    client = _client(tmp_path)
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    created = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": "dep-img", "text": "", "nickname": ""},
        files={"image": ("shot.png", png, "image/png")},
    )
    assert created.status_code == 200, created.text
    listed = client.get("/v1/gallery/posts")
    post = listed.json()["posts"][0]
    assert post["nickname"] == "牛牛"
    assert post["qq"] is None
    assert post["image_url"]
    img = client.get(post["image_url"].replace("http://testserver", ""))
    assert img.status_code == 200
    assert img.content.startswith(b"\x89PNG")


def test_gallery_public_post_requires_image(tmp_path: Path) -> None:
    client = _client(tmp_path)
    visitor = "550e8400-e29b-41d4-a716-446655440001"
    missing = client.post(
        "/v1/gallery/public/posts",
        data={"visitor_id": visitor, "text": "仅文字"},
    )
    assert missing.status_code == 422


def test_gallery_public_post_image(tmp_path: Path) -> None:
    client = _client(tmp_path)
    visitor = "550e8400-e29b-41d4-a716-446655440002"
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
        b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    created = client.post(
        "/v1/gallery/public/posts",
        data={"visitor_id": visitor, "nickname": "路人甲", "text": "梗图一枚"},
        files={"image": ("meme.png", png, "image/png")},
    )
    assert created.status_code == 200, created.text
    listed = client.get("/v1/gallery/posts")
    post = listed.json()["posts"][0]
    assert post["nickname"] == "路人甲"
    assert post["text"] == "梗图一枚"
    assert post["image_url"]
