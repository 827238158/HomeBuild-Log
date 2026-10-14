from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.db import database_url
from app.domain_models import Project, Record
from app.topic_models import IssueActivity, RecordTopic, Topic
from tests.test_direct_records import _counts, _issue
from tests.test_pitfalls import _client


def _topic(client, name="智能开关"):
    result = client.post("/api/v1/topics", json={"name": name})
    assert result.status_code == 201, result.text
    return result.json()


def test_topic_crud_archive_and_idempotent_membership() -> None:
    client = _client()
    first = _topic(client, " 智能开关 ")
    second = _topic(client, "电路改造")
    route = f"/api/v1/topics/{first['id']}"
    assert first["name"] == "智能开关"
    assert client.post("/api/v1/topics", json={"name": "智能开关"}).status_code == 409
    assert client.post("/api/v1/topics", json={"name": "   "}).status_code == 422
    assert client.patch(route, json={"name": "电路改造"}).status_code == 409
    assert client.patch(route, json={"name": None}).status_code == 422
    assert client.patch(route, json={"status": None}).status_code == 422
    record = client.post("/api/v1/records/direct", json=_issue()).json()
    link = route + f"/records/{record['id']}"
    for _ in range(2):
        assert client.put(link).status_code == 200
    client.put(f"/api/v1/topics/{second['id']}/records/{record['id']}")
    assert len(client.get(route).json()["records"]) == 1
    assert len(client.get(f"/api/v1/records/{record['id']}").json()["topic_ids"]) == 2
    assert client.patch(route, json={"status": "archived"}).status_code == 200
    # 重复关联仍幂等，删除归属不删除业务事实；归档主题不能新增归属。
    assert client.put(link).status_code == 200
    for _ in range(2):
        assert client.delete(link).status_code == 200
    assert client.put(link).status_code == 422
    assert client.get(f"/api/v1/records/{record['id']}").status_code == 200
    assert client.patch(route, json={"status": "active"}).status_code == 200
    assert client.put(link).status_code == 200
    matching = client.get("/api/v1/topics?search=智能&state=active").json()["items"]
    assert matching[0]["id"] == first["id"]
    assert client.put(route + "/records/missing").status_code == 404
    client.headers.clear()
    assert client.get(route).status_code == 401


def test_topic_ids_validation_transaction_and_clear() -> None:
    client = _client()
    topic = _topic(client)
    route = f"/api/v1/topics/{topic['id']}"
    before = _counts(client)
    assert client.post("/api/v1/records/direct", json=_issue(
        topic_ids=[topic["id"], "missing"],
    )).status_code == 422
    assert _counts(client) == before
    record = client.post("/api/v1/records/direct", json=_issue(topic_ids=[topic["id"]])).json()
    record_route = f"/api/v1/records/{record['id']}"
    client.patch(route, json={"status": "archived"})
    assert client.patch(record_route, json={
        "record_type": "issue", "title": "保留归档归属", "topic_ids": [topic["id"]],
    }).status_code == 200
    assert client.patch(record_route, json={
        "record_type": "issue", "title": "省略不清空",
    }).json()["topic_ids"] == [topic["id"]]
    response = client.patch(record_route, json={
        "record_type": "issue", "title": "不应保存", "topic_ids": ["missing"],
    })
    assert response.status_code == 422
    assert client.get(record_route).json()["title"] == "省略不清空"
    assert client.patch(record_route, json={
        "record_type": "issue", "topic_ids": [],
    }).json()["topic_ids"] == []
    assert client.patch(record_route, json={
        "record_type": "issue", "topic_ids": None,
    }).status_code == 422


def test_issue_history_completion_notes_and_old_baseline() -> None:
    client = _client()
    topic = _topic(client)
    record = client.post("/api/v1/records/direct", json=_issue(topic_ids=[topic["id"]])).json()
    route = f"/api/v1/records/{record['id']}"
    activities = route + "/activities"
    assert client.get(activities).json()["items"][0]["previous_status"] is None
    assert client.patch(route, json={"record_type": "issue", "status": "done"}).status_code == 422
    processing = client.patch(route, json={"record_type": "issue", "status": "in_progress"})
    assert processing.status_code == 200
    client.patch(route, json={"record_type": "issue", "status": "in_progress"})
    assert len(client.get(activities).json()["items"]) == 2
    assert client.post(activities, json={"content": "   "}).status_code == 422
    assert client.post(activities, json={"content": "电工明天到场"}).status_code == 201
    assert client.patch(route, json={
        "record_type": "issue", "status": "done", "actual_result": "已完成接线",
    }).status_code == 200
    rows = client.get(activities).json()["items"]
    assert rows[0]["next_status"] == "done" and "已完成接线" in rows[0]["content"]
    assert client.get(f"/api/v1/topics/{topic['id']}/overview").json()["pending_issues"] == []
    previous_date = client.get(route).json()["completed_at"]
    assert client.patch(route, json={
        "record_type": "issue", "status": "pending", "actual_result": None,
    }).status_code == 200
    reopened = client.get(activities).json()["items"][0]
    assert "已完成接线" in reopened["content"] and previous_date in reopened["content"]
    research = client.post("/api/v1/research", json={"title": "比较开关"}).json()
    assert client.get(f"/api/v1/records/{research['id']}/activities").status_code == 422
    # 模拟迁移前已有事项，读取不会凭空制造历史。
    with Session(client.app.state.engine) as db:
        db.add(Record(id="legacy", project_id=record["project_id"], record_type="issue",
                      title="旧事项", status="pending"))
        db.commit()
    assert client.get("/api/v1/records/legacy/activities").json() == {"items": []}


def test_aggregate_processes_pagination_unknown_dates_and_delete_cascade() -> None:
    client = _client()
    topic = _topic(client)
    route = f"/api/v1/topics/{topic['id']}"
    research = client.post("/api/v1/research", json={
        "title": "比较开关", "topic_ids": [topic["id"]],
    }).json()
    for day in ["2026-10-01", "2026-10-03"]:
        client.post(f"/api/v1/research/{research['id']}/entries", json={
            "research_date": day, "content": "过程" + day,
        })
    pitfall = client.post("/api/v1/pitfalls", json={
        "occurred_date": "2026-10-02", "description": "底盒太浅", "topic_ids": [topic["id"]],
    }).json()
    client.post(f"/api/v1/pitfalls/{pitfall['id']}/resolutions", json={
        "resolved_date": "2026-10-04", "content": "更换底盒",
    })
    all_items = client.get(route + "/activities").json()
    assert all_items["total"] == 5
    assert len({row["id"] for row in all_items["items"]}) == 5
    unknown = next(row for row in all_items["items"] if row["object_kind"] == "record")
    assert unknown["date_missing"]
    assert client.get(route + "/activities?record_type=research").json()["total"] == 3
    page = client.get(route + "/activities?offset=1&limit=2").json()
    assert page["items"] == all_items["items"][1:3]
    assert client.get(route + "/activities?offset=-1").status_code == 422
    client.delete(f"/api/v1/pitfalls/{pitfall['id']}")
    assert client.get(route + "/activities").json()["total"] == 3
    client.delete(f"/api/v1/records/{research['id']}")
    assert client.get(route + "/activities").json()["total"] == 0


def test_topic_migration_preserves_existing_tables(tmp_path: Path, monkeypatch) -> None:
    url = database_url(tmp_path / "topic-migration.sqlite3")
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0020_add_research_history")
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO records (id, project_id, record_type, title, timezone, status, "
            "created_at, updated_at) VALUES ('old-issue', "
            "'00000000000000000000000000000001', 'issue', '旧事项', "
            "'Asia/Shanghai', 'in_progress', '2020-01-01', '2020-01-01')"
        ))
        tables = [row[0] for row in connection.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name != 'alembic_version'"
        ))]
        snapshot = {table: connection.execute(text(f'SELECT * FROM "{table}"')).all()
                    for table in tables}
        columns = {table: [row[1] for row in connection.execute(text(
            f'PRAGMA table_info("{table}")',
        ))] for table in tables}
    command.upgrade(config, "head")
    with engine.connect() as connection:
        for table, rows in snapshot.items():
            selected = ", ".join(f'"{column}"' for column in columns[table])
            assert connection.execute(text(f'SELECT {selected} FROM "{table}"')).all() == rows
        assert connection.execute(text(
            "SELECT version FROM records WHERE id='old-issue'",
        )).scalar_one() == 1
        assert connection.execute(text("SELECT COUNT(*) FROM issue_activities")).scalar_one() == 0
        assert connection.execute(text("PRAGMA integrity_check")).scalar_one() == "ok"
    command.downgrade(config, "0020_add_research_history")
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT title FROM records WHERE id='old-issue'",
        )).scalar_one() == "旧事项"
    engine.dispose()


def test_record_deletion_cleans_links_and_issue_history() -> None:
    client = _client()
    topic = _topic(client)
    record = client.post("/api/v1/records/direct", json=_issue(topic_ids=[topic["id"]])).json()
    client.delete(f"/api/v1/records/{record['id']}")
    with Session(client.app.state.engine) as db:
        assert list(db.scalars(select(RecordTopic))) == []
        assert list(db.scalars(select(IssueActivity))) == []


def test_foreign_project_topic_rejected_and_ledger_statistics_not_duplicated() -> None:
    client = _client()
    first, second = _topic(client), _topic(client, "家电")
    with Session(client.app.state.engine) as db:
        db.add(Project(id="other", name="另一项目"))
        db.flush()
        db.add(Topic(id="foreign", project_id="other", name="外部主题"))
        db.commit()
    assert client.post("/api/v1/records/direct", json=_issue(
        topic_ids=["foreign"],
    )).status_code == 422
    assert client.get("/api/v1/topics/foreign").status_code == 404
    vendor = client.post("/api/v1/vendors", json={"name": "开关店"}).json()
    result = client.post("/api/v1/records/direct", json={
        "record_type": "ledger", "title": "开关货款", "status": "paid",
        "ledger_kind": "payment", "direction": "expense", "payment_kind": "full",
        "vendor_id": vendor["id"], "amount_minor": 35000,
        "topic_ids": [first["id"], second["id"]],
    })
    assert result.status_code == 201, result.text
    assert client.get("/api/v1/ledger/summary").json()["totals"]["expense_minor"] == 35000
    for topic in [first, second]:
        detail = client.get(f"/api/v1/topics/{topic['id']}").json()
        assert len(detail["records"]) == 1


def test_generic_record_create_captures_issue_baseline_and_membership() -> None:
    client = _client()
    topic = _topic(client)
    source = client.post("/api/v1/sources", json={
        "input_type": "text", "original_text": "确认灯带接线",
    }).json()
    response = client.post("/api/v1/records", json=_issue(
        source_refs=[{"source_id": source["id"]}], topic_ids=[topic["id"]],
    ))
    assert response.status_code == 201, response.text
    record = response.json()
    assert record["topic_ids"] == [topic["id"]]
    activities = client.get(f"/api/v1/records/{record['id']}/activities").json()["items"]
    assert len(activities) == 1
    assert activities[0]["previous_status"] is None
    assert activities[0]["next_status"] == "pending"


def test_candidate_confirmation_topics_and_issue_history_atomic_and_idempotent() -> None:
    client = _client()
    topic = _topic(client)
    original = "待现场规划壁龛如何铺贴，是花砖还是普通砖。"
    source = client.post("/api/v1/sources", json={
        "input_type": "text", "original_text": original,
    }).json()
    bundle = client.post(f"/api/v1/sources/{source['id']}/extractions?engine=local").json()
    candidate = next(row for row in bundle["suggestions"] if row["record_type"] == "research")
    route = f"/api/v1/candidate-bundles/{bundle['id']}/confirm"
    payload = _issue(topic_ids=[topic["id"]])
    body = {"expected_version": bundle["version"], "selections": [
        {"key": candidate["key"], "payload": {**payload, "topic_ids": ["missing"]}},
    ]}
    before = _counts(client)
    assert client.post(route, json=body).status_code == 422
    assert _counts(client) == before
    assert client.get(f"/api/v1/sources/{source['id']}").json()["original_text"] == original
    unchanged = client.get(f"/api/v1/candidate-bundles/{bundle['id']}").json()
    assert unchanged["version"] == bundle["version"]
    body["selections"][0]["payload"] = payload
    response = client.post(route, json=body)
    assert response.status_code == 200, response.text
    confirmed = response.json()
    record = confirmed["records"][0]["record"]
    assert record["topic_ids"] == [topic["id"]]
    activities = f"/api/v1/records/{record['id']}/activities"
    assert len(client.get(activities).json()["items"]) == 1
    body["expected_version"] = confirmed["bundle"]["version"]
    repeat = client.post(route, json=body)
    assert repeat.status_code == 200, repeat.text
    assert not repeat.json()["records"][0]["created"]
    assert len(client.get(activities).json()["items"]) == 1
    assert len(client.get(f"/api/v1/records?source_id={source['id']}").json()) == 1


def test_candidate_later_invalid_membership_rolls_back_earlier_record_and_history() -> None:
    client = _client()
    topic = _topic(client)
    source = client.post("/api/v1/sources", json={
        "input_type": "text", "original_text": "已交500元，待现场规划壁龛如何铺贴。",
    }).json()
    bundle = client.post(f"/api/v1/sources/{source['id']}/extractions?engine=local").json()
    assert len(bundle["suggestions"]) >= 2
    before = _counts(client)
    first, second = bundle["suggestions"][:2]
    response = client.post(f"/api/v1/candidate-bundles/{bundle['id']}/confirm", json={
        "expected_version": bundle["version"], "selections": [
            {"key": first["key"], "payload": _issue(topic_ids=[topic["id"]])},
            {"key": second["key"], "payload": _issue(topic_ids=["missing"])},
        ],
    })
    assert response.status_code == 422, response.text
    assert _counts(client) == before
    with Session(client.app.state.engine) as db:
        assert list(db.scalars(select(IssueActivity))) == []
        assert list(db.scalars(select(RecordTopic))) == []
    assert client.get(f"/api/v1/topics/{topic['id']}").json()["records"] == []
    latest = client.get(f"/api/v1/candidate-bundles/{bundle['id']}").json()
    assert latest["version"] == bundle["version"]
    assert all(not row.get("confirmed_record_id") for row in latest["suggestions"])


@pytest.mark.parametrize("kind", ["research", "pitfalls"])
def test_specialized_patch_topic_omission_clear_and_archived_validation(kind: str) -> None:
    client = _client()
    topic = _topic(client)
    other = _topic(client, "已归档的其他主题")
    create = {"title": "调研开关"} if kind == "research" else {
        "occurred_date": "2026-10-11", "description": "底盒问题",
    }
    item = client.post(f"/api/v1/{kind}", json={
        **create, "topic_ids": [topic["id"]],
    }).json()
    route = f"/api/v1/{kind}/{item['id']}"
    field = "title" if kind == "research" else "description"
    for archived in [topic, other]:
        client.patch(f"/api/v1/topics/{archived['id']}", json={"status": "archived"})
    retained = client.patch(route, json={field: "保留归属", "topic_ids": [topic["id"]]})
    assert retained.status_code == 200, retained.text
    assert retained.json()["topic_ids"] == [topic["id"]]
    omitted = client.patch(route, json={field: "省略保留"})
    assert omitted.json()["topic_ids"] == [topic["id"]]
    for invalid in [None, [other["id"]], ["missing"]]:
        failed = client.patch(route, json={field: "不能落库", "topic_ids": invalid})
        assert failed.status_code == 422, failed.text
        detail = client.get(f"/api/v1/topics/{topic['id']}").json()
        stored = detail["records" if kind == "research" else "pitfalls"][0]
        assert stored[field] == "省略保留"
    cleared = client.patch(route, json={"topic_ids": []})
    assert cleared.status_code == 200 and cleared.json()["topic_ids"] == []
