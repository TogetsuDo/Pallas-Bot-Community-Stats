import uuid

import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings


@pytest.fixture
def fleet_client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "fleet.db",
        heartbeat_token="",
        corpus_default_contribute=True,
        corpus_public_api_base="https://stats.example/v1/corpus",
    )
    return TestClient(create_app(settings))


def test_heartbeat_hot_snapshot_and_fleet_mode(fleet_client: TestClient, monkeypatch) -> None:
    now = 1_800_000_000
    monkeypatch.setattr("pallas_community_stats.corpus_store.time.time", lambda: now)
    dep = str(uuid.uuid4())
    fleet_client.post(
        "/v1/heartbeat",
        json={
            "deployment_id": dep,
            "corpus_hot_snapshot": {
                "as_of": now - 100,
                "items": [
                    {"keywords": "你好", "score": 12},
                    {"keywords": "晚安", "score": 8},
                ],
            },
        },
    )
    hot = fleet_client.get("/v1/corpus/hot", params={"mode": "fleet", "limit": 10})
    assert hot.status_code == 200
    body = hot.json()
    assert body["mode"] == "fleet"
    keywords = [item["keywords"] for item in body["items"]]
    assert "你好" in keywords
    assert body["items"][0]["answers"] == []
