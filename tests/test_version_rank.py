import uuid

import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings
from pallas_community_stats.version_rank import (
    normalize_version_display,
    rank_online_versions,
    version_newness_key,
)


def test_normalize_version_display_strips_suffix() -> None:
    assert normalize_version_display("v3.7.1-23-ga01d9db-dirty") == "v3.7.1"
    assert normalize_version_display("v3.8.11") == "v3.8.11"
    assert normalize_version_display("3.6.16") == "3.6.16"
    assert normalize_version_display("v3.8.10-1-g9d159e8") == "v3.8.10"


def test_rank_online_versions_merges_normalized_versions() -> None:
    rows = [
        ("v3.7.1-23-ga01d9db-dirty", 1),
        ("v3.7.1", 1),
        ("v3.8.11", 1),
    ]
    ranked = rank_online_versions(rows)
    assert ranked == [
        {"version": "v3.7.1", "count": 2},
        {"version": "v3.8.11", "count": 1},
    ]


def test_version_newness_key_prefers_semver() -> None:
    assert version_newness_key("v3.8.11") > version_newness_key("v3.8.0")
    assert version_newness_key("3.8.11") > version_newness_key("3.6.16")
    assert version_newness_key("v3.8.0") > version_newness_key("v3.7.1-23-ga01d9db-dirty")


def test_rank_online_versions_newer_first_on_equal_count() -> None:
    rows = [
        ("v3.8.0", 1),
        ("v3.8.11", 1),
        ("3.6.16", 1),
        ("v3.8.3", 2),
    ]
    ranked = rank_online_versions(rows)
    assert ranked == [
        {"version": "v3.8.3", "count": 2},
        {"version": "v3.8.11", "count": 1},
        {"version": "v3.8.0", "count": 1},
        {"version": "3.6.16", "count": 1},
    ]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "monitor.db",
        heartbeat_token="secret-token",
        online_ttl_sec=900,
    )
    return TestClient(create_app(settings))


def test_monitor_overview_online_versions_tiebreak(client: TestClient) -> None:
    headers = {"Authorization": "Bearer secret-token"}
    versions = ["v3.8.0", "v3.8.11", "3.6.16"]
    for version in versions:
        dep = str(uuid.uuid4())
        client.post(
            "/v1/heartbeat",
            json={"deployment_id": dep, "online_bots": 1, "version": version},
            headers=headers,
        )

    overview = client.get("/v1/monitor/overview").json()
    assert overview["deployments"]["online_versions"] == [
        {"version": "v3.8.11", "count": 1},
        {"version": "v3.8.0", "count": 1},
        {"version": "3.6.16", "count": 1},
    ]
