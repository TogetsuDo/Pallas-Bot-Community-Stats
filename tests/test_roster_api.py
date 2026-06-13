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


def _headers() -> dict[str, str]:
    return {"Authorization": "Bearer secret-token"}


def test_roster_bubble_empty(client: TestClient) -> None:
    resp = client.get("/v1/roster/bubble")
    assert resp.status_code == 200
    data = resp.json()
    assert data["bots_total"] == 0
    assert data["bots_online"] == 0
    assert data["bots"] == []
    assert resp.headers.get("cache-control") == "public, max-age=60"


def test_roster_heartbeat_public_and_bubble(client: TestClient) -> None:
    dep = str(uuid.uuid4())
    body = {
        "deployment_id": dep,
        "online_bots": 1,
        "roster_public": True,
        "roster": [
            {
                "qq": 10001,
                "nickname": "福牛一号",
                "online": True,
                "message_weight": 900,
            },
            {
                "qq": 10002,
                "nickname": "离线牛",
                "online": False,
                "message_weight": 100,
            },
        ],
    }
    resp = client.post("/v1/heartbeat", json=body, headers=_headers())
    assert resp.status_code == 200

    bubble = client.get("/v1/roster/bubble").json()
    assert bubble["bots_total"] == 2
    assert bubble["bots_online"] == 1
    nicknames = {row["nickname"] for row in bubble["bots"]}
    assert nicknames == {"福牛一号", "离线牛"}
    for row in bubble["bots"]:
        assert row["qq"] > 0
        assert row["profile_url"].startswith("tencent://ntqq-open")
        assert row["avatar_url"].startswith("https://q1.qlogo.cn/")
    online_row = next(r for r in bubble["bots"] if r["nickname"] == "福牛一号")
    assert online_row["qq"] == 10001


def test_roster_clear_when_not_public(client: TestClient) -> None:
    dep = str(uuid.uuid4())
    headers = _headers()
    client.post(
        "/v1/heartbeat",
        json={
            "deployment_id": dep,
            "roster_public": True,
            "roster": [{"qq": 20001, "nickname": "临时牛", "online": True, "message_weight": 1}],
        },
        headers=headers,
    )
    assert client.get("/v1/roster/bubble").json()["bots_total"] == 1

    client.post(
        "/v1/heartbeat",
        json={"deployment_id": dep, "roster_public": False},
        headers=headers,
    )
    assert client.get("/v1/roster/bubble").json()["bots_total"] == 0


def test_roster_merge_same_qq_across_deployments(client: TestClient) -> None:
    dep_a = str(uuid.uuid4())
    dep_b = str(uuid.uuid4())
    headers = _headers()
    roster_row = {"qq": 30001, "nickname": "合并牛", "online": False, "message_weight": 50}
    client.post(
        "/v1/heartbeat",
        json={"deployment_id": dep_a, "roster_public": True, "roster": [roster_row]},
        headers=headers,
    )
    client.post(
        "/v1/heartbeat",
        json={
            "deployment_id": dep_b,
            "roster_public": True,
            "roster": [{"qq": 30001, "nickname": "合并牛", "online": True, "message_weight": 500}],
        },
        headers=headers,
    )
    bubble = client.get("/v1/roster/bubble").json()
    assert bubble["bots_total"] == 1
    assert bubble["bots_online"] == 1
    assert bubble["bots"][0]["message_weight"] == 500
