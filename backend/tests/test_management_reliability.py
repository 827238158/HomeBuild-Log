from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.db import database_url
from app.domain_models import Record
from app.record_version import bump_record_version
from tests.test_direct_records import _issue
from tests.test_pitfalls import _client


def raw(client, method, url, **kwargs):
    # 缺失版本、旧版本和竞争用例禁止测试客户端自动补齐版本。
    return TestClient.request(client, method, url, **kwargs)


def test_due_date_overview_boundaries_and_completion(monkeypatch):
    monkeypatch.setattr("app.api.analytics._today", lambda: date(2026, 10, 14))
    client = _client()
    ids = {}
    for label, due in [("late", "2026-10-13"), ("today", "2026-10-14"),
                       ("last", "2026-10-20"), ("outside", "2026-10-21"),
                       ("none", None)]:
        row = client.post("/api/v1/records/direct", json=_issue(title=label, due_date=due)).json()
        assert row["due_date"] == due
        ids[label] = row
    overview = client.get("/api/v1/overview").json()
    assert overview["horizon_date"] == "2026-10-20"
    assert {row["title"] for row in overview["overdue"]} == {"late"}
    assert {row["title"] for row in overview["upcoming"]} == {"today", "last"}
    row = ids["late"]
    done = raw(client, "PATCH", f"/api/v1/records/{row['id']}", json={
        "record_type": "issue", "expected_version": row["version"],
        "status": "done", "actual_result": "已核实",
    }).json()
    assert client.get("/api/v1/overview").json()["summary"]["overdue_count"] == 0
    raw(client, "PATCH", f"/api/v1/records/{row['id']}", json={
        "record_type": "issue", "expected_version": done["version"], "status": "pending",
    })
    assert client.get("/api/v1/overview").json()["summary"]["overdue_count"] == 1


def test_missing_and_stale_versions_and_transaction_rollback():
    client = _client()
    first = client.post("/api/v1/records/direct", json=_issue()).json()
    second = client.post("/api/v1/records/direct", json=_issue(title="另一事项")).json()
    route = f"/api/v1/records/{first['id']}"
    missing = raw(client, "PATCH", route, json={"record_type": "issue", "title": "覆盖"})
    assert missing.status_code == 422
    assert raw(client, "DELETE", route).status_code == 422
    updated = raw(client, "PATCH", route, json={
        "record_type": "issue", "expected_version": 1, "title": "手机已保存",
    })
    assert updated.status_code == 200, updated.text
    conflict = raw(client, "PATCH", route, json={
        "record_type": "issue", "expected_version": 1, "title": "电脑旧稿",
        "related_record_ids": [second["id"]],
    })
    assert conflict.status_code == 409
    detail = conflict.json()["detail"]
    assert detail["code"] == "record_version_conflict"
    assert detail["current_version"] == 2
    assert detail["latest_record"]["title"] == "手机已保存"
    assert client.get(route).json()["related_record_ids"] == []
    assert client.get(f"/api/v1/records/{second['id']}").json()["version"] == 1
    invalid = raw(client, "PATCH", route, json={
        "record_type": "issue", "expected_version": 2,
        "related_record_ids": [second["id"]], "topic_ids": ["missing"],
    })
    assert invalid.status_code == 422
    assert client.get(route).json()["version"] == 2
    assert client.get(f"/api/v1/records/{second['id']}").json()["version"] == 1


def test_two_sessions_cas_never_overwrite_winner():
    client = _client()
    row = client.post("/api/v1/records/direct", json=_issue()).json()
    with Session(client.app.state.engine) as first, Session(client.app.state.engine) as second:
        a, b = first.get(Record, row["id"]), second.get(Record, row["id"])
        av, bv = a.version, b.version
        bump_record_version(first, a, av)
        a.title = "先保存内容"
        first.commit()
        with pytest.raises(HTTPException) as error:
            bump_record_version(second, b, bv)
        assert error.value.status_code == 409
    saved = client.get(f"/api/v1/records/{row['id']}").json()
    assert saved["title"] == "先保存内容" and saved["version"] == 2
    # 另一会话删除之后，旧编辑应返回可恢复的不存在提示。
    with Session(client.app.state.engine) as first, Session(client.app.state.engine) as second:
        a, b = first.get(Record, row["id"]), second.get(Record, row["id"])
        old_version = b.version
        first.delete(a)
        first.commit()
        with pytest.raises(HTTPException) as error:
            bump_record_version(second, b, old_version)
        assert error.value.status_code == 404


def test_process_search_groups_dedup_and_pagination():
    client = _client()
    research = client.post("/api/v1/research", json={"title": "调研"}).json()
    for content, sources, uncertainties in [("专属关键词正文", [], None),
                                            ("第二条", ["专属关键词来源"], "专属关键词疑问")]:
        client.post(f"/api/v1/research/{research['id']}/entries", json={
            "research_date": "2026-10-14", "content": content,
            "sources": sources, "uncertainties": uncertainties,
        })
    issue = client.post("/api/v1/records/direct", json=_issue()).json()
    client.post(f"/api/v1/records/{issue['id']}/activities", json={"content": "专属关键词进展"})
    topic = client.post("/api/v1/topics", json={"name": "主题", "goal": "专属关键词目标"}).json()
    pitfall = client.post("/api/v1/pitfalls", json={
        "occurred_date": "2026-10-14", "description": "踩坑经过",
    }).json()
    client.post(f"/api/v1/pitfalls/{pitfall['id']}/resolutions", json={
        "resolved_date": "2026-10-14", "content": "专属关键词处理",
    })
    result = client.get("/api/v1/search?q=专属关键词&limit=1").json()
    assert result["counts"]["records"] == 2
    assert result["counts"]["topics"] == result["counts"]["pitfalls"] == 1
    assert result["groups"]["topics"][0]["id"] == topic["id"]
    assert result["groups"]["pitfalls"][0]["search_matches"][0]["kind"] == "pitfall_resolution"
    page = client.get("/api/v1/search?q=专属关键词&limit=1&offset=1").json()
    assert len(page["groups"]["records"]) == 1
    assert page["groups"]["records"][0]["id"] != result["groups"]["records"][0]["id"]
    filtered = client.get("/api/v1/search?q=专属关键词&record_type=research").json()
    assert filtered["counts"]["records"] == 1
    assert len(filtered["groups"]["records"][0]["search_matches"]) == 2
    assert filtered["counts"]["topics"] == 1


def test_0022_upgrade_old_issue_keeps_fields_and_empty_due_date(tmp_path, monkeypatch):
    url = database_url(tmp_path / "management-upgrade.sqlite3")
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0021_add_topics_and_issue_activities")
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO records (id, project_id, record_type, title, timezone, status, "
            "created_at, updated_at) VALUES ('old', '00000000000000000000000000000001', "
            "'issue', '旧记录', 'Asia/Shanghai', 'pending', '2020-01-01', '2020-01-01')"
        ))
        connection.execute(text(
            "INSERT INTO issue_details (record_id, phenomenon, severity, handling_plan) "
            "VALUES ('old', '真实现象', 'medium', '既有计划')"
        ))
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT version,title,status FROM records WHERE id='old'",
        )).one() == (1, "旧记录", "pending")
        assert connection.execute(text(
            "SELECT due_date,phenomenon,handling_plan FROM issue_details WHERE record_id='old'",
        )).one() == (None, "真实现象", "既有计划")
        assert connection.execute(text("PRAGMA integrity_check")).scalar_one() == "ok"
    command.downgrade(config, "0021_add_topics_and_issue_activities")
    command.upgrade(config, "head")
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT due_date FROM issue_details WHERE record_id='old'",
        )).scalar_one() is None
    engine.dispose()
