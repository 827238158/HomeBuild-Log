from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.api import reviews
from app.core.config import AIConfig, AIProviderConfig
from app.db import create_session_factory
from app.domain_models import DEFAULT_PROJECT_ID, IssueDetail, Record
from app.topic_models import IssueActivity, RecordTopic, Topic
from tests.test_pitfalls import _client


def setup_review(monkeypatch):
    client = _client()
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()
    body = {"start_date": today, "end_date": today}
    item = client.post(
        "/api/v1/pitfalls", json={"occurred_date": "2020-01-01", "description": "墙面返碱"}
    ).json()
    provider = AIProviderConfig("test", "https://invalid.test", "model", "bearer", "fake")
    monkeypatch.setattr(
        client.app.state.secrets,
        "get_ai_config",
        lambda: AIConfig(True, ("test",), 10, 0, {"test": provider}),
    )
    return client, body, item


def respond(client, monkeypatch, rid, kind="progress", callback=None):
    def post(*args, **kwargs):
        assert "source_entries" not in kwargs["json"]["messages"][1]["content"]
        if callback:
            callback()
        return httpx.Response(
            200,
            request=httpx.Request("POST", "https://invalid.test"),
            json={
                "choices": [
                    {
                        "message": {
                            "content": '{"sections":[{"kind":"'
                            + kind
                            + '","items":[{"text":"建议确认墙面状况","reference_ids":["'
                            + rid
                            + '"]}]}]}'
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(client.app.state, "ai_http_client", SimpleNamespace(post=post))


def test_review_uses_real_reference_and_marks_backfill(monkeypatch):
    client, body, item = setup_review(monkeypatch)
    rows, _, _ = reviews._snapshot(SimpleNamespace(app=client.app), reviews.ReviewInput(**body))
    assert rows[0]["backfilled"] is True
    assert rows[0]["id"] == item["id"]  # 无主题记录仍进入全项目回顾。
    respond(client, monkeypatch, item["id"])
    result = client.post("/api/v1/reviews/recent", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["sections"][0]["items"][0]["references"][0]["id"] == item["id"]
    assert (
        client.get("/api/v1/reviews/fingerprint", params=body).json()["fingerprint"]
        == result.json()["fingerprint"]
    )


@pytest.mark.parametrize("kind,rid", [("progress", "invented"), ("follow_up", None)])
def test_invalid_reference_and_resolved_followup_rejected(monkeypatch, kind, rid):
    client, body, item = setup_review(monkeypatch)
    client.post(
        f"/api/v1/pitfalls/{item['id']}/resolutions",
        json={"resolved_date": body["end_date"], "content": "已修复"},
    )
    respond(client, monkeypatch, rid or item["id"], kind)
    assert client.post("/api/v1/reviews/recent", json=body).status_code == 503


def test_stale_review_rejected(monkeypatch):
    client, body, item = setup_review(monkeypatch)
    respond(
        client,
        monkeypatch,
        item["id"],
        callback=lambda: client.patch(
            f"/api/v1/pitfalls/{item['id']}", json={"description": "内容已更新"}
        ),
    )
    assert client.post("/api/v1/reviews/recent", json=body).status_code == 409


def test_budget_dates_and_topic_validation_before_provider(monkeypatch):
    client, body, item = setup_review(monkeypatch)
    monkeypatch.setattr(reviews, "MAX_INPUT", 1)
    assert client.post("/api/v1/reviews/recent", json=body).status_code == 422
    assert (
        client.post("/api/v1/reviews/recent", json={**body, "topic_id": "missing"}).status_code
        == 404
    )
    assert (
        client.post("/api/v1/reviews/recent", json={**body, "start_date": "2000-01-01"}).status_code
        == 422
    )


def test_formal_records_history_topic_and_current_status(monkeypatch):
    client, body, _ = setup_review(monkeypatch)
    db = create_session_factory(client.app.state.engine)()
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    old = datetime(2020, 1, 1, tzinfo=ZoneInfo("Asia/Shanghai"))
    try:
        topic = Topic(project_id=DEFAULT_PROJECT_ID, name="厨房")
        record = Record(
            project_id=DEFAULT_PROJECT_ID,
            record_type="issue",
            title="检查水管",
            status="done",
            created_at=old,
            updated_at=now,
        )
        db.add_all([topic, record])
        db.flush()
        db.add(IssueDetail(record_id=record.id, phenomenon="渗水"))
        db.add(RecordTopic(record_id=record.id, topic_id=topic.id))
        db.add(IssueActivity(record_id=record.id, kind="note", content="修复完毕", created_at=now))
        db.commit()
        rid, tid = record.id, topic.id
    finally:
        db.close()
    request = SimpleNamespace(app=client.app)
    rows, _, _ = reviews._snapshot(request, reviews.ReviewInput(**body, topic_id=tid))
    assert len(rows) == 1
    assert rows[0]["status"] == "done" and rows[0]["history"][0]["recent"]
    respond(client, monkeypatch, rid, "follow_up")
    assert client.post("/api/v1/reviews/recent", json={**body, "topic_id": tid}).status_code == 503


def test_empty_range_needs_no_model_and_old_open_items_are_background(monkeypatch):
    client = _client()
    body = {"start_date": "2020-01-01", "end_date": "2020-01-02"}
    result = client.post("/api/v1/reviews/recent", json=body)
    assert result.status_code == 200 and result.json()["sections"] == []
    client.post("/api/v1/pitfalls", json={"occurred_date": "2019-01-01", "description": "旧问题"})
    rows, _, _ = reviews._snapshot(SimpleNamespace(app=client.app), reviews.ReviewInput(**body))
    assert len(rows) == 1 and rows[0]["recent"] is False


def test_progress_rejects_only_old_background(monkeypatch):
    client, _, item = setup_review(monkeypatch)
    respond(client, monkeypatch, item["id"])
    body = {"start_date": "2021-01-01", "end_date": "2021-01-02"}
    assert client.post("/api/v1/reviews/recent", json=body).status_code == 503
