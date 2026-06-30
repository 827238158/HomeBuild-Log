from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import SecretsConfig, _hash_password
from app.core.paths import build_storage_paths, ensure_storage_directories
from app.db import Base, create_database_engine
from app.main import create_app


def _client() -> TestClient:
    root = Path(__file__).parent / ".runtime" / uuid.uuid4().hex
    root.mkdir(parents=True)
    paths = build_storage_paths(root)
    paths.config.mkdir(parents=True, exist_ok=True)
    (paths.config / "secrets.json").write_text(
        json.dumps(
            {
                "admin_password_hash": _hash_password("test-password"),
                "jwt_secret": bytes(50).hex(),
            }
        ),
        encoding="utf-8",
    )
    app = create_app(storage_paths=paths, secrets=SecretsConfig(paths.config))
    ensure_storage_directories(paths)
    engine = create_database_engine(paths.database_file)
    Base.metadata.create_all(engine)
    engine.dispose()
    client = TestClient(app)
    with client:
        pass
    token = client.post("/api/v1/auth/login", json={"password": "test-password"}).json()[
        "access_token"
    ]
    client.headers = {"Authorization": f"Bearer {token}"}
    return client


def _source(client: TestClient, text: str) -> str:
    response = client.post("/api/v1/sources", json={"original_text": text})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _record(client: TestClient, source_id: str, payload: dict) -> dict:
    response = client.post(
        "/api/v1/records",
        json={
            "title": payload["title"],
            "record_type": payload["record_type"],
            "status": payload["status"],
            "source_refs": [{"source_id": source_id, "evidence_excerpt": "原文依据"}],
            **payload,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_timeline_preserves_unknown_time_and_groups_related_records() -> None:
    client = _client()
    source_id = _source(client, "6月27日选定花砖，稍后验收。")
    event = _record(
        client,
        source_id,
        {
            "record_type": "event",
            "title": "选购花砖",
            "status": "occurred",
            "occurred_date": "2026-06-28",
            "event_kind": "shopping",
        },
    )
    decision = _record(
        client,
        source_id,
        {
            "record_type": "decision",
            "title": "确认花色",
            "status": "confirmed",
            "topic": "花色",
            "selected_option": "中灰",
        },
    )
    _record(
        client,
        source_id,
        {
            "record_type": "todo",
            "title": "等待验收",
            "status": "pending",
            "action": "到货后验收",
        },
    )
    client.post(
        "/api/v1/record-relations",
        json={
            "from_record_id": event["id"],
            "to_record_id": decision["id"],
            "relation_type": "produces",
        },
    )

    response = client.get("/api/v1/timeline")
    assert response.status_code == 200, response.text
    data = response.json()
    assert [group["date_key"] for group in data["groups"]] == ["2026-06-28", "unknown"]
    assert data["groups"][0]["label"] == "2026年6月28日"
    assert data["groups"][0]["items"][0]["related_records"][0]["id"] == decision["id"]
    assert data["groups"][1]["label"] == "时间待补充"
    assert client.get("/api/v1/timeline?date_from=2026-07-01").json()["total"] == 0


def test_ledger_summary_keeps_order_and_cash_flow_semantics_separate() -> None:
    client = _client()
    source_id = _source(client, "花砖1100元，已付500元。")
    procurement = _record(
        client,
        source_id,
        {
            "record_type": "procurement",
            "title": "采购花砖",
            "status": "ordered",
            "item_name": "花砖",
            "order_total_minor": 110000,
        },
    )
    ledger = _record(
        client,
        source_id,
        {
            "record_type": "ledger",
            "title": "花砖预付款",
            "status": "posted",
            "direction": "expense",
            "payment_kind": "deposit",
            "amount_minor": 50000,
        },
    )
    client.post(
        "/api/v1/record-relations",
        json={
            "from_record_id": ledger["id"],
            "to_record_id": procurement["id"],
            "relation_type": "pays_for",
        },
    )

    data = client.get("/api/v1/ledger/summary").json()
    totals = data["totals_by_currency"][0]
    assert totals["procurement_total_minor"] == 110000
    assert totals["expense_minor"] == 50000
    assert totals["net_paid_minor"] == 50000
    assert totals["outstanding_minor"] == 60000
    assert data["procurements"][0]["calculation_record_ids"] == [ledger["id"]]


def test_issue_board_and_space_archive_project_shared_records() -> None:
    client = _client()
    source_id = _source(client, "主卧门口地砖破裂，门套完成后复核。")
    house = client.post("/api/v1/spaces", json={"name": "房屋", "kind": "house"}).json()
    room = client.post(
        "/api/v1/spaces",
        json={"name": "主卧", "kind": "room", "parent_id": house["id"]},
    ).json()
    issue = _record(
        client,
        source_id,
        {
            "record_type": "issue",
            "title": "地砖破裂",
            "status": "waiting",
            "space_ids": [room["id"]],
            "phenomenon": "主卧门口地砖小破裂",
            "handling_plan": "门套遮挡",
        },
    )
    todo = _record(
        client,
        source_id,
        {
            "record_type": "todo",
            "title": "复核遮挡效果",
            "status": "waiting",
            "space_ids": [room["id"]],
            "action": "门套完成后复核",
        },
    )
    _record(
        client,
        source_id,
        {
            "record_type": "measurement",
            "title": "门洞宽度",
            "status": "active",
            "space_ids": [room["id"]],
            "object_name": "门洞",
            "measurement_role": "site_measurement",
            "values": [{"axis": "width", "value": 90, "unit": "cm"}],
        },
    )
    client.post(
        "/api/v1/record-relations",
        json={
            "from_record_id": todo["id"],
            "to_record_id": issue["id"],
            "relation_type": "implements",
        },
    )

    board = client.get("/api/v1/issues/board").json()
    waiting = next(column for column in board["columns"] if column["status"] == "waiting")
    assert waiting["items"][0]["next_todos"][0]["id"] == todo["id"]
    archive = client.get(f"/api/v1/spaces/{house['id']}/archive").json()
    assert archive["summary"]["record_count"] == 3
    assert archive["summary"]["unclosed_issue_count"] == 1
    assert archive["summary"]["measurement_count"] == 1
    assert room["id"] in archive["descendant_ids"]


def test_search_details_and_audit_target_filter_are_traceable() -> None:
    client = _client()
    source_id = _source(client, "卫生间使用60乘120厘米花砖。")
    material = client.post("/api/v1/materials", json={"name": "花砖", "brand": "测试"}).json()
    record = _record(
        client,
        source_id,
        {
            "record_type": "measurement",
            "title": "花砖规格",
            "status": "active",
            "material_ids": [material["id"]],
            "object_name": "花砖",
            "measurement_role": "material_spec",
            "values": [
                {"axis": "width", "value": 60, "unit": "cm"},
                {"axis": "height", "value": 120, "unit": "cm"},
            ],
        },
    )
    upload = client.post(
        f"/api/v1/attachments?source_id={source_id}",
        files={"file": ("现场.png", b"image-bytes", "image/png")},
    )
    assert upload.status_code == 201, upload.text

    search = client.get("/api/v1/search?q=花砖")
    assert search.status_code == 200, search.text
    data = search.json()
    assert data["counts"]["records"] == 1
    assert data["counts"]["sources"] == 1
    assert data["counts"]["materials"] == 1
    assert client.get("/api/v1/search").status_code == 400

    source_detail = client.get(f"/api/v1/sources/{source_id}").json()
    assert source_detail["attachments"][0]["original_filename"] == "现场.png"
    audit = client.get(f"/api/v1/audit?target_table=records&target_id={record['id']}").json()
    assert audit and all(item["target_id"] == record["id"] for item in audit)
