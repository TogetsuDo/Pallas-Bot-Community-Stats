import uuid

import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings


@pytest.fixture
def fed_client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "fed.db",
        heartbeat_token="hb",
        bootstrap_enabled=True,
        instance_secret="pool-secret",
        federate_id="test-pool",
        federate_coord_redis_url="redis://127.0.0.1:6399/2",
    )
    return TestClient(create_app(settings))


def test_bootstrap_records_member_and_overview(fed_client: TestClient) -> None:
    dep = str(uuid.uuid4())
    headers = {
        "Authorization": "Bearer pool-secret",
        "X-Deployment-Id": dep,
    }
    boot = fed_client.get("/v1/bootstrap", headers=headers)
    assert boot.status_code == 200

    overview = fed_client.get("/v1/monitor/overview").json()
    assert overview["federation"]["members_total"] == 1
    assert overview["federation"]["members_online"] == 0

    fed_client.post(
        "/v1/heartbeat",
        json={"deployment_id": dep, "online_bots": 1},
        headers={"Authorization": "Bearer hb"},
    )
    overview2 = fed_client.get("/v1/monitor/overview").json()
    assert overview2["federation"]["members_online"] == 1

    onboarding = fed_client.get("/v1/federation/onboarding").json()
    assert onboarding["pool_stats"]["members_total"] == 1
    assert onboarding["pool_stats"]["members_online"] == 1
