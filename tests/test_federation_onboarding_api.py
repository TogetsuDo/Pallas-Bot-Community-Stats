import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings


@pytest.fixture
def onboarding_client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "test.db",
        bootstrap_enabled=True,
        instance_secret="pool-join-secret",
        federate_id="public-pool",
        federate_coord_redis_url="redis://:redis-pass@coord.example:6380/2",
        federation_onboarding_publish_secret=True,
    )
    return TestClient(create_app(settings))


def test_onboarding_returns_secret_and_steps(onboarding_client: TestClient) -> None:
    resp = onboarding_client.get("/v1/federation/onboarding")
    assert resp.status_code == 200
    body = resp.json()
    assert body["phase"] == 2
    assert body["federate_id"] == "public-pool"
    assert body["instance_secret"] == "pool-join-secret"
    assert body["coord"]["host"] == "coord.example"
    assert body["coord"]["port"] == 6380
    assert ":redis-pass@" not in body["coord"]["redis_url_display"]
    assert len(body["steps"]) >= 3
    titles = [s["title"] for s in body["steps"]]
    assert any("自动入池" in t for t in titles)
    assert "粘贴入池密钥" not in titles


def test_onboarding_disabled_when_bootstrap_off(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "test.db",
        bootstrap_enabled=False,
        federation_onboarding_enabled=False,
    )
    client = TestClient(create_app(settings))
    assert client.get("/v1/federation/onboarding").status_code == 503


def test_onboarding_hides_secret_when_publish_off(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "test.db",
        bootstrap_enabled=True,
        instance_secret="pool-join-secret",
        federation_onboarding_publish_secret=False,
    )
    client = TestClient(create_app(settings))
    body = client.get("/v1/federation/onboarding").json()
    assert body.get("instance_secret") is None
