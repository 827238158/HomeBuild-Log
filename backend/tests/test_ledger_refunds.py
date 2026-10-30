from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain_models import LedgerDetail, Record
from app.models import AuditEntry, SourceEntry
from tests.record_context import clear_historical_context, creation_payload, record_context
from tests.test_pitfalls import _client


def _payment(client, **changes):
    vendor = client.post("/api/v1/vendors", json={"name": "退款测试商家"}).json()
    response = client.post("/api/v1/records/direct", json=creation_payload(client, {
        "record_type": "ledger", "title": "厨房灯具付款", "description": "原付款备注",
        "status": "paid", "ledger_kind": "payment", "direction": "expense",
        "payment_kind": "full", "vendor_id": vendor["id"], "amount_minor": 10000,
        "occurred_date": "2026-09-15", "payment_date": "2026-09-15", **changes,
    }))
    assert response.status_code == 201, response.text
    return response.json()


def _record(client, record_id):
    response = client.get(f"/api/v1/records/{record_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _body(client, payment, amount=3000, **changes):
    return {
        "amount_minor": amount, "refund_date": "2026-10-20", "description": "退回多买的灯具",
        "expected_version": _record(client, payment["id"])["version"],
        "request_id": str(uuid4()), **changes,
    }


def _refund(client, payment, amount=3000, **changes):
    response = client.post(
        f"/api/v1/records/{payment['id']}/refunds",
        json=_body(client, payment, amount, **changes),
    )
    assert response.status_code == 201, response.text
    return response.json()


def _counts(client):
    with Session(client.app.state.engine) as db:
        return tuple(db.scalar(select(func.count()).select_from(model))
                     for model in (Record, SourceEntry, AuditEntry))


def test_partial_multiple_and_full_refunds_preserve_payment_and_cashflow():
    client = _client()
    payment = _payment(client)
    first = _refund(client, payment, 3000)
    assert first["payment"]["refunded_minor"] == 3000
    assert first["payment"]["refundable_minor"] == 7000
    assert first["payment"]["refund_state"] == "partial"
    refund = first["refund"]
    assert refund["refund_of_record_id"] == payment["id"]
    assert (refund["ledger_kind"], refund["direction"], refund["status"]) == (
        "refund", "refund", "posted",
    )
    assert refund["occurred_date"] == refund["payment_date"] == "2026-10-20"
    assert refund["description"] == "退回多买的灯具"
    assert refund["vendor_id"] == payment["vendor_id"]
    assert refund["space_ids"] == payment["space_ids"]
    assert refund["stage_id"] == payment["stage_id"]
    assert len(refund["source_refs"]) == 1
    source = client.get(f"/api/v1/sources/{refund['source_refs'][0]['source_id']}").json()
    assert "退回多买的灯具" in source["original_text"]
    assert source["id"] != payment["source_refs"][0]["source_id"]
    second = _refund(client, payment, 7000, refund_date="2026-10-22", description=None)
    assert second["payment"]["refund_state"] == "full"
    assert second["payment"]["refundable_minor"] == 0
    current = _record(client, payment["id"])
    for field in ("amount_minor", "occurred_date", "payment_date", "description", "ledger_kind"):
        assert current[field] == payment[field]
    listing = client.get(f"/api/v1/records/{payment['id']}/refunds").json()
    assert {item["id"] for item in listing["items"]} == {refund["id"], second["refund"]["id"]}
    totals = client.get("/api/v1/ledger/summary").json()["totals"]
    assert totals == {"expense_minor": 10000, "refund_minor": 10000,
                      "income_minor": 0, "net_expense_minor": 0}


@pytest.mark.parametrize("changes", [
    {"amount_minor": 0}, {"amount_minor": -1}, {"amount_minor": 10001},
    {"refund_date": "invalid"}, {"refund_date": None}, {"request_id": "invalid"},
    {"description": "长" * 10001},
])
def test_invalid_refund_rolls_back_all_changes(changes):
    client = _client()
    payment = _payment(client)
    before, original = _counts(client), _record(client, payment["id"])
    response = client.post(f"/api/v1/records/{payment['id']}/refunds",
                           json=_body(client, payment, **changes))
    assert response.status_code in {400, 409, 422}, response.text
    assert _counts(client) == before
    assert _record(client, payment["id"]) == original


def test_refund_requires_authentication_and_existing_payment():
    client = _client()
    payment = _payment(client)
    body = _body(client, payment)
    assert client.post("/api/v1/records/missing/refunds", json=body).status_code == 404
    client.headers.clear()
    assert client.post(f"/api/v1/records/{payment['id']}/refunds", json=body).status_code == 401
    assert client.get(f"/api/v1/records/{payment['id']}/refunds").status_code == 401


@pytest.mark.parametrize("changes", [
    {"status": "planned"}, {"status": "voided"},
    {"ledger_kind": "income", "direction": "income", "status": "posted"},
    {"ledger_kind": "refund", "direction": "refund", "status": "posted"},
])
def test_only_completed_payment_accepts_refunds(changes):
    client = _client()
    payment = _payment(client, **changes)
    before = _counts(client)
    response = client.post(f"/api/v1/records/{payment['id']}/refunds",
                           json=_body(client, payment))
    assert response.status_code in {400, 409, 422}, response.text
    assert _counts(client) == before


def test_hidden_payment_rejects_refund():
    client = _client()
    payment = _payment(client)
    assert client.post(f"/api/v1/records/{payment['id']}/archive").status_code == 200
    before = _counts(client)
    response = client.post(f"/api/v1/records/{payment['id']}/refunds",
                           json=_body(client, payment))
    assert response.status_code in {400, 409, 422}, response.text
    assert _counts(client) == before


def test_refund_replay_is_idempotent_even_after_payment_version_changes():
    client = _client()
    payment = _payment(client)
    route = f"/api/v1/records/{payment['id']}/refunds"
    body = _body(client, payment)
    first = client.post(route, json=body)
    assert first.status_code == 201, first.text
    _refund(client, payment, 2000)
    before = _counts(client)
    replay = client.post(route, json=body)
    assert replay.status_code in {200, 201}, replay.text
    assert replay.json()["refund"]["id"] == first.json()["refund"]["id"]
    assert replay.json()["payment"]["refunded_minor"] == 5000
    assert _counts(client) == before
    mismatch = client.post(route, json={**body, "description": "同标识改内容"})
    assert mismatch.status_code == 409, mismatch.text
    assert _counts(client) == before


def test_stale_payment_version_cannot_create_second_refund():
    client = _client()
    payment = _payment(client)
    route = f"/api/v1/records/{payment['id']}/refunds"
    body = _body(client, payment, 6000)
    first = client.post(route, json=body)
    assert first.status_code == 201, first.text
    before = _counts(client)
    stale = client.post(route, json={**body, "request_id": str(uuid4())})
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "record_version_conflict"
    assert stale.json()["detail"]["latest_record"]["refundable_minor"] == 4000
    assert _counts(client) == before


def test_deleted_refund_request_cannot_recreate_the_transaction():
    client = _client()
    payment = _payment(client)
    route = f"/api/v1/records/{payment['id']}/refunds"
    body = _body(client, payment)
    created = client.post(route, json=body)
    assert created.status_code == 201, created.text
    refund = created.json()["refund"]
    assert client.delete(f"/api/v1/records/{refund['id']}").status_code == 204
    before = _counts(client)
    replay = client.post(route, json=body)
    assert replay.status_code == 409, replay.text
    assert replay.json()["detail"]["code"] == "refund_request_removed"
    assert replay.json()["detail"]["request_id"] == body["request_id"]
    assert _counts(client) == before
    assert _record(client, payment["id"])["refunded_minor"] == 0


def test_definitive_refund_rejection_identifies_rolled_back_request():
    client = _client()
    payment = _payment(client)
    _refund(client, payment, 7000)
    body = _body(client, payment, 4000)
    before, original = _counts(client), _record(client, payment["id"])
    rejected = client.post(f"/api/v1/records/{payment['id']}/refunds", json=body)
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["detail"]["code"] == "refund_not_saved"
    assert rejected.json()["detail"]["request_id"] == body["request_id"]
    assert _counts(client) == before
    assert _record(client, payment["id"]) == original


def test_voided_refund_still_protects_original_payment_and_link():
    client = _client()
    payment = _payment(client)
    refund = _refund(client, payment)["refund"]
    response = client.patch(f"/api/v1/records/{refund['id']}", json={
        "record_type": "ledger", "status": "voided",
    })
    assert response.status_code == 200, response.text
    assert _record(client, payment["id"])["refunded_minor"] == 0
    route = f"/api/v1/records/{payment['id']}"
    assert client.delete(route).status_code == 409
    assert client.post(route + "/archive").status_code == 409
    changed = client.patch(route, json={"record_type": "ledger", "status": "voided"})
    assert changed.status_code in {409, 422}, changed.text
    assert _record(client, refund["id"])["refund_of_record_id"] == payment["id"]


def test_concurrent_refunds_cannot_exceed_payment():
    client = _client()
    payment = _payment(client)
    body = _body(client, payment, 6000)
    barrier = Barrier(2)

    def submit(request_id):
        # 每个并发调用使用独立客户端，模拟两个设备持有同一付款版本。
        # 不再次启动共享应用的 lifespan，避免并发替换主测试的数据库引擎。
        separate = TestClient(client.app)
        try:
            separate.headers.update(client.headers)
            barrier.wait(timeout=10)
            return separate.post(f"/api/v1/records/{payment['id']}/refunds",
                                 json={**body, "request_id": request_id})
        finally:
            separate.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, [str(uuid4()), str(uuid4())]))
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert _record(client, payment["id"])["refunded_minor"] == 6000


def test_refund_edits_void_restore_delete_update_parent_version_and_balance():
    client = _client()
    payment = _payment(client)
    result = _refund(client, payment, 3000)
    refund, parent = result["refund"], result["payment"]
    route = f"/api/v1/records/{refund['id']}"
    changed = client.patch(route, json={"record_type": "ledger", "amount_minor": 4000,
                                       "occurred_date": "2026-10-21", "description": "修改备注"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["occurred_date"] == changed.json()["payment_date"] == "2026-10-21"
    current = _record(client, payment["id"])
    assert current["version"] > parent["version"]
    assert current["refunded_minor"] == 4000
    parent_version = current["version"]
    void = client.patch(route, json={"record_type": "ledger", "status": "voided"})
    assert void.status_code == 200, void.text
    current = _record(client, payment["id"])
    assert current["refunded_minor"] == 0 and current["refund_state"] == "none"
    assert current["version"] > parent_version
    _refund(client, payment, 7000)
    # 已作废退款恢复也要重新校验额度，不能绕过新增入口造成超退。
    before = _counts(client)
    blocked = client.patch(route, json={"record_type": "ledger", "status": "posted"})
    assert blocked.status_code in {400, 409, 422}, blocked.text
    assert _counts(client) == before
    assert _record(client, refund["id"])["status"] == "voided"
    restored = client.patch(route, json={"record_type": "ledger", "status": "posted",
                                        "amount_minor": 3000})
    assert restored.status_code == 200, restored.text
    assert _record(client, payment["id"])["refund_state"] == "full"
    before_delete = _record(client, payment["id"])["version"]
    assert client.delete(route).status_code == 204
    current = _record(client, payment["id"])
    assert current["refunded_minor"] == 7000
    assert current["version"] > before_delete
    # 删除流水不删除录入证据和审计。
    with Session(client.app.state.engine) as db:
        assert db.get(SourceEntry, refund["source_refs"][0]["source_id"]) is not None
        assert db.scalar(select(func.count()).select_from(AuditEntry).where(
            AuditEntry.target_id == refund["id"], AuditEntry.action == "delete",
        )) == 1


@pytest.mark.parametrize("changes", [
    {"ledger_kind": "income", "direction": "income", "status": "posted"},
    {"direction": "expense"}, {"status": "planned"},
    {"amount_minor": 10001}, {"refund_of_record_id": "missing"},
])
def test_generic_refund_update_cannot_bypass_business_rules(changes):
    client = _client()
    payment = _payment(client)
    refund = _refund(client, payment)["refund"]
    route = f"/api/v1/records/{refund['id']}"
    original, before = _record(client, refund["id"]), _counts(client)
    response = client.patch(route, json={"record_type": "ledger", **changes})
    assert response.status_code in {400, 409, 422}, response.text
    assert _record(client, refund["id"]) == original
    assert _counts(client) == before


def test_linked_refund_cannot_change_vendor_or_be_hidden():
    client = _client()
    payment = _payment(client)
    refund = _refund(client, payment)["refund"]
    vendor = client.post("/api/v1/vendors", json={"name": "另一商家"}).json()
    route = f"/api/v1/records/{refund['id']}"
    changed = client.patch(route, json={"record_type": "ledger", "vendor_id": vendor["id"]})
    assert changed.status_code in {400, 409, 422}
    assert client.post(route + "/archive").status_code in {400, 409, 422}
    assert _record(client, refund["id"])["archived_at"] is None


@pytest.mark.parametrize("changes", [
    {"ledger_kind": "refund", "direction": "refund", "status": "posted"},
    {"status": "planned"}, {"status": "voided"}, {"amount_minor": 2999},
])
def test_payment_with_refunds_rejects_invalid_updates(changes):
    client = _client()
    payment = _payment(client)
    _refund(client, payment)
    route = f"/api/v1/records/{payment['id']}"
    original, before = _record(client, payment["id"]), _counts(client)
    response = client.patch(route, json={"record_type": "ledger", **changes})
    assert response.status_code in {400, 409, 422}, response.text
    assert _record(client, payment["id"]) == original
    assert _counts(client) == before


def test_payment_delete_hide_and_generic_association_edit_preserve_refund_link():
    client = _client()
    payment = _payment(client)
    refund = _refund(client, payment)["refund"]
    route = f"/api/v1/records/{payment['id']}"
    assert client.delete(route).status_code in {400, 409, 422}
    assert client.post(route + "/archive").status_code in {400, 409, 422}
    edited = client.patch(route, json={"record_type": "ledger", "related_record_ids": []})
    assert edited.status_code == 200, edited.text
    edited = client.patch(f"/api/v1/records/{refund['id']}", json={
        "record_type": "ledger", "related_record_ids": [],
    })
    assert edited.status_code == 200, edited.text
    assert _record(client, refund["id"])["refund_of_record_id"] == payment["id"]
    assert _record(client, payment["id"])["refunded_minor"] == 3000


def test_historical_payment_requires_new_refund_context_without_changing_parent():
    client = _client()
    payment = _payment(client)
    clear_historical_context(client, payment["id"])
    route = f"/api/v1/records/{payment['id']}/refunds"
    before = _counts(client)
    missing = client.post(route, json=_body(client, payment))
    assert missing.status_code == 422, missing.text
    assert _counts(client) == before
    invalid = client.post(route, json=_body(client, payment, space_ids=["missing"],
                                           stage_id=record_context(client)["stage_id"]))
    assert invalid.status_code in {400, 422}, invalid.text
    assert _counts(client) == before
    assert _record(client, payment["id"])["version"] == payment["version"]
    completed = _refund(client, payment, **record_context(client))
    assert completed["refund"]["space_ids"] == record_context(client)["space_ids"]
    assert completed["refund"]["stage_id"] == record_context(client)["stage_id"]
    assert completed["payment"]["space_ids"] == []
    assert completed["payment"]["stage_id"] is None


def test_refund_inherits_context_and_active_topics_but_not_archived_topics():
    client = _client()
    active = client.post("/api/v1/topics", json={"name": "厨房灯具"}).json()
    archived = client.post("/api/v1/topics", json={"name": "已结束的采购"}).json()
    material = client.post("/api/v1/materials", json={"name": "灯具"}).json()
    participant = client.post("/api/v1/participants", json={"name": "灯具商家"}).json()
    payment = _payment(client, topic_ids=[active["id"], archived["id"]],
                       material_ids=[material["id"]], participant_ids=[participant["id"]])
    changed = client.patch(f"/api/v1/topics/{archived['id']}", json={"status": "archived"})
    assert changed.status_code == 200
    listing = client.get(f"/api/v1/records/{payment['id']}/refunds").json()
    assert listing["excluded_topic_names"] == ["已结束的采购"]
    refund = _refund(client, payment)["refund"]
    assert refund["topic_ids"] == [active["id"]]
    assert refund["material_ids"] == [material["id"]]
    assert refund["participant_ids"] == [participant["id"]]
    assert _record(client, payment["id"])["topic_ids"] == sorted([active["id"], archived["id"]])
    topic_detail = client.get(f"/api/v1/topics/{active['id']}").json()
    assert {item["id"] for item in topic_detail["records"]} == {payment["id"], refund["id"]}


def test_refund_cashflow_month_vendor_space_and_detail_scope_agree():
    client = _client()
    payment = _payment(client)
    refund = _refund(client, payment, 3000)["refund"]
    summary = client.get("/api/v1/ledger/summary").json()
    assert {row["id"] for row in summary["ledger_entries"]} == {payment["id"], refund["id"]}
    assert summary["totals"]["net_expense_minor"] == 7000
    months = {item["key"]: item for item in summary["analytics"]["money_trend"]}
    assert months["2026-09"]["expense_minor"] == 10000
    assert months["2026-09"]["refund_minor"] == 0
    assert months["2026-10"]["expense_minor"] == 0
    assert months["2026-10"]["refund_minor"] == 3000
    assert summary["analytics"]["vendor_distribution"][0]["value"] == 7000
    filtered = client.get("/api/v1/ledger/summary", params={
        "space_id": payment["space_ids"][0], "vendor_id": payment["vendor_id"],
        "date_from": "2026-10-01", "date_to": "2026-10-31",
    }).json()
    assert [row["id"] for row in filtered["ledger_entries"]] == [refund["id"]]
    assert filtered["totals"]["net_expense_minor"] == -3000
    archive = client.get(f"/api/v1/spaces/{payment['space_ids'][0]}/archive").json()
    for key, value in summary["totals"].items():
        assert archive["analytics"][key] == value


def test_standalone_old_refunds_remain_unlinked_and_do_not_consume_payment_limit():
    client = _client()
    payment = _payment(client)
    result = client.post("/api/v1/records/direct", json=creation_payload(client, {
        "record_type": "ledger", "title": "过去手工登记退款", "status": "posted",
        "ledger_kind": "refund", "direction": "refund", "payment_kind": "refund",
        "vendor_id": payment["vendor_id"], "amount_minor": 2000,
    }))
    assert result.status_code == 201, result.text
    assert result.json().get("refund_of_record_id") is None
    assert _record(client, payment["id"])["refundable_minor"] == 10000
    listing = client.get(f"/api/v1/records/{payment['id']}/refunds").json()
    assert listing["items"] == []


def test_refund_source_snapshot_and_audit_contain_original_creation_facts():
    client = _client()
    payment = _payment(client)
    refund = _refund(client, payment)["refund"]
    with Session(client.app.state.engine) as db:
        source_id = refund["source_refs"][0]["source_id"]
        source = db.get(SourceEntry, source_id)
        assert source is not None
        snapshot = json.loads(source.original_text.split("\n录入字段：\n", 1)[1])
        assert snapshot["amount_minor"] == 3000
        assert snapshot["ledger_kind"] == "refund"
        assert snapshot["description"] == "退回多买的灯具"
        assert db.get(LedgerDetail, refund["id"]).refund_of_record_id == payment["id"]
        targets = set(db.scalars(select(AuditEntry.target_id).where(
            AuditEntry.target_id.in_([source_id, refund["id"]]),
            AuditEntry.action == "create",
        )).all())
        assert targets == {source_id, refund["id"]}


def test_source_delete_cannot_remove_original_payment_with_linked_refunds():
    client = _client()
    payment = _payment(client)
    refund = _refund(client, payment)["refund"]
    source_id = payment["source_refs"][0]["source_id"]
    before, original = _counts(client), _record(client, payment["id"])
    blocked = client.delete(f"/api/v1/sources/{source_id}")
    assert blocked.status_code == 409, blocked.text
    assert _counts(client) == before
    assert _record(client, payment["id"]) == original
    assert _record(client, refund["id"])["refund_of_record_id"] == payment["id"]
    assert client.get(f"/api/v1/sources/{source_id}").status_code == 200


def test_deleting_refund_exclusive_source_releases_balance_and_bumps_parent():
    client = _client()
    payment = _payment(client)
    result = _refund(client, payment)
    refund, before_parent = result["refund"], result["payment"]
    source_id = refund["source_refs"][0]["source_id"]
    deleted = client.delete(f"/api/v1/sources/{source_id}")
    assert deleted.status_code == 200, deleted.text
    assert client.get(f"/api/v1/records/{refund['id']}").status_code == 404
    parent = _record(client, payment["id"])
    assert parent["version"] > before_parent["version"]
    assert parent["refunded_minor"] == 0
    assert parent["refundable_minor"] == payment["amount_minor"]
    assert parent["refund_state"] == "none"
