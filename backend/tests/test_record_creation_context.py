from __future__ import annotations

from copy import deepcopy

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.domain_models import CandidateBundle, Record, RecordRelation, record_spaces
from app.models import AuditEntry, SourceEntry
from tests.record_context import record_context
from tests.test_domain import RECORD_CASES
from tests.test_views import _client, _source


def _counts(client) -> tuple[int, ...]:
    with Session(client.app.state.engine) as db:
        return tuple(db.scalar(select(func.count()).select_from(model))
                     for model in (Record, SourceEntry, AuditEntry, RecordRelation))


def _generic_payload(client, record_type: str) -> dict:
    _, state, detail = next(row for row in RECORD_CASES if row[0] == record_type)
    payload = {
        **record_context(client), **detail, "record_type": record_type,
        "status": state, "title": "明确选择空间和阶段",
        "source_refs": [{"source_id": _source(client, "本次记录的真实来源。")}],
    }
    if record_type == "ledger":
        payload["vendor_id"] = client.post("/api/v1/vendors", json={"name": "测试商家"}).json()[
            "id"
        ]
    return payload


@pytest.mark.parametrize("record_type", [row[0] for row in RECORD_CASES])
@pytest.mark.parametrize("missing", ["space_ids", "stage_id", "both"])
def test_all_six_record_creation_types_require_context(record_type: str, missing: str) -> None:
    client = _client()
    payload = _generic_payload(client, record_type)
    for field in (["space_ids", "stage_id"] if missing == "both" else [missing]):
        payload.pop(field)
    before = _counts(client)
    response = client.post("/api/v1/records", json=payload)
    assert response.status_code == 422, response.text
    if missing != "stage_id":
        assert "空间" in response.json()["detail"]
    if missing != "space_ids":
        assert "装修阶段" in response.json()["detail"]
    assert _counts(client) == before


@pytest.mark.parametrize("changes,message", [
    ({"space_ids": []}, "空间"),
    ({"space_ids": [""]}, "空间"),
    ({"space_ids": ["  "]}, "空间"),
    ({"stage_id": None}, "装修阶段"),
    ({"stage_id": ""}, "装修阶段"),
    ({"stage_id": " \t "}, "装修阶段"),
])
def test_empty_or_whitespace_context_has_clear_chinese_error(changes: dict, message: str) -> None:
    client = _client()
    payload = {**_generic_payload(client, "event"), **changes}
    before = _counts(client)
    response = client.post("/api/v1/records", json=payload)
    assert response.status_code == 422, response.text
    assert message in response.json()["detail"]
    assert _counts(client) == before


@pytest.mark.parametrize("field,value", [("space_ids", ["missing"]), ("stage_id", "missing")])
def test_context_requires_existing_references(field: str, value: object) -> None:
    client = _client()
    payload = {**_generic_payload(client, "event"), field: value}
    before = _counts(client)
    response = client.post("/api/v1/records", json=payload)
    assert response.status_code == 400, response.text
    assert "无效" in response.json()["detail"]
    assert _counts(client) == before


@pytest.mark.parametrize("entry", ["direct-issue", "direct-ledger", "research"])
@pytest.mark.parametrize("missing", ["space_ids", "stage_id"])
def test_specialized_creation_rolls_back_generated_source_and_audit(
    entry: str, missing: str
) -> None:
    client = _client()
    if entry == "research":
        endpoint, payload = "/api/v1/research", {**record_context(client), "title": "调研灯具"}
    else:
        kind = "ledger" if entry == "direct-ledger" else "issue"
        endpoint, payload = "/api/v1/records/direct", _generic_payload(client, kind)
        payload.pop("source_refs")
    payload.pop(missing)
    before = _counts(client)
    response = client.post(endpoint, json=payload)
    assert response.status_code == 422, response.text
    assert ("空间" if missing == "space_ids" else "装修阶段") in response.json()["detail"]
    assert _counts(client) == before
    response = client.post(endpoint, json={**payload, **record_context(client)})
    assert response.status_code == 201, response.text


def _candidate(client, mode: str) -> tuple[str, dict, dict]:
    source_id = _source(client, "今天去现场查看。")
    if mode == "bundle":
        bundle = client.post(f"/api/v1/sources/{source_id}/extractions?engine=local").json()
        endpoint = f"/api/v1/candidate-bundles/{bundle['id']}/confirm"
        body = {"expected_version": bundle["version"]}
    else:
        bundle = client.get(f"/api/v1/sources/{source_id}/suggestions").json()
        endpoint, body = f"/api/v1/sources/{source_id}/suggestions/confirm", {}
    candidate = bundle["suggestions"][0]
    body["selections"] = [{"key": candidate["key"], "payload": deepcopy(candidate["payload"])}]
    return endpoint, body, bundle


@pytest.mark.parametrize("mode", ["bundle", "legacy"])
def test_candidates_require_context_but_historical_repeat_remains_idempotent(mode: str) -> None:
    client = _client()
    context = record_context(client)
    endpoint, body, _ = _candidate(client, mode)
    before = _counts(client)
    rejected = client.post(endpoint, json=body)
    assert rejected.status_code == 422, rejected.text
    assert "空间" in rejected.json()["detail"] and "装修阶段" in rejected.json()["detail"]
    assert _counts(client) == before
    body["selections"][0]["payload"].update(context)
    created = client.post(endpoint, json=body)
    assert created.status_code == 200, created.text
    record_id = created.json()["records"][0]["record"]["id"]
    _remove_historical_context(client, record_id)
    body["selections"][0]["payload"].update({"space_ids": [], "stage_id": None})
    if mode == "bundle":
        body["expected_version"] = created.json()["bundle"]["version"]
    before = _counts(client)
    repeated = client.post(endpoint, json=body)
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["records"][0]["created"] is False
    assert repeated.json()["records"][0]["record"]["id"] == record_id
    assert _counts(client)[:2] == before[:2]


def test_candidate_batch_with_missing_context_is_atomic() -> None:
    client = _client()
    context = record_context(client)
    endpoint, body, bundle = _candidate(client, "bundle")
    # 构造同一来源下第二条独立候选，确保第一条写入后第二条失败仍整体回滚。
    with Session(client.app.state.engine) as db:
        stored = db.get(CandidateBundle, bundle["id"])
        content = deepcopy(stored.bundle_json)
        second = deepcopy(content["suggestions"][0])
        second["key"] += "-second"
        content["suggestions"].append(second)
        stored.bundle_json = content
        db.commit()
    body["selections"][0]["payload"].update(context)
    body["selections"].append({"key": second["key"], "payload": {
        **second["payload"], **context, "stage_id": None,
    }})
    before = _counts(client)
    response = client.post(endpoint, json=body)
    assert response.status_code == 422, response.text
    assert _counts(client) == before
    current = client.get(endpoint.removesuffix("/confirm")).json()
    assert current["version"] == bundle["version"]
    assert all(not row.get("confirmed_record_id") for row in current["suggestions"])


def _remove_historical_context(client, record_id: str) -> None:
    with Session(client.app.state.engine) as db:
        row = db.get(Record, record_id)
        row.stage_id = None
        db.execute(delete(record_spaces).where(record_spaces.c.record_id == record_id))
        db.commit()


@pytest.mark.parametrize("kind", ["event", "issue", "research"])
def test_historical_missing_context_keeps_edit_and_append_compatibility(kind: str) -> None:
    client = _client()
    created = client.post("/api/v1/records", json=_generic_payload(client, kind))
    assert created.status_code == 201, created.text
    record_id = created.json()["id"]
    _remove_historical_context(client, record_id)
    edited = client.patch(f"/api/v1/records/{record_id}", json={
        "record_type": kind, "description": "历史记录仍可编辑",
    })
    assert edited.status_code == 200, edited.text
    assert edited.json()["stage_id"] is None and edited.json()["space_ids"] == []
    if kind == "research":
        assert client.patch(f"/api/v1/research/{record_id}", json={
            "description": "专项编辑也兼容",
        }).status_code == 200
        assert client.post(f"/api/v1/research/{record_id}/entries", json={
            "research_date": "2026-10-20", "content": "追加比较结果",
        }).status_code == 201
    elif kind == "issue":
        assert client.patch(f"/api/v1/records/{record_id}", json={
            "record_type": "issue", "status": "done", "actual_result": "已核实完成",
        }).status_code == 200
