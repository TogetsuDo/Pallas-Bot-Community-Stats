import sqlite3

from pallas_community_stats.corpus_store import CorpusStore
from pallas_community_stats.corpus_util import keywords_hash


def test_corpus_stats_backfill_and_track_writes(tmp_path) -> None:
    db_path = tmp_path / "corpus.db"
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE corpus_contexts (
                keywords_hash TEXT PRIMARY KEY,
                keywords TEXT NOT NULL,
                time INTEGER NOT NULL,
                trigger_count INTEGER NOT NULL DEFAULT 1,
                clear_time INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE corpus_answers (
                keywords_hash TEXT NOT NULL,
                answer_keywords TEXT NOT NULL,
                group_id INTEGER NOT NULL DEFAULT 0,
                count INTEGER NOT NULL DEFAULT 1,
                time INTEGER NOT NULL,
                messages_json TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY (keywords_hash, group_id, answer_keywords)
            );
            INSERT INTO corpus_contexts VALUES ('{context_hash}', '旧词', 1, 2, 0);
            INSERT INTO corpus_answers VALUES ('{context_hash}', '答一', 0, 3, 1, '[]');
            INSERT INTO corpus_answers VALUES ('{context_hash}', '答二', 0, 4, 1, '[]');
            """.format(context_hash=keywords_hash("旧词"))
        )

    store = CorpusStore(db_path)
    stats = store.aggregate_monitor_stats(online_cutoff_unix=0)
    assert stats["contexts_total"] == 1
    assert stats["answers_total"] == 2
    assert stats["answer_hits_sum"] == 7

    with sqlite3.connect(db_path) as conn:
        assert conn.execute(
            "SELECT contexts_total, answers_total, answer_hits_sum FROM corpus_aggregate_stats WHERE id = 1"
        ).fetchone() == (1, 2, 7)

    store.upsert_answer(
        keywords="旧词",
        group_id=0,
        answer_keywords="答一",
        answer_time=2,
        message="补充",
        append_on_existing=True,
    )
    store.insert_context(
        keywords="新词",
        context_time=3,
        answers=[{"keywords": "答三", "count": 2, "messages": []}],
    )

    stats = store.aggregate_monitor_stats(online_cutoff_unix=0)
    assert stats["contexts_total"] == 2
    assert stats["answers_total"] == 3
    assert stats["answer_hits_sum"] == 10
