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


def test_pitfall_crud_and_derived_status() -> None:
    client = _client()
    created = client.post(
        "/api/v1/pitfalls",
        json={"occurred_date": "2026-08-10", "description": "墙面返碱"},
    )
    assert created.status_code == 201, created.text
    pitfall_id = created.json()["id"]
    assert created.json()["status"] == "unresolved"

    # 故意反序新增，接口仍应按处理日期展示完整过程。
    later = client.post(
        f"/api/v1/pitfalls/{pitfall_id}/resolutions",
        json={"resolved_date": "2026-08-13", "content": "重新补刷面漆"},
    )
    earlier = client.post(
        f"/api/v1/pitfalls/{pitfall_id}/resolutions",
        json={"resolved_date": "2026-08-11", "content": "确认返碱原因"},
    )
    assert later.status_code == 201
    assert earlier.status_code == 201

    listing = client.get("/api/v1/pitfalls?state=resolved").json()
    assert listing["summary"] == {"total": 1, "unresolved": 0, "resolved": 1}
    assert [row["content"] for row in listing["items"][0]["resolutions"]] == [
        "确认返碱原因",
        "重新补刷面漆",
    ]

    changed = client.patch(
        f"/api/v1/pitfalls/resolutions/{earlier.json()['id']}",
        json={"resolved_date": "2026-08-12", "content": "先排查水汽来源"},
    )
    assert changed.status_code == 200
    assert changed.json()["content"] == "先排查水汽来源"

    assert client.delete(
        f"/api/v1/pitfalls/resolutions/{earlier.json()['id']}"
    ).status_code == 204
    assert client.delete(
        f"/api/v1/pitfalls/resolutions/{later.json()['id']}"
    ).status_code == 204
    unresolved = client.get("/api/v1/pitfalls?state=unresolved").json()
    assert unresolved["summary"]["unresolved"] == 1
    assert unresolved["items"][0]["status"] == "unresolved"

    updated = client.patch(
        f"/api/v1/pitfalls/{pitfall_id}",
        json={"occurred_date": "2026-08-09", "description": "墙面局部返碱"},
    )
    assert updated.status_code == 200
    assert updated.json()["occurred_date"] == "2026-08-09"
    assert client.delete(f"/api/v1/pitfalls/{pitfall_id}").status_code == 204
    assert client.get("/api/v1/pitfalls").json()["items"] == []


def test_pitfall_validation_and_ai_not_configured_state() -> None:
    client = _client()
    invalid = client.post(
        "/api/v1/pitfalls",
        json={"occurred_date": "2026-08-10", "description": "   "},
    )
    assert invalid.status_code == 422
    assert invalid.json()["detail"] == "踩坑经过不能为空。"

    empty_analysis = client.post("/api/v1/pitfalls/analyze")
    assert empty_analysis.status_code == 422

    client.post(
        "/api/v1/pitfalls",
        json={"occurred_date": "2026-08-10", "description": "门套尺寸量错"},
    )
    unavailable = client.post("/api/v1/pitfalls/analyze")
    assert unavailable.status_code == 503
    assert "AI 尚未启用" in unavailable.json()["detail"]
