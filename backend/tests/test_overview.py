from __future__ import annotations

from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.domain_models import Record
from tests.record_context import creation_payload
from tests.test_direct_records import _issue
from tests.test_views import _client


def test_overview_lists_open_research_with_legacy_status_and_visibility() -> None:
    client = _client()
    assert client.get("/api/v1/overview").json()["open_research"] == []
    ids = {}
    for index, state in enumerate(["collecting", "comparing", "concluded", "archived", "hidden"]):
        response = client.post("/api/v1/research", json=creation_payload(client, {
            "title": state,
        }))
        assert response.status_code == 201, response.text
        ids[state] = response.json()["id"]
        # 模拟旧状态及已隐藏记录，不通过新建接口伪造旧版输入。
        with Session(client.app.state.engine) as db:
            record = db.get(Record, ids[state])
            record.status = "collecting" if state == "hidden" else state
            record.updated_at = datetime(2026, 10, index + 1, tzinfo=UTC)
            if state == "hidden":
                record.archived_at = datetime(2026, 10, 10, tzinfo=UTC)
            db.commit()

    response = client.get("/api/v1/overview")
    assert response.status_code == 200, response.text
    overview = response.json()
    assert overview["summary"]["open_research_count"] == 3
    assert [(row["title"], row["status"]) for row in overview["open_research"]] == [
        ("concluded", "comparing"), ("comparing", "comparing"), ("collecting", "collecting"),
    ]
    assert overview["summary"]["open_issue_count"] == 0
    assert ids["hidden"] not in {row["id"] for row in overview["recent_records"]}
    # 读取兼容只归一投影，不改写真实旧记录。
    with Session(client.app.state.engine) as db:
        assert db.get(Record, ids["concluded"]).status == "concluded"


def test_overview_orders_open_issues_by_due_date_and_excludes_done_and_hidden(monkeypatch):
    monkeypatch.setattr("app.api.analytics._today", lambda: date(2026, 10, 30))
    client = _client()
    for title, due_date in [
        ("无期限", None), ("未来", "2026-11-06"), ("今天", "2026-10-30"),
        ("逾期", "2026-10-29"), ("已完成", "2026-10-28"), ("已隐藏", "2026-10-27"),
    ]:
        response = client.post("/api/v1/records/direct", json=creation_payload(
            client, _issue(title=title, due_date=due_date),
        ))
        assert response.status_code == 201, response.text
        record_id = response.json()["id"]
        if title == "已完成":
            assert client.patch(f"/api/v1/records/{record_id}", json={
                "record_type": "issue", "status": "done", "actual_result": "核对完成",
            }).status_code == 200
        if title == "已隐藏":
            assert client.post(f"/api/v1/records/{record_id}/archive").status_code == 200

    overview = client.get("/api/v1/overview").json()
    assert [row["title"] for row in overview["open_issues"]] == ["逾期", "今天", "未来", "无期限"]
    assert overview["summary"] == {
        "open_issue_count": 4, "open_research_count": 0, "overdue_count": 1, "upcoming_count": 1,
    }
    assert overview["horizon_date"] == "2026-11-05"
