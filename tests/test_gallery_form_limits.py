from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings

PNG_1PX = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _client(tmp_path: Path, *, heartbeat_token: str = "") -> TestClient:
    settings = Settings(
        db_path=tmp_path / "stats.db",
        heartbeat_token=heartbeat_token,
        gallery_enabled=True,
        gallery_media_dir=tmp_path / "gallery",
        gallery_per_day=20,
        gallery_per_hour=20,
        corpus_enabled=True,
    )
    return TestClient(create_app(settings))


def test_gallery_urlencoded_rejects_excessive_fields(tmp_path: Path) -> None:
    """CVE-2026-54283: urlencoded parsing must bound the number of fields."""
    client = _client(tmp_path)
    data = {"deployment_id": "dep-fields", "text": "hello"}
    for i in range(1500):
        data[f"extra_{i}"] = "x"
    resp = client.post("/v1/gallery/posts", data=data)
    assert resp.status_code == 400, resp.text
    assert "Too many fields" in resp.text


def test_gallery_urlencoded_rejects_oversized_field(tmp_path: Path) -> None:
    """CVE-2026-54283: urlencoded parsing must bound a single field's size."""
    client = _client(tmp_path)
    resp = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": "dep-size", "text": "hello", "blob": "a" * (2 * 1024 * 1024)},
    )
    assert resp.status_code == 400, resp.text
    assert "exceeded maximum size" in resp.text


def test_gallery_normal_form_upload_and_auth_paths_intact(tmp_path: Path) -> None:
    client = _client(tmp_path, heartbeat_token="secret-hb")

    ok = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": "dep-ok", "text": "正常投稿"},
        headers={"Authorization": "Bearer secret-hb"},
    )
    assert ok.status_code == 200, ok.text

    unauthorized = client.post("/v1/gallery/posts", data={"deployment_id": "dep-ok", "text": "x"})
    assert unauthorized.status_code == 401

    uploaded = client.post(
        "/v1/gallery/public/posts",
        data={"visitor_id": "550e8400-e29b-41d4-a716-446655440010"},
        files={"image": ("meme.png", PNG_1PX, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
