from __future__ import annotations

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api import research as research_api
from app.domain_models import Record, ResearchConclusion, ResearchDetail
from app.models import AuditEntry, SourceEntry
from tests.record_context import confirmation_payload, creation_payload
from tests.test_pitfalls import _client


def test_research_background_associations_and_atomic_updates() -> None:
    client = _client()
    references = {
        "space_ids": [client.post("/api/v1/spaces", json={
            "name": "厨房", "kind": "room",
        }).json()["id"]],
        "material_ids": [client.post("/api/v1/materials", json={
            "name": "开关",
        }).json()["id"]],
        "participant_ids": [client.post("/api/v1/participants", json={
            "name": "电工",
        }).json()["id"]],
        "stage_id": client.post("/api/v1/stages", json={"name": "水电"}).json()["id"],
        "related_record_ids": [client.post("/api/v1/research", json=creation_payload(client, {
            "title": "关联事项",
        })).json()["id"]],
    }
    response = client.post(
        "/api/v1/research", json=creation_payload(client, {"title": "开关调研", **references})
    )
    assert response.status_code == 201
    record = response.json()
    route = f"/api/v1/research/{record['id']}"
    for key, value in references.items():
        assert record[key] == value
    assert client.patch(route, json={"description": "补充背景"}).status_code == 200
    unchanged = client.get(route).json()
    for key, value in references.items():
        assert unchanged[key] == value
    # 无效引用与自身关联均回滚标题、已有关联及审计写入。
    for key in ("space_ids", "material_ids", "participant_ids", "related_record_ids"):
        invalid = client.patch(route, json={"title": "不应保存", key: ["missing"]})
        assert invalid.status_code == 400
        assert client.get(route).json()["title"] == "开关调研"
        assert client.get(route).json()[key] == references[key]
    assert client.patch(route, json={"related_record_ids": [record["id"]]}).status_code == 400
    cleared = client.patch(route, json={
        key: None if key == "stage_id" else [] for key in references
    }).json()
    for key in references:
        assert cleared[key] == (None if key == "stage_id" else [])
    assert client.get(f"/api/v1/records/{record['id']}").json()["space_ids"] == []
    for key in ("space_ids", "material_ids", "participant_ids", "related_record_ids"):
        assert client.patch(route, json={key: None}).status_code == 422
    before_count = len(client.get("/api/v1/records").json())
    with Session(client.app.state.engine) as db:
        source_count = db.scalar(select(func.count()).select_from(SourceEntry))
        audit_count = db.scalar(select(func.count()).select_from(AuditEntry))
    assert client.post("/api/v1/research", json=creation_payload(client, {
        "title": "失败创建", "material_ids": ["missing"],
    })).status_code == 400
    assert len(client.get("/api/v1/records").json()) == before_count
    with Session(client.app.state.engine) as db:
        assert db.scalar(select(func.count()).select_from(SourceEntry)) == source_count
        assert db.scalar(select(func.count()).select_from(AuditEntry)) == audit_count


def test_research_workflow_and_disabled_conclusions() -> None:
    client = _client()
    topic = client.post(
        "/api/v1/research", json=creation_payload(client, {"title": "回水管调研"})
    ).json()
    route = f"/api/v1/research/{topic['id']}"
    assert topic["source_refs"] and topic["entries"] == []
    for day in ["2026-11-02", "2026-10-15"]:
        response = client.post(route + "/entries", json={
            "research_date": day, "content": "了解管路", "sources": ["说明书"],
        })
        assert response.status_code == 201
    assert [row["research_date"] for row in response.json()["entries"]] == [
        "2026-10-15", "2026-11-02",
    ]
    assert client.post(route + "/conclusions", json={}).status_code == 410
    assert client.patch(route, json={"status": "concluded"}).status_code == 422
    assert client.patch(route, json={"status": "archived"}).status_code == 200
    assert client.get("/api/v1/research?state=archived").json()["summary"]["archived"] == 1
    assert client.patch(route, json={"status": "comparing"}).json()["status"] == "comparing"
    assert client.post(route + "/entries", json={
        "research_date": "2026-10-03", "content": "  ",
    }).status_code == 422
    assert client.patch(route, json={"status": None}).status_code == 422
    client.headers.clear()
    assert client.post(route + "/conclusions", json={}).status_code == 401


def test_archived_research_requires_restore_without_writing() -> None:
    client = _client()
    topic = client.post(
        "/api/v1/research", json=creation_payload(client, {"title": "归档后继续调研"})
    ).json()
    route = f"/api/v1/research/{topic['id']}"
    archived = client.patch(route, json={"status": "archived"}).json()
    with Session(client.app.state.engine) as db:
        audit_count = db.scalar(select(func.count()).select_from(AuditEntry))
    entry = {"research_date": "2026-10-16", "content": "补充资料"}
    response = client.post(route + "/entries", json=entry)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "research_archived"
    unchanged = client.get(route).json()
    assert unchanged["version"] == archived["version"]
    assert unchanged["updated_at"] == archived["updated_at"]
    assert unchanged["entries"] == []
    with Session(client.app.state.engine) as db:
        assert db.scalar(select(func.count()).select_from(AuditEntry)) == audit_count
    assert client.patch(route, json={"status": "comparing"}).status_code == 200
    assert client.post(route + "/entries", json=entry).status_code == 201


def test_archive_between_append_check_and_write_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _client()
    topic = client.post(
        "/api/v1/research", json=creation_payload(client, {"title": "并发归档"})
    ).json()
    route = f"/api/v1/research/{topic['id']}"
    original_bump = research_api.bump_record_version

    def archive_then_bump(db: Session, record: Record, expected_version: int) -> None:
        # 模拟通过状态检查后，另一页面先完成归档。
        with Session(client.app.state.engine) as other:
            other.execute(update(Record).where(Record.id == record.id).values(
                status="archived", version=Record.version + 1,
            ))
            other.commit()
        original_bump(db, record, expected_version)

    monkeypatch.setattr(research_api, "bump_record_version", archive_then_bump)
    response = client.post(route + "/entries", json={
        "research_date": "2026-10-16", "content": "不应写入的过程",
    })
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "record_version_conflict"
    latest = client.get(route).json()
    assert latest["status"] == "archived"
    assert latest["entries"] == []
    assert latest["version"] == topic["version"] + 1


def test_old_research_data_is_read_only_and_status_is_projected() -> None:
    client = _client()
    topic = client.post(
        "/api/v1/research", json=creation_payload(client, {"title": "旧调研"})
    ).json()
    topic_id = topic["id"]
    with Session(client.app.state.engine) as db:
        db.get(Record, topic_id).status = "concluded"
        db.get(ResearchDetail, topic_id).conclusion = "旧结论"
        db.add(ResearchConclusion(record_id=topic_id, conclusion="旧结论", reason="旧依据"))
        db.commit()
    route = f"/api/v1/records/{topic_id}"
    for payload in [{"conclusion": 0}, {"conclusion": False}, {"conclusion": []},
                    {"conclusion": "新结论"}, {"conclusion_reason": None},
                    {"conclusion_entry_id": "x"}, {"status": "concluded"}]:
        assert client.patch(route, json={"record_type": "research", **payload}).status_code == 422
    for empty in [None, "", "   "]:
        response = client.patch(route, json={"record_type": "research", "conclusion": empty})
        assert response.status_code == 200
        assert response.json()["conclusion"] == "旧结论"
    read = client.get(f"/api/v1/research/{topic_id}").json()
    assert read["status"] == "comparing"
    assert read["conclusion_history"][0]["conclusion"] == "旧结论"
    listing = client.get("/api/v1/research?state=comparing").json()
    assert len(listing["items"]) == 1
    assert listing["summary"] == {"total": 1, "collecting": 0, "comparing": 1, "archived": 0}
    assert client.get(route).json()["status"] == "comparing"
    assert client.get("/api/v1/records?record_type=research").json()[0]["status"] == "comparing"
    timeline = client.get("/api/v1/timeline?record_type=research").json()
    assert timeline["analytics"]["status_distribution"][0]["key"] == "comparing"
    for endpoint in ["/api/v1/research", f"/api/v1/research/{topic_id}"]:
        request = client.post if endpoint == "/api/v1/research" else client.patch
        assert request(endpoint, json={"title": "旧调研", "conclusion": "拒绝"}).status_code == 422
    with Session(client.app.state.engine) as db:
        assert db.get(Record, topic_id).status == "concluded"
    client.patch(f"/api/v1/research/{topic_id}", json={"status": "comparing"})
    with Session(client.app.state.engine) as db:
        assert db.get(Record, topic_id).status == "comparing"
        assert db.get(ResearchDetail, topic_id).conclusion == "旧结论"


def test_generic_creation_rejects_conclusion_writes() -> None:
    client = _client()
    quick = client.post(
        "/api/v1/research", json=creation_payload(client, {"title": "原始来源"})
    ).json()
    payload = {"record_type": "research", "title": "选砖", "question": "如何选砖",
               "status": "comparing", "source_refs": quick["source_refs"]}
    for value in [{"conclusion": "柔光砖"}, {"conclusion_reason": "依据"},
                  {"conclusion_entry_id": None}, {"status": "concluded"}]:
        assert (
            client.post(
                "/api/v1/records", json=creation_payload(client, {**payload, **value})
            ).status_code
            == 422
        )
    assert (
        client.post(
            "/api/v1/records", json=creation_payload(client, {**payload, "conclusion": ""})
        ).status_code
        == 201
    )


def test_local_candidate_confirmation_rejects_conclusion() -> None:
    client = _client()
    source_id = client.post("/api/v1/sources", json={
        "input_type": "text", "original_text": "调研瓷砖的比较依据和优缺点",
    }).json()["id"]
    bundle = client.get(f"/api/v1/sources/{source_id}/suggestions").json()
    candidate = next(item for item in bundle["suggestions"] if item["record_type"] == "research")
    for extra in [{"conclusion": "旧结论"}, {"conclusion_reason": "原因"}]:
        response = client.post(
            f"/api/v1/sources/{source_id}/suggestions/confirm",
            json=confirmation_payload(
                client,
                f"/api/v1/sources/{source_id}/suggestions/confirm",
                {
                    "selections": [
                        {"key": candidate["key"], "payload": {**candidate["payload"], **extra}}
                    ],
                },
            ),
        )
        assert response.status_code == 422, response.text
    assert client.get("/api/v1/research").json()["summary"]["total"] == 0
