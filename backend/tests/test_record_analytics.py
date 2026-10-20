from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from app.analytics import type_specific_analytics
from app.db import create_session_factory
from app.domain_models import Record
from tests.record_context import clear_historical_context
from tests.test_views import _client, _record, _source


@pytest.mark.parametrize(
    "record_type", ["event", "ledger", "issue", "measurement", "decision", "research"]
)
def test_each_type_groups_stages_by_id_and_keeps_missing_stage(record_type: str) -> None:
    rows = [
        {"stage": {"id": "stage-a", "name": "施工"}},
        {"stage": {"id": "stage-a", "name": "施工"}},
        {"stage": {"id": "stage-b", "name": "施工"}},
        {"stage": None},
    ]
    result = type_specific_analytics(record_type, rows, today=date(2026, 10, 20))
    assert result["stage_distribution"] == [
        {"key": "stage-a", "label": "施工", "value": 2},
        {"key": "stage-b", "label": "施工", "value": 1},
        {"key": "unknown", "label": "阶段待补充", "value": 1},
    ]
    assert "dimension" in result and "distribution" in result
    assert ("space_distribution" in result) == (record_type in {"decision", "research"})


@pytest.mark.parametrize("record_type", ["decision", "research"])
def test_space_distribution_counts_distinct_associations_per_record(record_type: str) -> None:
    room_a = {"id": "room-a", "name": "卧室"}
    room_b = {"id": "room-b", "name": "卧室"}
    result = type_specific_analytics(record_type, [
        {"spaces": [room_a, room_a, room_b]},
        {"spaces": [room_a]},
        {"spaces": []},
        {},
    ], today=date(2026, 10, 20))
    assert result["space_distribution"] == [
        {"key": "room-a", "label": "卧室", "value": 2},
        {"key": "unknown", "label": "空间待补充", "value": 2},
        {"key": "room-b", "label": "卧室", "value": 1},
    ]


def test_empty_analytics_does_not_invent_categories_or_change_all_types() -> None:
    assert type_specific_analytics(None, [], today=date(2026, 10, 20)) == {}
    for record_type in ["event", "ledger", "issue", "measurement", "decision", "research"]:
        result = type_specific_analytics(record_type, [], today=date(2026, 10, 20))
        assert result["stage_distribution"] == []
        if record_type in {"decision", "research"}:
            assert result["space_distribution"] == []


def test_record_analytics_new_distributions_share_all_record_filters() -> None:
    client = _client()
    source_id = _source(client, "筛选范围内的装修决策。")
    stage = client.post("/api/v1/stages", json={"name": "安装"}).json()
    other_stage = client.post("/api/v1/stages", json={"name": "设计"}).json()
    first_floor = client.post("/api/v1/spaces", json={"name": "一楼", "kind": "house"}).json()
    second_floor = client.post("/api/v1/spaces", json={"name": "二楼", "kind": "house"}).json()
    room_a = client.post("/api/v1/spaces", json={
        "name": "卧室", "kind": "room", "parent_id": first_floor["id"],
    }).json()
    room_b = client.post("/api/v1/spaces", json={
        "name": "卧室", "kind": "room", "parent_id": second_floor["id"],
    }).json()
    baseline = {
        "record_type": "decision", "status": "confirmed", "topic": "柜体颜色",
        "selected_option": "白色", "stage_id": stage["id"],
        "space_ids": [room_a["id"], room_b["id"]], "occurred_date": "2026-10-17",
    }
    target = _record(client, source_id, {**baseline, "title": "保留的决策"})
    for title, changes in [
        ("其他状态", {"status": "pending"}),
        ("其他阶段", {"stage_id": other_stage["id"]}),
        ("其他日期", {"occurred_date": "2026-09-30"}),
        ("其他空间", {"space_ids": [room_b["id"]]}),
    ]:
        _record(client, source_id, {**baseline, **changes, "title": title})
    legacy = _record(client, source_id, {**baseline, "title": "历史缺少阶段空间"})
    clear_historical_context(client, legacy["id"])
    _record(client, source_id, {
        "record_type": "event", "title": "其他类型", "status": "occurred",
        "event_kind": "shopping", "stage_id": stage["id"],
        "space_ids": [room_a["id"]], "occurred_date": "2026-10-17",
    })
    response = client.get("/api/v1/records/analytics", params={
        "record_type": "decision", "status": "confirmed", "stage_id": stage["id"],
        "space_id": room_a["id"], "date_from": "2026-10-01", "date_to": "2026-10-20",
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert [row["id"] for row in data["records"]] == [target["id"]]
    assert data["summary"]["total"] == 1
    assert data["specific"]["stage_distribution"] == [
        {"key": stage["id"], "label": "安装", "value": 1}
    ]
    assert {row["key"]: row for row in data["specific"]["space_distribution"]} == {
        room_a["id"]: {"key": room_a["id"], "label": "卧室", "value": 1},
        room_b["id"]: {"key": room_b["id"], "label": "卧室", "value": 1},
    }
    unfiltered = client.get("/api/v1/records/analytics?record_type=decision").json()
    assert {row["key"]: row["value"] for row in unfiltered["specific"]["stage_distribution"]} == {
        stage["id"]: 4, other_stage["id"]: 1, "unknown": 1,
    }
    assert next(row for row in unfiltered["specific"]["space_distribution"]
                if row["key"] == "unknown")["value"] == 1
    empty = client.get("/api/v1/records/analytics?record_type=decision&date_from=2027-01-01").json()
    assert empty["summary"]["total"] == 0
    assert empty["specific"]["stage_distribution"] == []
    assert empty["specific"]["space_distribution"] == []


def test_ledger_entries_use_actual_date_then_creation_and_stable_id() -> None:
    client = _client()
    source_id = _source(client, "账目发生日期与补录日期不同。")
    rows = []
    dates = ["2026-10-20", "2026-10-17", "2026-10-17", "2026-10-17", "2026-08-23", None]
    for index, occurred_date in enumerate(dates):
        rows.append(_record(client, source_id, {
            "record_type": "ledger", "ledger_kind": "payment", "title": f"账目 {index}",
            "status": "paid", "direction": "expense", "payment_kind": "other",
            "amount_minor": 100, "occurred_date": occurred_date,
            "payment_date": "2026-10-22" if occurred_date is None else occurred_date,
        }))
    # 固定录入时间，明确验证补录、同日补录及完全同一时间的稳定次序。
    with create_session_factory(client.app.state.engine)() as db:
        for index, day in enumerate([1, 10, 11, 11, 20, 21]):
            record = db.get(Record, rows[index]["id"])
            assert record is not None
            record.created_at = datetime(2026, 10, day, tzinfo=UTC)
        db.commit()
    response = client.get("/api/v1/ledger/summary")
    assert response.status_code == 200, response.text
    data = response.json()
    assert [row["id"] for row in data["ledger_entries"]] == [
        rows[0]["id"],
        *sorted([rows[2]["id"], rows[3]["id"]], reverse=True),
        rows[1]["id"], rows[4]["id"], rows[5]["id"],
    ]
    assert data["ledger_entries"][-1]["occurred_date"] is None
    assert data["totals"]["expense_minor"] == 600
    filtered = client.get("/api/v1/ledger/summary", params={
        "date_from": "2026-10-01", "date_to": "2026-10-20",
    }).json()
    assert [row["id"] for row in filtered["ledger_entries"]] == [
        row["id"] for row in data["ledger_entries"][:4]
    ]
