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


def test_corpus_hot_keywords_by_period(corpus_client: TestClient, monkeypatch) -> None:
    dep = str(uuid.uuid4())
    token = corpus_client.post("/v1/corpus/enroll", json={"deployment_id": dep}).json()["corpus_token"]
    headers = {"Authorization": f"Bearer {token}"}
    now = 1_700_000_000
    monkeypatch.setattr("pallas_community_stats.corpus_store.time.time", lambda: now)
    for keywords, answer, score_time in [
        ("你好", "早啊", now - 1000),
        ("晚安", "好梦", now - 5000),
        ("旧词", "过时", now - 200_000),
    ]:
        corpus_client.post(
            "/v1/corpus/contribute",
            json={
                "op": "upsert_answer",
                "keywords": keywords,
                "group_id": 0,
                "answer_keywords": answer,
                "answer_time": score_time,
                "message": answer,
                "append_on_existing": True,
            },
            headers=headers,
        )

    hot = corpus_client.get("/v1/corpus/hot", params={"mode": "recent", "period": "day", "limit": 10})
    assert hot.status_code == 200
    body = hot.json()
    assert body["mode"] == "recent"
    assert body["period"] == "day"
    assert body["window_sec"] == 86400
    keywords = [item["keywords"] for item in body["items"]]
    assert "你好" in keywords
    assert "晚安" in keywords
    assert "旧词" not in keywords
    hello = next(item for item in body["items"] if item["keywords"] == "你好")
    assert hello["answers"][0]["message"] == "早啊"

    pool = corpus_client.get("/v1/corpus/hot", params={"mode": "pool", "limit": 10})
    assert pool.status_code == 200
    pool_body = pool.json()
    assert pool_body["mode"] == "pool"
    assert pool_body["window_sec"] == 0
    pool_keywords = [item["keywords"] for item in pool_body["items"]]
    assert "旧词" in pool_keywords


def test_corpus_hot_strips_cq_message(corpus_client: TestClient) -> None:
    dep = str(uuid.uuid4())
    token = corpus_client.post("/v1/corpus/enroll", json={"deployment_id": dep}).json()["corpus_token"]
    headers = {"Authorization": f"Bearer {token}"}
    corpus_client.post(
        "/v1/corpus/contribute",
        json={
            "op": "upsert_answer",
            "keywords": "早安",
            "group_id": 0,
            "answer_keywords": "回礼",
            "message": "早啊[CQ:face,id=178]呀",
            "append_on_existing": True,
        },
        headers=headers,
    )
    hot = corpus_client.get("/v1/corpus/hot", params={"mode": "recent", "period": "month"}).json()
    row = next(item for item in hot["items"] if item["keywords"] == "早安")
    assert row["answers"][0]["message"] == "早啊呀"

    ctx = corpus_client.get("/v1/corpus/context", params={"keywords": "早安"}, headers=headers).json()
    assert ctx["answers"][0]["messages"] == ["早啊呀"]


def test_corpus_hot_skips_cq_only_keywords(corpus_client: TestClient, monkeypatch) -> None:
    dep = str(uuid.uuid4())
    token = corpus_client.post("/v1/corpus/enroll", json={"deployment_id": dep}).json()["corpus_token"]
    headers = {"Authorization": f"Bearer {token}"}
    now = 1_700_000_000
    monkeypatch.setattr("pallas_community_stats.corpus_store.time.time", lambda: now)
    corpus_client.post(
        "/v1/corpus/contribute",
        json={
            "op": "upsert_answer",
            "keywords": "[CQ:face,id=178]",
            "group_id": 0,
            "answer_keywords": "x",
            "answer_time": now - 100,
            "message": "[CQ:image,file=abc]",
            "append_on_existing": True,
        },
        headers=headers,
    )
    corpus_client.post(
        "/v1/corpus/contribute",
        json={
            "op": "upsert_answer",
            "keywords": "可见词",
            "group_id": 0,
            "answer_keywords": "回复",
            "answer_time": now - 200,
            "message": "有正文",
            "append_on_existing": True,
        },
        headers=headers,
    )
    hot = corpus_client.get("/v1/corpus/hot", params={"mode": "recent", "period": "month"}).json()
    keywords = [item["keywords"] for item in hot["items"]]
    assert "可见词" in keywords
    assert "[CQ:face,id=178]" not in keywords
    assert all(keywords)


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
