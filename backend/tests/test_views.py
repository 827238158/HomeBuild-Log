from __future__ import annotations

import json
import uuid
from datetime import date
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
    if payload["record_type"] == "ledger" and not payload.get("vendor_id"):
        vendor = client.post(
            "/api/v1/vendors", json={"name": f"交易对象-{payload['title']}"}
        ).json()
        payload = {**payload, "vendor_id": vendor["id"]}
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
            "record_type": "issue",
            "title": "等待验收",
            "status": "pending",
            "phenomenon": "到货后验收",
            "severity": "low",
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


def test_ledger_summary_uses_direction_specific_completed_statuses() -> None:
    client = _client()
    source_id = _source(client, "付款500元，退款100元，收入50元。")
    for title, kind, status, direction, amount in [
        ("付款", "payment", "paid", "expense", 50000),
        ("退款", "refund", "posted", "refund", 10000),
        ("收入", "income", "posted", "income", 5000),
    ]:
        _record(client, source_id, {
            "record_type": "ledger", "ledger_kind": kind, "title": title,
            "status": status, "direction": direction, "payment_kind": "other",
            "amount_minor": amount,
        })

    data = client.get("/api/v1/ledger/summary").json()
    totals = data["totals"]
    assert totals["expense_minor"] == 50000
    assert totals["refund_minor"] == 10000
    assert totals["income_minor"] == 5000
    assert totals["net_expense_minor"] == 35000
    composition = {item["key"]: item["value"] for item in data["analytics"]["payment_composition"]}
    assert composition == {"expense": 50000, "refund": 10000, "income": 5000}


def test_records_only_accept_renminbi() -> None:
    client = _client()
    source_id = _source(client, "支付材料款100元。")
    response = client.post(
        "/api/v1/records",
        json={
            "record_type": "ledger",
            "title": "材料款",
            "status": "paid",
            "source_refs": [{"source_id": source_id}],
            "direction": "expense",
            "payment_kind": "full",
            "amount_minor": 10000,
            "currency": "USD",
        },
    )
    assert response.status_code == 422


def test_overview_risk_window_and_record_analytics(monkeypatch) -> None:
    from app.api import analytics as analytics_api

    monkeypatch.setattr(analytics_api, "_today", lambda: date(2026, 7, 1))
    client = _client()
    source_id = _source(client, "问题和送货风险。")
    _record(
        client,
        source_id,
        {
            "record_type": "issue",
            "title": "待处理问题",
            "status": "pending",
            "phenomenon": "复核现场",
            "severity": "medium",
        },
    )
    _record(
        client,
        source_id,
        {
            "record_type": "issue",
            "title": "另一个问题",
            "status": "pending",
            "phenomenon": "验收",
            "severity": "low",
        },
    )

    overview = client.get("/api/v1/overview").json()
    assert overview["summary"]["overdue_count"] == 0
    assert overview["summary"]["upcoming_count"] == 0
    assert overview["summary"]["open_issue_count"] == 2

    records = client.get("/api/v1/records/analytics?record_type=issue").json()
    assert records["summary"]["total"] == 2
    assert records["specific"]["dimension"] == "severity"


def test_ai_analytics_is_request_scoped_and_hides_raw_content() -> None:
    client = _client()
    source_id = _source(client, "今天现场查看。")
    created = client.post(f"/api/v1/sources/{source_id}/extractions?engine=local")
    assert created.status_code == 201, created.text

    overview = client.get("/api/v1/ai-analytics/overview?range=all").json()
    assert overview["summary"]["request_count"] == 1
    assert overview["summary"]["success_rate"] == 1
    runs = client.get("/api/v1/ai-analytics/runs?range=all").json()
    assert runs["total"] == 1
    serialized = json.dumps(runs, ensure_ascii=False)
    assert "prompt_text" not in serialized
    assert "raw_response" not in serialized
    assert "api_key" not in serialized


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
            "status": "pending",
            "space_ids": [room["id"]],
            "phenomenon": "主卧门口地砖小破裂",
            "handling_plan": "门套遮挡",
            "severity": "medium",
        },
    )
    follow_up = _record(
        client,
        source_id,
        {
            "record_type": "issue",
            "title": "复核遮挡效果",
            "status": "pending",
            "space_ids": [room["id"]],
            "phenomenon": "门套完成后复核",
            "severity": "low",
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
            "values": [{"axis": "width", "value": 900, "unit": "mm"}],
        },
    )
    client.post(
        "/api/v1/record-relations",
        json={
            "from_record_id": follow_up["id"],
            "to_record_id": issue["id"],
            "relation_type": "implements",
        },
    )

    board = client.get("/api/v1/issues/board").json()
    pending = next(column for column in board["columns"] if column["status"] == "pending")
    assert {item["id"] for item in pending["items"]} == {issue["id"], follow_up["id"]}
    archive = client.get(f"/api/v1/spaces/{house['id']}/archive").json()
    assert archive["summary"]["record_count"] == 3
    assert archive["summary"]["unclosed_issue_count"] == 2
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
                {"axis": "width", "value": 600, "unit": "mm"},
                {"axis": "height", "value": 1200, "unit": "mm"},
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
