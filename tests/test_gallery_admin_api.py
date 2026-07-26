from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings
from pallas_community_stats.gallery_admin_auth import mint_admin_session, verify_admin_session


def _client(tmp_path: Path, *, admin_secret: str = "test-admin-secret") -> TestClient:
    settings = Settings(
        db_path=tmp_path / "stats.db",
        heartbeat_token="",
        gallery_enabled=True,
        gallery_media_dir=tmp_path / "gallery",
        gallery_per_day=20,
        gallery_per_hour=20,
        gallery_admin_secret=admin_secret,
        corpus_enabled=True,
    )
    return TestClient(create_app(settings))


def test_admin_session_roundtrip() -> None:
    secret = "s3cret"
    token = mint_admin_session(secret, now=1_700_000_000)
    assert verify_admin_session(secret, token, now=1_700_000_000)
    assert not verify_admin_session(secret, token, now=1_700_000_000 + 13 * 3600)
    assert not verify_admin_session("other", token, now=1_700_000_000)


def test_gallery_admin_login_list_delete(tmp_path: Path) -> None:
    client = _client(tmp_path)
    dep_a = "550e8400-e29b-41d4-a716-446655440000"
    dep_b = "550e8400-e29b-41d4-a716-446655440099"

    created_a = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": dep_a, "text": "来自 A", "nickname": "牛A"},
    )
    created_b = client.post(
        "/v1/gallery/posts",
        data={"deployment_id": dep_b, "text": "来自 B", "nickname": "牛B"},
    )
    assert created_a.status_code == 200
    assert created_b.status_code == 200
    id_b = created_b.json()["id"]

    status = client.get("/v1/gallery/admin/status")
    assert status.status_code == 200
    assert status.json()["enabled"] is True
    assert status.json()["authenticated"] is False

    denied = client.get("/v1/gallery/admin/posts")
    assert denied.status_code == 401

    bad = client.post("/v1/gallery/admin/login", json={"secret": "wrong"})
    assert bad.status_code == 401

    login = client.post("/v1/gallery/admin/login", json={"secret": "test-admin-secret"})
    assert login.status_code == 200, login.text

    status2 = client.get("/v1/gallery/admin/status")
    assert status2.json()["authenticated"] is True

    listed = client.get("/v1/gallery/admin/posts")
    assert listed.status_code == 200
    posts = listed.json()["posts"]
    assert len(posts) == 2
    assert {p["text"] for p in posts} == {"来自 A", "来自 B"}

    deleted = client.delete(f"/v1/gallery/admin/posts/{id_b}")
    assert deleted.status_code == 200

    public = client.get("/v1/gallery/posts")
    assert len(public.json()["posts"]) == 1
    assert public.json()["posts"][0]["text"] == "来自 A"

    logout = client.post("/v1/gallery/admin/logout")
    assert logout.status_code == 200
    denied2 = client.get("/v1/gallery/admin/posts")
    assert denied2.status_code == 401


def test_gallery_admin_disabled_without_secret(tmp_path: Path) -> None:
    client = _client(tmp_path, admin_secret="")
    status = client.get("/v1/gallery/admin/status")
    assert status.status_code == 200
    assert status.json()["enabled"] is False
    login = client.post("/v1/gallery/admin/login", json={"secret": "x"})
    assert login.status_code == 503
