import uuid

import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "test.db",
        heartbeat_token="secret-token",
        online_ttl_sec=900,
        max_clock_skew_sec=300,
    )
    return TestClient(create_app(settings))


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_heartbeat_requires_token(client: TestClient) -> None:
    body = {"deployment_id": str(uuid.uuid4())}
    assert client.post("/v1/heartbeat", json=body).status_code == 401
    resp = client.post(
        "/v1/heartbeat",
        json=body,
        headers={"Authorization": "Bearer secret-token"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "server_ts" in resp.json()


def test_stats_aggregates(client: TestClient) -> None:
    dep_a = str(uuid.uuid4())
    dep_b = str(uuid.uuid4())
    headers = {"Authorization": "Bearer secret-token"}
    client.post(
        "/v1/heartbeat",
        json={"deployment_id": dep_a, "online_bots": 2},
        headers=headers,
    )
    client.post(
        "/v1/heartbeat",
        json={"deployment_id": dep_b, "online_bots": 1},
        headers=headers,
    )
    stats = client.get("/v1/stats").json()
    assert stats["deployments_total"] == 2
    assert stats["deployments_online"] == 2
    assert stats["bots_online_sum"] == 3
    assert stats["online_ttl_sec"] == 900
    assert stats["as_of"].endswith("Z")


def test_heartbeat_rejects_bad_uuid(client: TestClient) -> None:
    resp = client.post(
        "/v1/heartbeat",
        json={"deployment_id": "not-a-uuid"},
        headers={"Authorization": "Bearer secret-token"},
    )
    assert resp.status_code == 422


def test_heartbeat_without_token_when_unconfigured(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(db_path=tmp_path / "open.db", heartbeat_token="")
    open_client = TestClient(create_app(settings))
    dep = str(uuid.uuid4())
    assert open_client.post("/v1/heartbeat", json={"deployment_id": dep}).status_code == 200
