from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import SecretsConfig, _hash_password
from app.core.paths import build_storage_paths, ensure_storage_directories
from app.db import Base, create_database_engine
from app.local_suggestions import suggest_from_text
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


def _source(client: TestClient, text: str = "真实装修来源") -> str:
    response = client.post("/api/v1/sources", json={"original_text": text})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _common(source_id: str, record_type: str, status: str) -> dict:
    return {
        "record_type": record_type,
        "title": f"{record_type} 测试",
        "status": status,
        "source_refs": [{"source_id": source_id, "evidence_excerpt": "原文依据"}],
    }


RECORD_CASES = [
    ("event", "occurred", {"event_kind": "site_visit"}),
    (
        "ledger",
        "paid",
        {
            "ledger_kind": "payment",
            "direction": "expense",
            "payment_kind": "deposit",
            "amount_minor": 50000,
        },
    ),
    ("issue", "pending", {"phenomenon": "主卧门口地砖小破裂", "severity": "medium"}),
    (
        "measurement",
        "active",
        {
            "object_name": "花砖",
            "measurement_role": "material_spec",
            "values": [
                {"axis": "width", "value": "600", "unit": "mm"},
                {"axis": "height", "value": "1200", "unit": "mm"},
            ],
        },
    ),
    (
        "decision",
        "confirmed",
        {"topic": "是否返工", "options": ["返工", "门套遮挡"], "selected_option": "门套遮挡"},
    ),
    (
        "research",
        "comparing",
        {"question": "选择哪种瓷砖", "options": ["浅灰", "中灰"]},
    ),
]


@pytest.mark.parametrize(("record_type", "record_status", "detail"), RECORD_CASES)
def test_create_all_six_record_types_and_ledger_subtypes(
    record_type: str, record_status: str, detail: dict
) -> None:
    client = _client()
    source_id = _source(client)
    payload = {**_common(source_id, record_type, record_status), **detail}
    if record_type == "ledger":
        vendor = client.post("/api/v1/vendors", json={"name": "交易对象"}).json()
        payload["vendor_id"] = vendor["id"]
    response = client.post("/api/v1/records", json=payload)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["record_type"] == record_type
    assert data["source_refs"][0]["source_id"] == source_id
    if record_type == "measurement":
        assert [item["value"] for item in data["values"]] == [600.0, 1200.0]


def test_issue_completed_date_follows_done_status() -> None:
    client = _client()
    source_id = _source(client)

    invalid = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "issue", "pending"),
            "phenomenon": "等待验收",
            "severity": "medium",
            "completed_at": "2026-07-01",
        },
    )
    assert invalid.status_code == 422

    created = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "issue", "pending"),
            "phenomenon": "等待验收",
            "severity": "medium",
        },
    )
    assert created.status_code == 201, created.text
    record_id = created.json()["id"]

    completed = client.patch(
        f"/api/v1/records/{record_id}",
        json={"record_type": "issue", "status": "done", "actual_result": "已经验收"},
    )
    assert completed.status_code == 200, completed.text
    assert len(completed.json()["completed_at"]) == 10

    reopened = client.patch(
        f"/api/v1/records/{record_id}",
        json={"record_type": "issue", "status": "in_progress"},
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["completed_at"] is None

    done_on_create = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "issue", "done"),
            "phenomenon": "等待验收",
            "severity": "low",
            "actual_result": "已经验收",
        },
    )
    assert done_on_create.status_code == 201, done_on_create.text
    assert len(done_on_create.json()["completed_at"]) == 10


def test_project_space_shared_entities_and_source_listing() -> None:
    client = _client()
    source_id = _source(client, "空间关联来源")
    project = client.get("/api/v1/projects/current")
    assert project.status_code == 200
    assert project.json()["name"] == "我的装修"
    assert (
        client.patch("/api/v1/projects/current", json={"name": "自住房装修"}).json()["name"]
        == "自住房装修"
    )

    house = client.post("/api/v1/spaces", json={"name": "房屋", "kind": "house"}).json()
    room_response = client.post(
        "/api/v1/spaces",
        json={"name": "主卧", "kind": "room", "parent_id": house["id"]},
    )
    assert room_response.status_code == 201
    room = room_response.json()
    assert (
        client.patch(f"/api/v1/spaces/{house['id']}", json={"parent_id": room["id"]}).status_code
        == 400
    )
    material = client.post("/api/v1/materials", json={"name": "花砖", "brand": "测试品牌"})
    assert material.status_code == 201, material.text
    assert client.get("/api/v1/materials").json()[0]["name"] == "花砖"
    sources = client.get("/api/v1/sources").json()
    assert sources[0]["id"] == source_id

    record = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "event", "occurred"),
            "event_kind": "site_visit",
            "space_ids": [room["id"]],
            "material_ids": [material.json()["id"]],
        },
    )
    assert record.status_code == 201, record.text
    assert record.json()["space_ids"] == [room["id"]]


def test_delete_unused_spaces_and_shared_entities_with_audit() -> None:
    client = _client()
    created = [
        ("spaces", client.post("/api/v1/spaces", json={"name": "临时空间", "kind": "room"}).json()),
        ("materials", client.post("/api/v1/materials", json={"name": "临时材料"}).json()),
        ("vendors", client.post("/api/v1/vendors", json={"name": "临时商家"}).json()),
        ("participants", client.post("/api/v1/participants", json={"name": "临时人员"}).json()),
        ("stages", client.post("/api/v1/stages", json={"name": "临时阶段"}).json()),
    ]

    for endpoint, item in created:
        response = client.delete(f"/api/v1/{endpoint}/{item['id']}")
        assert response.status_code == 204, response.text
        assert client.delete(f"/api/v1/{endpoint}/{item['id']}").status_code == 404

    audits = client.get("/api/v1/audit?action=delete&limit=20").json()
    assert {item["target_id"] for item in audits}.issuperset({item["id"] for _, item in created})


def test_delete_rejects_the_last_root_house() -> None:
    client = _client()
    first = client.post("/api/v1/spaces", json={"name": "整套房屋", "kind": "house"}).json()

    conflict = client.delete(f"/api/v1/spaces/{first['id']}")
    assert conflict.status_code == 409
    assert "根房屋" in conflict.json()["detail"]

    second = client.post("/api/v1/spaces", json={"name": "另一套房屋", "kind": "house"}).json()
    assert client.delete(f"/api/v1/spaces/{first['id']}").status_code == 204
    assert client.get("/api/v1/spaces").json()[0]["id"] == second["id"]


def test_delete_rejects_child_spaces_and_referenced_shared_entities() -> None:
    client = _client()
    source_id = _source(client, "引用删除保护")
    house = client.post("/api/v1/spaces", json={"name": "房屋", "kind": "house"}).json()
    room = client.post(
        "/api/v1/spaces",
        json={"name": "主卧", "kind": "room", "parent_id": house["id"]},
    ).json()
    material = client.post("/api/v1/materials", json={"name": "地砖"}).json()
    participant = client.post("/api/v1/participants", json={"name": "张师傅"}).json()
    stage = client.post("/api/v1/stages", json={"name": "泥瓦阶段"}).json()
    vendor = client.post("/api/v1/vendors", json={"name": "瓷砖店"}).json()
    procurement_vendor = client.post("/api/v1/vendors", json={"name": "建材店"}).json()

    event = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "event", "occurred"),
            "event_kind": "construction",
            "space_ids": [room["id"]],
            "material_ids": [material["id"]],
            "participant_ids": [participant["id"]],
            "stage_id": stage["id"],
        },
    )
    assert event.status_code == 201, event.text
    ledger = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "ledger", "paid"),
            "ledger_kind": "payment",
            "direction": "expense",
            "payment_kind": "deposit",
            "amount_minor": 10000,
            "vendor_id": vendor["id"],
        },
    )
    assert ledger.status_code == 201, ledger.text
    income = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "ledger", "posted"),
            "ledger_kind": "income",
            "direction": "income",
            "payment_kind": "reimbursement",
            "amount_minor": 5000,
            "vendor_id": procurement_vendor["id"],
        },
    )
    assert income.status_code == 201, income.text

    child_conflict = client.delete(f"/api/v1/spaces/{house['id']}")
    assert child_conflict.status_code == 409
    assert "下级空间" in child_conflict.json()["detail"]

    referenced = [
        ("spaces", room["id"]),
        ("materials", material["id"]),
        ("participants", participant["id"]),
        ("stages", stage["id"]),
        ("vendors", vendor["id"]),
        ("vendors", procurement_vendor["id"]),
    ]
    for endpoint, item_id in referenced:
        response = client.delete(f"/api/v1/{endpoint}/{item_id}")
        assert response.status_code == 409, response.text
        assert "正式记录" in response.json()["detail"]


def test_update_archive_restore_relation_and_audit() -> None:
    client = _client()
    source_id = _source(client)
    first = client.post(
        "/api/v1/records",
        json={**_common(source_id, "event", "occurred"), "event_kind": "construction"},
    ).json()
    second = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "issue", "pending"),
            "phenomenon": "现场复核",
            "severity": "low",
        },
    ).json()

    updated = client.patch(
        f"/api/v1/records/{first['id']}",
        json={"record_type": "event", "title": "已更新事件", "status": "completed"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["title"] == "已更新事件"
    assert (
        client.patch(
            f"/api/v1/records/{first['id']}",
            json={"record_type": "issue", "title": "非法换型"},
        ).status_code
        == 409
    )

    archived = client.post(f"/api/v1/records/{first['id']}/archive")
    assert archived.json()["archived_at"] is not None
    assert client.post(f"/api/v1/records/{first['id']}/restore").json()["archived_at"] is None

    relation = client.post(
        "/api/v1/record-relations",
        json={
            "from_record_id": second["id"],
            "to_record_id": first["id"],
            "relation_type": "implements",
        },
    )
    assert relation.status_code == 201, relation.text
    assert (
        client.post(
            "/api/v1/record-relations",
            json={
                "from_record_id": first["id"],
                "to_record_id": first["id"],
                "relation_type": "relates_to",
            },
        ).status_code
        == 409
    )
    assert client.delete(f"/api/v1/record-relations/{relation.json()['id']}").status_code == 204
    actions = [entry["action"] for entry in client.get("/api/v1/audit?target_table=records").json()]
    assert {"create", "update", "archive", "restore"}.issubset(actions)


def test_issue_completion_date_follows_status_transitions() -> None:
    client = _client()
    source_id = _source(client)
    issue = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "issue", "pending"),
            "phenomenon": "墙面渗水",
            "severity": "high",
        },
    ).json()
    assert issue["completed_at"] is None

    resolved = client.patch(
        f"/api/v1/records/{issue['id']}",
        json={"record_type": "issue", "status": "done", "actual_result": "已修复并复核"},
    )
    assert resolved.status_code == 200, resolved.text
    assert len(resolved.json()["completed_at"]) == 10

    reopened = client.patch(
        f"/api/v1/records/{issue['id']}",
        json={"record_type": "issue", "status": "in_progress"},
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["completed_at"] is None


@pytest.mark.parametrize(
    ("record_type", "record_status", "detail", "update_payload", "field", "expected"),
    [
        (
            "event",
            "occurred",
            {"event_kind": "site_visit"},
            {"result": "已复核"},
            "result",
            "已复核",
        ),
        (
            "ledger",
            "paid",
            {
                "ledger_kind": "payment",
                "direction": "expense",
                "payment_kind": "deposit",
                "amount_minor": 50000,
            },
            {"amount_minor": 60000},
            "amount_minor",
            60000,
        ),
        (
            "issue",
            "pending",
            {"phenomenon": "破裂", "severity": "low"},
            {"handling_plan": "门套遮挡"},
            "handling_plan",
            "门套遮挡",
        ),
        (
            "measurement",
            "active",
            {
                "object_name": "门洞",
                "measurement_role": "site_measurement",
                "values": [{"axis": "width", "value": 900, "unit": "mm"}],
            },
            {"values": [{"axis": "width", "value": 920, "unit": "mm"}]},
            "values",
            [{"axis": "width", "value": 920.0, "unit": "mm"}],
        ),
        (
            "decision",
            "confirmed",
            {"topic": "铺贴", "options": ["横贴", "竖贴"]},
            {"selected_option": "竖贴"},
            "selected_option",
            "竖贴",
        ),
        (
            "research",
            "collecting",
            {"question": "选哪种砖"},
            {"conclusion": "选柔光砖"},
            "conclusion",
            "选柔光砖",
        ),
    ],
)
def test_update_detail_fields_for_all_record_types(
    record_type: str,
    record_status: str,
    detail: dict,
    update_payload: dict,
    field: str,
    expected: object,
) -> None:
    client = _client()
    source_id = _source(client)
    record = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, record_type, record_status),
            **detail,
            **(
                {
                    "vendor_id": client.post("/api/v1/vendors", json={"name": "交易对象"}).json()[
                        "id"
                    ]
                }
                if record_type == "ledger"
                else {}
            ),
        },
    ).json()
    response = client.patch(
        f"/api/v1/records/{record['id']}",
        json={
            "record_type": record_type,
            "occurred_date": "2026-06-28",
            **update_payload,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()[field] == expected
    assert response.json()["occurred_date"] == "2026-06-28"


def test_record_requires_source_and_rejects_invalid_measurement() -> None:
    client = _client()
    without_source = client.post(
        "/api/v1/records",
        json={
            "record_type": "issue",
            "title": "无来源",
            "status": "pending",
            "source_refs": [],
            "phenomenon": "不应创建",
            "severity": "low",
        },
    )
    assert without_source.status_code == 422
    source_id = _source(client)
    invalid_value = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "measurement", "active"),
            "object_name": "门洞",
            "measurement_role": "site_measurement",
            "values": [{"axis": "width", "value": 0, "unit": "mm"}],
        },
    )
    assert invalid_value.status_code == 422
    invalid_month = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "event", "occurred"),
            "event_kind": "site_visit",
            "occurred_date": "2026-02-30",
        },
    )
    assert invalid_month.status_code == 422


def test_delete_record_keeps_source_and_releases_persisted_candidate() -> None:
    client = _client()
    source_id = _source(client, "今天去现场查看。")
    bundle = client.post(f"/api/v1/sources/{source_id}/extractions?engine=local").json()
    candidate = bundle["suggestions"][0]
    confirmed = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json={
            "expected_version": bundle["version"],
            "selections": [{"key": candidate["key"], "payload": candidate["payload"]}],
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    record = confirmed.json()["records"][0]["record"]
    other = client.post(
        "/api/v1/records",
        json={
            **_common(source_id, "issue", "pending"),
            "phenomenon": "后续复核",
            "severity": "low",
        },
    ).json()
    relation = client.post(
        "/api/v1/record-relations",
        json={
            "from_record_id": other["id"],
            "to_record_id": record["id"],
            "relation_type": "relates_to",
        },
    )
    assert relation.status_code == 201, relation.text

    deleted = client.delete(f"/api/v1/records/{record['id']}")
    assert deleted.status_code == 204, deleted.text
    assert client.get(f"/api/v1/records/{record['id']}").status_code == 404
    assert client.get(f"/api/v1/sources/{source_id}").status_code == 200
    assert client.get(f"/api/v1/record-relations?record_id={other['id']}").json() == []
    latest = client.get(f"/api/v1/sources/{source_id}/candidate-bundles/latest").json()
    released = next(item for item in latest["suggestions"] if item["key"] == candidate["key"])
    assert released["confirmed_record_id"] is None
    assert released["review_state"] == "active"
    audits = client.get(f"/api/v1/audit?target_table=records&target_id={record['id']}").json()
    assert "delete" in {item["action"] for item in audits}


def test_seven_real_samples_can_be_manually_mapped_without_ai() -> None:
    client = _client()
    texts = [
        "6.27在光彩大市场选定18片60*120cm花砖，共1100元，已交500元。",
        "卫生间淋浴区花砖竖贴，花砖和普通砖之间使用铝合金腰线。",
        "待现场规划卫生间飘窗和壁龛如何铺贴。",
        "地砖铺贴完毕，主卧门口有小破裂，后期用门套遮挡。",
        "地面通铺75*150cm柔光砖，卫生间使用60*120同色系砖。",
        "拆除主卧卫生间并调整门洞，厨房门长度约240cm，拆打完成。",
        "完成水电施工，确认智能开关、网络和HDMI光纤，打压测试通过。",
    ]
    source_ids = [_source(client, text) for text in texts]

    mappings: list[list[tuple[str, str, dict]]] = [
        [
            ("event", "occurred", {"event_kind": "shopping"}),
            ("decision", "confirmed", {"topic": "花砖花色", "selected_option": "已选定"}),
            (
                "ledger",
                "paid",
                {
                    "ledger_kind": "payment",
                    "direction": "expense",
                    "payment_kind": "deposit",
                    "amount_minor": 50000,
                },
            ),
            ("issue", "pending", {"phenomenon": "等待送货并验收", "severity": "low"}),
        ],
        [
            (
                "decision",
                "confirmed",
                {"topic": "淋浴区铺贴方式", "selected_option": "竖贴并使用铝合金腰线"},
            ),
            (
                "measurement",
                "active",
                {
                    "object_name": "花砖",
                    "measurement_role": "material_spec",
                    "values": [
                        {"axis": "width", "value": 600, "unit": "mm"},
                        {"axis": "height", "value": 1200, "unit": "mm"},
                    ],
                },
            ),
        ],
        [
            (
                "research",
                "collecting",
                {"question": "飘窗和壁龛如何铺贴", "options": ["花砖", "普通纯色砖"]},
            ),
            ("issue", "pending", {"phenomenon": "现场规划飘窗和壁龛铺贴", "severity": "low"}),
        ],
        [
            ("event", "completed", {"event_kind": "construction", "result": "地砖铺贴完毕"}),
            (
                "issue",
                "pending",
                {
                    "phenomenon": "主卧门口地砖小破裂",
                    "handling_plan": "门套遮挡",
                    "severity": "medium",
                },
            ),
            ("decision", "confirmed", {"topic": "破裂处理", "selected_option": "不返工，门套遮挡"}),
            ("issue", "pending", {"phenomenon": "门套施工后复核遮挡效果", "severity": "low"}),
        ],
        [
            ("decision", "confirmed", {"topic": "全屋瓷砖方案", "selected_option": "柔光砖同色系"}),
            (
                "measurement",
                "active",
                {
                    "object_name": "地面柔光砖",
                    "measurement_role": "material_spec",
                    "values": [
                        {"axis": "width", "value": 750, "unit": "mm"},
                        {"axis": "height", "value": 1500, "unit": "mm"},
                    ],
                },
            ),
        ],
        [
            ("event", "completed", {"event_kind": "construction", "result": "拆打完成"}),
            (
                "decision",
                "confirmed",
                {"topic": "空间拆改", "selected_option": "拆卫生间并调整门洞"},
            ),
            (
                "measurement",
                "active",
                {
                    "object_name": "厨房门",
                    "measurement_role": "design_requirement",
                    "approximate": True,
                    "values": [{"axis": "width", "value": 2400, "unit": "mm"}],
                },
            ),
        ],
        [
            ("event", "completed", {"event_kind": "construction", "result": "水电铺设完成"}),
            ("decision", "confirmed", {"topic": "智能开关", "selected_option": "全屋使用"}),
            ("decision", "confirmed", {"topic": "网络布线", "selected_option": "全屋布线"}),
            ("decision", "confirmed", {"topic": "HDMI光纤", "selected_option": "书房连接客厅电视"}),
            ("issue", "pending", {"phenomenon": "补充水电线路资料", "severity": "low"}),
            ("event", "completed", {"event_kind": "acceptance_test", "result": "水管打压通过"}),
        ],
    ]

    for index, records in enumerate(mappings):
        for record_type, record_status, detail in records:
            if record_type == "ledger":
                vendor = client.post("/api/v1/vendors", json={"name": f"交易对象{index}"}).json()
                detail = {**detail, "vendor_id": vendor["id"]}
            response = client.post(
                "/api/v1/records",
                json={
                    **_common(source_ids[index], record_type, record_status),
                    **detail,
                },
            )
            assert response.status_code == 201, response.text

    sample_seven = client.get(
        f"/api/v1/records?source_id={source_ids[6]}&include_archived=true"
    ).json()
    assert len(sample_seven) == 6
    assert len([record for record in sample_seven if record["record_type"] == "issue"]) == 1
    assert len(client.get("/api/v1/sources").json()) == 7


def test_local_suggestions_distinguish_order_total_and_actual_payment() -> None:
    client = _client()
    source_id = _source(
        client,
        "6.27在光彩大市场选定18片60*120cm花砖，共计1100元，已交500元，老板承诺送货上门。",
    )
    response = client.get(f"/api/v1/sources/{source_id}/suggestions")
    assert response.status_code == 200, response.text
    bundle = response.json()
    by_type: dict[str, list[dict]] = {}
    for suggestion in bundle["suggestions"]:
        by_type.setdefault(suggestion["record_type"], []).append(suggestion)

    payment = next(
        item for item in by_type["ledger"] if item["payload"]["ledger_kind"] == "payment"
    )
    assert payment["payload"]["amount_minor"] == 50000
    assert payment["payload"]["status"] == "paid"
    assert by_type["measurement"][0]["payload"]["values"][1]["value"] == 120
    assert all(item["selected_by_default"] for item in by_type["ledger"])
    assert all(item["payload"]["ledger_kind"] != "purchase_order" for item in by_type["ledger"])


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("昨天完成了水电施工", "2026-07-01"),
        ("上周五完成了水电施工", "2026-06-26"),
        ("6月20日完成了水电施工", "2026-06-20"),
    ],
)
def test_local_suggestions_resolve_dates_against_capture_date(text: str, expected: str) -> None:
    bundle = suggest_from_text(
        "source-date", text, datetime.fromisoformat("2026-07-02T10:00:00+08:00")
    )
    event = next(item for item in bundle["suggestions"] if item["record_type"] == "event")
    assert event["payload"]["occurred_date"] == expected
    assert event["payload"]["original_time_text"]


def test_local_suggestions_leave_ambiguous_date_empty() -> None:
    bundle = suggest_from_text(
        "source-date", "月初完成了水电施工", datetime.fromisoformat("2026-07-02T10:00:00+08:00")
    )
    event = next(item for item in bundle["suggestions"] if item["record_type"] == "event")
    assert event["payload"]["occurred_date"] is None


def test_local_suggestions_leave_month_only_empty_and_request_manual_date() -> None:
    bundle = suggest_from_text(
        "source-month", "6月完成了水电施工", datetime.fromisoformat("2026-07-02T10:00:00+08:00")
    )
    event = next(item for item in bundle["suggestions"] if item["record_type"] == "event")
    assert event["payload"]["occurred_date"] is None
    assert "发生日期" in event["missing_fields"]


def test_local_suggestion_batch_confirmation_is_atomic_and_idempotent() -> None:
    client = _client()
    source_id = _source(
        client,
        "选定18片60*120cm花砖，共计1100元，已交500元，等待送货验收。",
    )
    bundle = client.get(f"/api/v1/sources/{source_id}/suggestions").json()
    selected = [item for item in bundle["suggestions"] if item["selected_by_default"]]
    vendor_id = client.post("/api/v1/vendors", json={"name": "批量确认交易对象"}).json()["id"]
    for item in selected:
        if item["record_type"] == "ledger":
            item["payload"]["vendor_id"] = vendor_id
        if item["record_type"] == "issue":
            item["payload"]["severity"] = "low"
    request_body = {
        "selections": [{"key": item["key"], "payload": item["payload"]} for item in selected]
    }
    first = client.post(f"/api/v1/sources/{source_id}/suggestions/confirm", json=request_body)
    assert first.status_code == 200, first.text
    assert all(item["created"] for item in first.json()["records"])
    first_count = len(client.get(f"/api/v1/records?source_id={source_id}").json())

    second = client.post(f"/api/v1/sources/{source_id}/suggestions/confirm", json=request_body)
    assert second.status_code == 200, second.text
    assert all(not item["created"] for item in second.json()["records"])
    assert len(client.get(f"/api/v1/records?source_id={source_id}").json()) == first_count
    refreshed = client.get(f"/api/v1/sources/{source_id}/suggestions").json()
    assert all(
        item["confirmed_record_id"]
        for item in refreshed["suggestions"]
        if item["key"] in {selected_item["key"] for selected_item in selected}
    )


def test_local_suggestion_validation_failure_rolls_back_whole_batch() -> None:
    client = _client()
    source_id = _source(client, "已交500元，已退款100元。")
    bundle = client.get(f"/api/v1/sources/{source_id}/suggestions").json()
    ledger = next(
        item for item in bundle["suggestions"] if item["payload"].get("ledger_kind") == "payment"
    )
    refund = next(
        item for item in bundle["suggestions"] if item["payload"].get("ledger_kind") == "refund"
    )
    invalid_refund = {**refund["payload"]}
    invalid_refund.pop("amount_minor")
    response = client.post(
        f"/api/v1/sources/{source_id}/suggestions/confirm",
        json={
            "selections": [
                {"key": ledger["key"], "payload": ledger["payload"]},
                {"key": refund["key"], "payload": invalid_refund},
            ]
        },
    )
    assert response.status_code == 422
    assert client.get(f"/api/v1/records?source_id={source_id}").json() == []


def test_local_suggestions_keep_uncertain_items_unselected_and_allow_empty_result() -> None:
    client = _client()
    research_source = _source(client, "待现场规划壁龛如何铺贴，是花砖还是普通砖。")
    research_bundle = client.get(f"/api/v1/sources/{research_source}/suggestions").json()
    research = next(
        item for item in research_bundle["suggestions"] if item["record_type"] == "research"
    )
    assert research["certainty"] == "uncertain"
    assert research["selected_by_default"] is False

    empty_source = _source(client, "今天心情不错。")
    empty_bundle = client.get(f"/api/v1/sources/{empty_source}/suggestions").json()
    assert empty_bundle["suggestions"] == []


def test_sample_004_and_007_local_suggestion_boundaries() -> None:
    client = _client()
    sample_004 = _source(
        client,
        "6.25日去现场时地砖已经铺贴完毕，发现主卧门口有小破裂，已确认后期做门套遮挡。",
    )
    types_004 = [
        item["record_type"]
        for item in client.get(f"/api/v1/sources/{sample_004}/suggestions").json()["suggestions"]
    ]
    assert {"event", "issue", "decision"}.issubset(types_004)

    sample_007 = _source(
        client,
        "5月14日开始水电施工，确认全屋使用智能开关，确认全屋网络布线，确认布放HDMI光纤线。水电线路资料后续补充，5月29日前后完成水电铺设，水管打压测试通过。",
    )
    suggestions_007 = client.get(f"/api/v1/sources/{sample_007}/suggestions").json()["suggestions"]
    assert len([item for item in suggestions_007 if item["record_type"] == "decision"]) == 3
    assert any(
        item["record_type"] == "event" and item["payload"].get("event_kind") == "验收测试通过"
        for item in suggestions_007
    )
    assert any(item["record_type"] == "issue" for item in suggestions_007)
