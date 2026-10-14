from __future__ import annotations

import json

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain_models import Record
from app.models import AuditEntry, SourceEntry
from tests.test_pitfalls import _client


def _issue(**changes: object) -> dict:
    return {
        "record_type": "issue", "title": "确认灯带接线", "status": "pending",
        "phenomenon": "需要与电工确认接线", "severity": "medium", **changes,
    }


def _counts(client) -> tuple[int, ...]:
    with Session(client.app.state.engine) as db:
        return tuple(db.scalar(select(func.count()).select_from(model))
                     for model in (Record, SourceEntry, AuditEntry))


def test_direct_issue_preserves_source_audit_and_completion_workflow() -> None:
    client = _client()
    response = client.post("/api/v1/records/direct", json=_issue())
    assert response.status_code == 201, response.text
    record = response.json()
    assert len(record["source_refs"]) == 1
    with Session(client.app.state.engine) as db:
        source = db.get(SourceEntry, record["source_refs"][0]["source_id"])
        snapshot = json.loads(source.original_text.split("\n录入字段：\n", 1)[1])
        assert snapshot["phenomenon"] == "需要与电工确认接线"
        audited = db.scalars(select(AuditEntry).where(
            AuditEntry.target_id.in_([source.id, record["id"]]),
        )).all()
        assert {row.target_table for row in audited} == {"source_entries", "records"}
    route = f"/api/v1/records/{record['id']}"
    assert client.patch(route, json={
        "record_type": "issue", "status": "done", "actual_result": "已确认接线图",
    }).json()["completed_at"]
    assert client.get(route).json()["actual_result"] == "已确认接线图"


@pytest.mark.parametrize("kind,direction,state", [
    ("payment", "expense", "paid"), ("refund", "refund", "posted"),
    ("income", "income", "posted"),
])
def test_direct_ledger_enters_existing_ledger_projection(kind, direction, state) -> None:
    client = _client()
    vendor = client.post("/api/v1/vendors", json={"name": "灯具店"}).json()
    response = client.post("/api/v1/records/direct", json={
        "record_type": "ledger", "title": "灯带款项", "status": state,
        "ledger_kind": kind, "direction": direction, "payment_kind": "full",
        "vendor_id": vendor["id"], "amount_minor": 12345, "currency": "人民币",
        "payment_date": "2026-10-10",
    })
    assert response.status_code == 201, response.text
    assert response.json()["currency"] == "CNY"
    totals = client.get("/api/v1/ledger/summary").json()["totals"]
    assert totals[f"{direction}_minor"] == 12345


@pytest.mark.parametrize("changes", [
    {"related_record_ids": ["missing"]}, {"space_ids": ["missing"]},
    {"status": "done"}, {"completed_at": "2026-10-10"},
    {"title": "   "}, {"phenomenon": "  "},
    {"source_refs": [{"source_id": "missing"}]}, {"record_type": "event"},
])
def test_direct_invalid_request_leaves_no_source_record_or_audit(changes) -> None:
    client = _client()
    before = _counts(client)
    response = client.post("/api/v1/records/direct", json=_issue(**changes))
    assert response.status_code in (400, 422), response.text
    assert _counts(client) == before


def test_direct_ledger_invalid_vendor_rolls_back_and_requires_auth() -> None:
    client = _client()
    before = _counts(client)
    response = client.post("/api/v1/records/direct", json={
        "record_type": "ledger", "title": "灯带", "status": "paid",
        "ledger_kind": "payment", "direction": "expense", "payment_kind": "full",
        "vendor_id": "missing", "amount_minor": 12345,
    })
    assert response.status_code == 400, response.text
    assert _counts(client) == before
    client.headers.clear()
    assert client.post("/api/v1/records/direct", json=_issue()).status_code == 401
    assert _counts(client) == before
