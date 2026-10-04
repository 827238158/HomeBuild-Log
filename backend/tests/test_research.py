from __future__ import annotations

from tests.test_pitfalls import _client


def test_research_long_running_workflow_and_reopen() -> None:
    client = _client()
    created = client.post("/api/v1/research", json={"title": "有必要做回水管吗？"})
    assert created.status_code == 201, created.text
    topic = created.json()
    topic_id = topic["id"]
    assert topic["status"] == "collecting"
    assert topic["source_refs"]
    assert topic["created_at"] and topic["updated_at"]
    assert topic["entries"] == []
    assert topic["conclusion_history"] == []
    route = f"/api/v1/research/{topic_id}"
    renamed = client.patch(route, json={"title": "回水管调研"})
    assert renamed.json()["title"] == "回水管调研"
    assert renamed.json()["question"] == "有必要做回水管吗？"
    for research_date, content in [("2026-11-02", "结合管路重新研究"),
                                    ("2026-10-15", "了解循环泵费用")]:
        response = client.post(route + "/entries", json={
            "research_date": research_date, "content": content,
            "sources": ["厂家说明书"], "uncertainties": "现场长度待确认",
        })
        assert response.status_code == 201, response.text
    entry_id = response.json()["entries"][0]["id"]
    first = client.post(route + "/conclusions", json={
        "conclusion": "考虑安装", "reason": "认为等待热水过久", "entry_id": entry_id,
    })
    assert first.status_code == 201, first.text
    second = client.post(route + "/conclusions", json={
        "conclusion": "现有管路不适用", "reason": "现场确认管路短且无回水条件",
    })
    assert second.status_code == 201
    assert [row["conclusion"] for row in second.json()["conclusion_history"]] == [
        "考虑安装", "现有管路不适用",
    ]
    assert [row["research_date"] for row in second.json()["entries"]] == [
        "2026-10-15", "2026-11-02",
    ]
    assert client.patch(route, json={"status": "archived"}).status_code == 200
    assert client.get("/api/v1/research?state=archived").json()["summary"]["archived"] == 1
    assert client.patch(route, json={"status": "comparing"}).json()["status"] == "comparing"
    assert client.get(route).json()["conclusion"] == "现有管路不适用"


def test_generic_update_cannot_bypass_conclusion_history() -> None:
    client = _client()
    topic_id = client.post("/api/v1/research", json={"title": "踢脚线怎么选"}).json()["id"]
    route = f"/api/v1/records/{topic_id}"
    rejected = client.patch(route, json={"record_type": "research", "conclusion": "铝合金"})
    assert rejected.status_code == 422
    assert client.get(route).json()["conclusion"] is None
    accepted = client.patch(route, json={
        "record_type": "research", "conclusion": "铝合金", "conclusion_reason": "耐水",
    })
    assert accepted.status_code == 200, accepted.text
    client.patch(route, json={
        "record_type": "research", "conclusion": None, "conclusion_reason": "资料不足撤回",
    })
    topic = client.get(f"/api/v1/research/{topic_id}").json()
    assert [row["conclusion"] for row in topic["conclusion_history"]] == ["铝合金", None]


def test_research_validation_auth_and_cross_topic_reference() -> None:
    client = _client()
    assert client.post("/api/v1/research", json={"title": "  "}).status_code == 422
    assert client.get("/api/v1/research").json()["summary"]["total"] == 0
    first = client.post("/api/v1/research", json={"title": "第一主题"}).json()["id"]
    second = client.post("/api/v1/research", json={"title": "第二主题"}).json()["id"]
    foreign = client.post(f"/api/v1/research/{second}/entries", json={
        "research_date": "2026-10-03", "content": "第二主题研究",
    }).json()["entries"][0]["id"]
    assert client.post(f"/api/v1/research/{first}/conclusions", json={
        "conclusion": "结论", "reason": "依据", "entry_id": foreign,
    }).status_code == 422
    assert client.post(f"/api/v1/research/{first}/entries", json={
        "research_date": "2026-10-03", "content": "  ",
    }).status_code == 422
    assert client.post(f"/api/v1/research/{first}/conclusions", json={
        "conclusion": "结论", "reason": "  ",
    }).status_code == 422
    assert client.patch(f"/api/v1/research/{first}", json={"status": None}).status_code == 422
    assert client.get("/api/v1/research/missing").status_code == 404
    client.headers.clear()
    assert client.get("/api/v1/research").status_code == 401


def test_generic_creation_keeps_initial_conclusion_in_shared_topic() -> None:
    client = _client()
    quick = client.post("/api/v1/research", json={"title": "记录研究原始来源"}).json()
    created = client.post("/api/v1/records", json={
        "record_type": "research", "title": "选砖", "question": "柔光还是亮光",
        "status": "concluded", "source_refs": quick["source_refs"],
        "conclusion": "柔光砖", "evidence_sources": ["现场样板对比"],
    })
    assert created.status_code == 201, created.text
    topic = client.get(f"/api/v1/research/{created.json()['id']}").json()
    assert topic["conclusion_history"][0]["conclusion"] == "柔光砖"
    assert topic["conclusion_history"][0]["reason"] == "创建时的初始结论"
    assert topic["evidence_sources"] == ["现场样板对比"]
    assert client.get("/api/v1/research").json()["summary"]["total"] == 2
