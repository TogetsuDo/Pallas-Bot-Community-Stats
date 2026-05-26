import uuid

import pytest
from fastapi.testclient import TestClient

from pallas_community_stats.app import create_app
from pallas_community_stats.config import Settings


@pytest.fixture
def corpus_client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "corpus.db",
        heartbeat_token="",
        corpus_default_contribute=True,
        corpus_public_api_base="https://stats.example/v1/corpus",
    )
    return TestClient(create_app(settings))


def test_corpus_enroll_and_read(corpus_client: TestClient) -> None:
    dep = str(uuid.uuid4())
    enroll = corpus_client.post("/v1/corpus/enroll", json={"deployment_id": dep})
    assert enroll.status_code == 200
    body = enroll.json()
    assert body["corpus_token"].startswith("pc_")
    assert body["api_base"] == "https://stats.example/v1/corpus"
    assert body["policy"]["read"] is True
    token = body["corpus_token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert corpus_client.get("/v1/corpus/context", params={"keywords": "missing"}, headers=headers).status_code == 404

    contrib = corpus_client.post(
        "/v1/corpus/contribute",
        json={
            "op": "upsert_answer",
            "keywords": "你好",
            "group_id": 0,
            "answer_keywords": "早啊",
            "answer_time": 100,
            "message": "早啊",
            "append_on_existing": True,
        },
        headers=headers,
    )
    assert contrib.status_code == 200

    ctx = corpus_client.get("/v1/corpus/context", params={"keywords": "你好"}, headers=headers)
    assert ctx.status_code == 200
    data = ctx.json()
    assert data["keywords"] == "你好"
    assert len(data["answers"]) == 1
    assert data["answers"][0]["keywords"] == "早啊"
    assert data["answers"][0]["messages"] == ["早啊"]


def test_corpus_contribute_forbidden_when_disabled(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        db_path=tmp_path / "no-contrib.db",
        corpus_default_contribute=False,
    )
    client = TestClient(create_app(settings))
    dep = str(uuid.uuid4())
    token = client.post("/v1/corpus/enroll", json={"deployment_id": dep}).json()["corpus_token"]
    resp = client.post(
        "/v1/corpus/contribute",
        json={
            "op": "upsert_answer",
            "keywords": "a",
            "answer_keywords": "b",
            "message": "b",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_corpus_requires_bearer(corpus_client: TestClient) -> None:
    assert corpus_client.get("/v1/corpus/context", params={"keywords": "x"}).status_code == 401


def test_corpus_usage_counts(corpus_client: TestClient) -> None:
    dep = str(uuid.uuid4())
    token = corpus_client.post("/v1/corpus/enroll", json={"deployment_id": dep}).json()["corpus_token"]
    headers = {"Authorization": f"Bearer {token}"}

    usage0 = corpus_client.get("/v1/corpus/usage", headers=headers)
    assert usage0.status_code == 200
    assert usage0.json()["read_lookups"] == 0

    assert corpus_client.get("/v1/corpus/context", params={"keywords": "miss"}, headers=headers).status_code == 404
    assert corpus_client.get("/v1/corpus/usage", headers=headers).json()["read_lookups"] == 1
    assert corpus_client.get("/v1/corpus/usage", headers=headers).json()["read_hits"] == 0

    corpus_client.post(
        "/v1/corpus/contribute",
        json={
            "op": "upsert_answer",
            "keywords": "usage-kw",
            "group_id": 0,
            "answer_keywords": "usage-ans",
            "message": "hi",
        },
        headers=headers,
    )
    assert corpus_client.get("/v1/corpus/context", params={"keywords": "usage-kw"}, headers=headers).status_code == 200

    usage1 = corpus_client.get("/v1/corpus/usage", headers=headers).json()
    assert usage1["read_lookups"] == 2
    assert usage1["read_hits"] == 1
    assert usage1["contribute_ok"] == 1
    assert usage1["deployment_id"] == dep.lower()
