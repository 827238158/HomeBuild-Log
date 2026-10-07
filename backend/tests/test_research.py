from __future__ import annotations

from sqlalchemy.orm import Session

from app.domain_models import Record, ResearchConclusion, ResearchDetail
from tests.test_pitfalls import _client


def test_research_workflow_and_disabled_conclusions() -> None:
    client = _client()
    topic = client.post("/api/v1/research", json={"title": "回水管调研"}).json()
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


def test_old_research_data_is_read_only_and_status_is_projected() -> None:
    client = _client()
    topic = client.post("/api/v1/research", json={"title": "旧调研"}).json()
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
    quick = client.post("/api/v1/research", json={"title": "原始来源"}).json()
    payload = {"record_type": "research", "title": "选砖", "question": "如何选砖",
               "status": "comparing", "source_refs": quick["source_refs"]}
    for value in [{"conclusion": "柔光砖"}, {"conclusion_reason": "依据"},
                  {"conclusion_entry_id": None}, {"status": "concluded"}]:
        assert client.post("/api/v1/records", json={**payload, **value}).status_code == 422
    assert client.post("/api/v1/records", json={**payload, "conclusion": ""}).status_code == 201



def test_local_candidate_confirmation_rejects_conclusion() -> None:
    client = _client()
    source_id = client.post("/api/v1/sources", json={
        "input_type": "text", "original_text": "调研瓷砖的比较依据和优缺点",
    }).json()["id"]
    bundle = client.get(f"/api/v1/sources/{source_id}/suggestions").json()
    candidate = next(item for item in bundle["suggestions"] if item["record_type"] == "research")
    for extra in [{"conclusion": "旧结论"}, {"conclusion_reason": "原因"}]:
        response = client.post(f"/api/v1/sources/{source_id}/suggestions/confirm", json={
            "selections": [{"key": candidate["key"], "payload": {**candidate["payload"], **extra}}],
        })
        assert response.status_code == 422, response.text
    assert client.get("/api/v1/research").json()["summary"]["total"] == 0
