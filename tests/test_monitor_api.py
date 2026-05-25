import uuid

import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "monitor.db",
        heartbeat_token="secret-token",
        online_ttl_sec=900,
    )
    return TestClient(create_app(settings))


def test_monitor_overview(client: TestClient) -> None:
    dep = str(uuid.uuid4())
    headers = {"Authorization": "Bearer secret-token"}
    client.post(
        "/v1/heartbeat",
        json={"deployment_id": dep, "online_bots": 2, "catalog_bots": 5, "version": "3.1.0"},
        headers=headers,
    )
    enroll = client.post("/v1/corpus/enroll", json={"deployment_id": dep})
    assert enroll.status_code == 200

    overview = client.get("/v1/monitor/overview").json()
    assert overview["corpus_enabled"] is True
    assert overview["deployments"]["deployments_online"] == 1
    assert overview["deployments"]["catalog_bots_online_sum"] == 5
    assert overview["deployments"]["online_versions"] == [{"version": "3.1.0", "count": 1}]
    assert overview["corpus"]["enrollments_total"] == 1
    assert overview["corpus"]["enrollments_online"] == 1
    assert overview["corpus"]["read_enabled_total"] == 1


def test_stats_corpus(client: TestClient) -> None:
    dep = str(uuid.uuid4())
    headers = {"Authorization": "Bearer secret-token"}
    client.post("/v1/heartbeat", json={"deployment_id": dep}, headers=headers)
    client.post("/v1/corpus/enroll", json={"deployment_id": dep})

    corpus = client.get("/v1/stats/corpus").json()
    assert corpus["corpus"]["enrollments_total"] == 1
    assert corpus["online_ttl_sec"] == 900
    assert corpus["as_of"].endswith("Z")


def test_stats_corpus_disabled(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(db_path=tmp_path / "off.db", corpus_enabled=False)
    off_client = TestClient(create_app(settings))
    assert off_client.get("/v1/stats/corpus").status_code == 503
