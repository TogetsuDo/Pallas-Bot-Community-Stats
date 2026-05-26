import uuid

import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings


@pytest.fixture
def bootstrap_client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "test.db",
        bootstrap_enabled=True,
        instance_secret="bootstrap-secret",
        federate_id="public-pool",
        federate_coord_redis_url="redis://redis.example:6379/2",
        federate_redis_prefix="pallas:fed:public",
        federate_claim_ttl_sec=3600,
    )
    return TestClient(create_app(settings))


def test_bootstrap_requires_auth(bootstrap_client: TestClient) -> None:
    dep = str(uuid.uuid4())
    assert bootstrap_client.get("/v1/bootstrap", headers={"X-Deployment-Id": dep}).status_code == 401


def test_bootstrap_returns_coord(bootstrap_client: TestClient) -> None:
    dep = str(uuid.uuid4())
    resp = bootstrap_client.get(
        "/v1/bootstrap",
        headers={
            "Authorization": "Bearer bootstrap-secret",
            "X-Deployment-Id": dep,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deployment_id"] == dep
    assert body["federate_id"] == "public-pool"
    assert body["coord"]["redis_url"] == "redis://redis.example:6379/2"
    assert body["coord"]["redis_prefix"] == "pallas:fed:public"
    assert body["coord"]["claim_ttl_sec"] == 3600
    assert body["expires_at"] is not None


def test_bootstrap_disabled_returns_503(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "test.db",
        bootstrap_enabled=False,
        instance_secret="bootstrap-secret",
    )
    client = TestClient(create_app(settings))
    dep = str(uuid.uuid4())
    resp = client.get(
        "/v1/bootstrap",
        headers={
            "Authorization": "Bearer bootstrap-secret",
            "X-Deployment-Id": dep,
        },
    )
    assert resp.status_code == 503
