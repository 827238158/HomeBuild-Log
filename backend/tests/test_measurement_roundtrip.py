import json
import uuid
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import SecretsConfig, _hash_password
from app.core.paths import build_storage_paths, ensure_storage_directories
from app.db import Base, create_database_engine
from app.main import create_app


def _client():
    root = Path(__file__).parent / ".runtime" / uuid.uuid4().hex
    root.mkdir(parents=True)
    paths = build_storage_paths(root)
    ensure_storage_directories(paths)
    (paths.config / "secrets.json").write_text(
        json.dumps(
            {"admin_password_hash": _hash_password("test-password"), "jwt_secret": bytes(50).hex()}
        ),
        encoding="utf-8",
    )
    app = create_app(storage_paths=paths, secrets=SecretsConfig(paths.config))
    engine = create_database_engine(paths.database_file)
    Base.metadata.create_all(engine)
    engine.dispose()
    client = TestClient(app)
    with client:
        pass
    token = client.post("/api/v1/auth/login", json={"password": "test-password"}).json()
    client.headers = {"Authorization": f"Bearer {token['access_token']}"}
    return client


def _source(client, text):
    response = client.post("/api/v1/sources", json={"original_text": text})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _detail():
    return {
        "object_name": "厨房门洞",
        "measurement_role": "site_measurement",
        "approximate": True,
        "tolerance_text": "误差约2毫米",
        "method": "卷尺测量完成面",
        "measured_at": "2026-10-06T08:30:00+08:00",
        "values": [
            {"axis": "净宽", "value": 90.2, "unit": "cm"},
            {"axis": "净宽", "value": 898, "unit": "mm"},
            {"axis": "height", "value": 2.1, "unit": "m"},
            {"axis": "墙厚", "value": 18, "unit": "cm"},
            {"axis": None, "value": 12, "unit": "mm"},
        ],
    }


def _create(client, source_id, **detail):
    response = client.post(
        "/api/v1/records",
        json={
            "record_type": "measurement",
            "title": "门洞测量",
            "status": "active",
            "source_refs": [{"source_id": source_id, "evidence_excerpt": "测量原文"}],
            **_detail(),
            **detail,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _assert_detail(record, expected_values):
    assert [item["axis"] for item in record["values"]] == ["净宽", "净宽", "height", "墙厚", None]
    assert [item["value"] for item in record["values"]] == expected_values
    assert [item["unit"] for item in record["values"]] == ["mm"] * 5
    assert record["approximate"] is True
    assert record["tolerance_text"] == "误差约2毫米"
    assert record["method"] == "卷尺测量完成面"
    assert datetime.fromisoformat(record["measured_at"]) == datetime.fromisoformat(
        "2026-10-06T08:30:00+08:00"
    )


def test_measurement_create_patch_and_projection_keep_all_dimensions():
    client = _client()
    source_id = _source(client, "门洞五项现场测量")
    created = _create(client, source_id)
    _assert_detail(created, [902, 898, 2100, 180, 12])
    detail = _detail()
    detail["values"][0]["value"] = 90.4
    response = client.patch(
        f"/api/v1/records/{created['id']}",
        json={
            "record_type": "measurement",
            **detail,
        },
    )
    assert response.status_code == 200, response.text
    _assert_detail(response.json(), [904, 898, 2100, 180, 12])
    fetched = client.get(f"/api/v1/records/{created['id']}")
    assert fetched.status_code == 200, fetched.text
    _assert_detail(fetched.json(), [904, 898, 2100, 180, 12])
    timeline = client.get("/api/v1/timeline?record_type=measurement")
    assert timeline.status_code == 200, timeline.text
    projected = next(
        item["record"]
        for group in timeline.json()["groups"]
        for item in group["items"]
        if item["record"]["id"] == created["id"]
    )
    _assert_detail(projected, [904, 898, 2100, 180, 12])


def test_remeasurement_creates_relation_without_changing_old_facts():
    client = _client()
    old_source = _source(client, "贴砖前测量")
    old = _create(client, old_source)
    new_source = _source(client, "贴砖后复测")
    new = _create(
        client,
        new_source,
        related_record_ids=[old["id"]],
        values=[{"axis": "净宽", "value": 890, "unit": "mm"}],
    )
    assert new["related_record_ids"] == [old["id"]]
    assert new["source_refs"][0]["source_id"] == new_source
    previous = client.get(f"/api/v1/records/{old['id']}").json()
    _assert_detail(previous, [902, 898, 2100, 180, 12])
    assert previous["source_refs"] == old["source_refs"]
    assert previous["status"] == old["status"]
    relations = client.get(f"/api/v1/record-relations?record_id={new['id']}").json()
    assert len(relations) == 1
    assert {relations[0]["from_record_id"], relations[0]["to_record_id"]} == {old["id"], new["id"]}


def test_remeasurement_invalid_relation_does_not_leave_partial_record():
    client = _client()
    source_id = _source(client, "复测来源")
    response = client.post(
        "/api/v1/records",
        json={
            "record_type": "measurement",
            "title": "不应部分保存",
            "status": "active",
            "source_refs": [{"source_id": source_id, "evidence_excerpt": "复测原文"}],
            **_detail(),
            "related_record_ids": ["missing-record"],
        },
    )
    assert response.status_code == 400, response.text
    assert client.get(f"/api/v1/records?source_id={source_id}").json() == []
