from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
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
        "posted",
        {"direction": "expense", "payment_kind": "deposit", "amount_minor": 50000},
    ),
    ("issue", "open", {"phenomenon": "主卧门口地砖小破裂"}),
    (
        "measurement",
        "active",
        {
            "object_name": "花砖",
            "measurement_role": "material_spec",
            "values": [
                {"axis": "width", "value": "60", "unit": "cm"},
                {"axis": "height", "value": "120", "unit": "cm"},
            ],
        },
    ),
    (
        "decision",
        "confirmed",
        {"topic": "是否返工", "options": ["返工", "门套遮挡"], "selected_option": "门套遮挡"},
    ),
    (
        "procurement",
        "ordered",
        {"item_name": "花砖", "quantity": "18", "quantity_unit": "片", "order_total_minor": 110000},
    ),
    (
        "research",
        "comparing",
        {"question": "选择哪种瓷砖", "options": ["浅灰", "中灰"]},
    ),
    ("todo", "pending", {"action": "到货后验收"}),
]


@pytest.mark.parametrize(("record_type", "record_status", "detail"), RECORD_CASES)
def test_create_all_eight_record_types(record_type: str, record_status: str, detail: dict) -> None:
    client = _client()
    source_id = _source(client)
    payload = {**_common(source_id, record_type, record_status), **detail}
    response = client.post("/api/v1/records", json=payload)
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["record_type"] == record_type
    assert data["source_refs"][0]["source_id"] == source_id
    if record_type == "measurement":
        assert [item["value"] for item in data["values"]] == [60.0, 120.0]


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


def test_update_archive_restore_relation_and_audit() -> None:
    client = _client()
    source_id = _source(client)
    first = client.post(
        "/api/v1/records",
        json={**_common(source_id, "event", "occurred"), "event_kind": "construction"},
    ).json()
    second = client.post(
        "/api/v1/records",
        json={**_common(source_id, "todo", "pending"), "action": "现场复核"},
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
            json={"record_type": "todo", "title": "非法换型"},
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


def test_record_requires_source_and_rejects_invalid_measurement() -> None:
    client = _client()
    without_source = client.post(
        "/api/v1/records",
        json={
            "record_type": "todo",
            "title": "无来源",
            "status": "pending",
            "source_refs": [],
            "action": "不应创建",
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
            "values": [{"axis": "width", "value": 0, "unit": "cm"}],
        },
    )
    assert invalid_value.status_code == 422


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
                "procurement",
                "ordered",
                {
                    "item_name": "花砖",
                    "quantity": 18,
                    "quantity_unit": "片",
                    "order_total_minor": 110000,
                },
            ),
            (
                "ledger",
                "posted",
                {"direction": "expense", "payment_kind": "deposit", "amount_minor": 50000},
            ),
            ("todo", "pending", {"action": "等待送货并验收"}),
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
                        {"axis": "width", "value": 60, "unit": "cm"},
                        {"axis": "height", "value": 120, "unit": "cm"},
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
            ("todo", "pending", {"action": "现场规划飘窗和壁龛铺贴"}),
        ],
        [
            ("event", "completed", {"event_kind": "construction", "result": "地砖铺贴完毕"}),
            ("issue", "waiting", {"phenomenon": "主卧门口地砖小破裂", "handling_plan": "门套遮挡"}),
            ("decision", "confirmed", {"topic": "破裂处理", "selected_option": "不返工，门套遮挡"}),
            ("todo", "waiting", {"action": "门套施工后复核遮挡效果"}),
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
                        {"axis": "width", "value": 75, "unit": "cm"},
                        {"axis": "height", "value": 150, "unit": "cm"},
                    ],
                },
            ),
            (
                "procurement",
                "planned",
                {"item_name": "蒙娜丽莎10307艾米丽尔柔光砖", "return_terms": "多退少补"},
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
                    "values": [{"axis": "width", "value": 240, "unit": "cm"}],
                },
            ),
        ],
        [
            ("event", "completed", {"event_kind": "construction", "result": "水电铺设完成"}),
            ("decision", "confirmed", {"topic": "智能开关", "selected_option": "全屋使用"}),
            ("decision", "confirmed", {"topic": "网络布线", "selected_option": "全屋布线"}),
            ("decision", "confirmed", {"topic": "HDMI光纤", "selected_option": "书房连接客厅电视"}),
            ("todo", "pending", {"action": "补充水电线路资料"}),
            ("event", "completed", {"event_kind": "acceptance_test", "result": "水管打压通过"}),
        ],
    ]

    for index, records in enumerate(mappings):
        for record_type, record_status, detail in records:
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
    assert all(record["record_type"] != "issue" for record in sample_seven)
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

    assert by_type["ledger"][0]["payload"]["amount_minor"] == 50000
    assert by_type["procurement"][0]["payload"]["order_total_minor"] == 110000
    assert by_type["measurement"][0]["payload"]["values"][1]["value"] == 120
    assert all(item["selected_by_default"] for item in by_type["ledger"])
    assert any(item["relation_type"] == "pays_for" for item in bundle["relations"])


def test_local_suggestion_batch_confirmation_is_atomic_and_idempotent() -> None:
    client = _client()
    source_id = _source(
        client,
        "选定18片60*120cm花砖，共计1100元，已交500元，等待送货验收。",
    )
    bundle = client.get(f"/api/v1/sources/{source_id}/suggestions").json()
    selected = [item for item in bundle["suggestions"] if item["selected_by_default"]]
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
    source_id = _source(client, "选定18片花砖，共计1100元，已交500元。")
    bundle = client.get(f"/api/v1/sources/{source_id}/suggestions").json()
    ledger = next(item for item in bundle["suggestions"] if item["record_type"] == "ledger")
    procurement = next(
        item for item in bundle["suggestions"] if item["record_type"] == "procurement"
    )
    invalid_procurement = {**procurement["payload"]}
    invalid_procurement.pop("item_name")
    response = client.post(
        f"/api/v1/sources/{source_id}/suggestions/confirm",
        json={
            "selections": [
                {"key": ledger["key"], "payload": ledger["payload"]},
                {"key": procurement["key"], "payload": invalid_procurement},
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
    assert {"event", "issue", "decision", "todo"}.issubset(types_004)

    sample_007 = _source(
        client,
        "5月14日开始水电施工，确认全屋使用智能开关，确认全屋网络布线，确认布放HDMI光纤线。水电线路资料后续补充，5月29日前后完成水电铺设，水管打压测试通过。",
    )
    suggestions_007 = client.get(f"/api/v1/sources/{sample_007}/suggestions").json()["suggestions"]
    assert len([item for item in suggestions_007 if item["record_type"] == "decision"]) == 3
    assert any(
        item["record_type"] == "event" and item["payload"].get("event_kind") == "acceptance_test"
        for item in suggestions_007
    )
    assert all(item["record_type"] != "issue" for item in suggestions_007)
