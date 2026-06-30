from __future__ import annotations

import io
import json
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import _hash_password
from app.core.paths import build_storage_paths


def _make_client() -> TestClient:
    """创建带认证和已迁移数据库的测试客户端。"""
    from app.core.config import SecretsConfig
    from app.db import Base
    from app.main import create_app

    tmp_root = Path(tempfile.mkdtemp())
    paths = build_storage_paths(tmp_root)
    paths.config.mkdir(parents=True, exist_ok=True)

    hashed = _hash_password("test-password")
    jwt_secret = bytes(50).hex()
    (paths.config / "secrets.json").write_text(
        json.dumps({"admin_password_hash": hashed, "jwt_secret": jwt_secret}),
        encoding="utf-8",
    )

    secrets = SecretsConfig(paths.config)
    app = create_app(storage_paths=paths, secrets=secrets)

    client = TestClient(app)
    with client:
        pass

    # 创建表用于测试（等价于 alembic upgrade head，但不依赖 alembic 命令行）
    from app.db import create_database_engine
    engine = create_database_engine(paths.database_file)
    Base.metadata.create_all(engine)
    engine.dispose()

    # 登录获取 token
    resp = client.post("/api/v1/auth/login", json={"password": "test-password"})
    token = resp.json()["access_token"]
    client.headers = {"Authorization": f"Bearer {token}"}
    return client


class TestSourcesAPI:
    def test_create_text_source(self):
        client = _make_client()
        response = client.post(
            "/api/v1/sources",
            json={"original_text": "今天去看了瓷砖", "reported_time_text": "2026-06-28"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["id"]
        assert data["original_text"] == "今天去看了瓷砖"
        assert data["reported_time_text"] == "2026-06-28"
        assert data["input_type"] == "text"
        assert data["revision"] == 1
        assert datetime.fromisoformat(data["captured_at"]).utcoffset() is not None

    def test_create_source_without_text(self):
        client = _make_client()
        response = client.post("/api/v1/sources", json={})
        assert response.status_code == 201

    def test_get_source_by_id(self):
        client = _make_client()
        created = client.post(
            "/api/v1/sources",
            json={"original_text": "水电施工完成"},
        )
        source_id = created.json()["id"]

        response = client.get(f"/api/v1/sources/{source_id}")
        assert response.status_code == 200
        assert response.json()["original_text"] == "水电施工完成"

    def test_get_nonexistent_source_returns_404(self):
        client = _make_client()
        response = client.get("/api/v1/sources/nonexistent")
        assert response.status_code == 404

    def test_source_requires_auth(self):
        tmp_root = Path(tempfile.mkdtemp())
        paths = build_storage_paths(tmp_root)
        paths.config.mkdir(parents=True, exist_ok=True)

        (paths.config / "secrets.json").write_text(
            json.dumps(
                {"admin_password_hash": _hash_password("pw"), "jwt_secret": bytes(50).hex()}
            ),
            encoding="utf-8",
        )

        from app.core.config import SecretsConfig
        from app.main import create_app

        secrets = SecretsConfig(paths.config)
        app = create_app(storage_paths=paths, secrets=secrets)
        client = TestClient(app)
        with client:
            pass

        response = client.post("/api/v1/sources", json={"original_text": "test"})
        assert response.status_code == 401


class TestAttachmentsAPI:
    def test_upload_png(self):
        client = _make_client()

        png_bytes = (
            b"\x89PNG\r\n\x1a\n"
            + bytes(100)
        )
        file = io.BytesIO(png_bytes)

        response = client.post(
            "/api/v1/attachments",
            files={"file": ("test.png", file, "image/png")},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["media_type"] == "image/png"
        assert data["original_filename"] == "test.png"
        assert len(data["sha256_hex"]) == 64

    def test_reject_unsupported_type(self):
        client = _make_client()
        file = io.BytesIO(b"text content")
        response = client.post(
            "/api/v1/attachments",
            files={"file": ("test.txt", file, "text/plain")},
        )
        assert response.status_code == 400
        assert "不支持的文件类型" in response.json()["detail"]

    def test_reject_over_size(self):
        client = _make_client()
        # 51 MB 的空字节
        large = io.BytesIO(b"\x00" * (51 * 1024 * 1024))
        response = client.post(
            "/api/v1/attachments",
            files={"file": ("big.pdf", large, "application/pdf")},
        )
        assert response.status_code == 400
        assert "50 MB" in response.json()["detail"]

    def test_attach_to_source(self):
        client = _make_client()

        source_resp = client.post(
            "/api/v1/sources",
            json={"original_text": "瓷砖照片"},
        )
        source_id = source_resp.json()["id"]

        png_bytes = b"\x89PNG\r\n\x1a\n" + b"x" * 50
        file = io.BytesIO(png_bytes)

        response = client.post(
            f"/api/v1/attachments?source_id={source_id}",
            files={"file": ("tile.png", file, "image/png")},
        )
        assert response.status_code == 201
        assert response.json()["source_id"] == source_id


class TestSourceMaintenance:
    @staticmethod
    def _event(client: TestClient, title: str, source_ids: list[str]) -> dict:
        response = client.post(
            "/api/v1/records",
            json={
                "record_type": "event",
                "title": title,
                "status": "occurred",
                "event_kind": "site_visit",
                "source_refs": [
                    {"source_id": source_id, "evidence_excerpt": title}
                    for source_id in source_ids
                ],
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    def test_update_marks_records_for_review_and_review_clears_flag(self):
        client = _make_client()
        source = client.post(
            "/api/v1/sources", json={"original_text": "旧原文"}
        ).json()
        record = self._event(client, "现场查看", [source["id"]])

        updated = client.patch(
            f"/api/v1/sources/{source['id']}",
            json={"original_text": "修正后的原文"},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["revision"] == 2
        stale = client.get(f"/api/v1/records/{record['id']}").json()
        assert stale["source_refs"][0]["needs_review"] is True

        reviewed = client.post(
            f"/api/v1/records/{record['id']}/source-reviews/{source['id']}"
        )
        assert reviewed.status_code == 200, reviewed.text
        assert reviewed.json()["source_refs"][0]["needs_review"] is False
        audits = client.get(
            f"/api/v1/audit?target_table=records&target_id={record['id']}"
        ).json()
        assert "review_source" in {entry["action"] for entry in audits}

    def test_api_returns_occurred_date_and_aware_audit_time(self):
        client = _make_client()
        source = client.post(
            "/api/v1/sources", json={"original_text": "北京时间测试"}
        ).json()
        record = client.post(
            "/api/v1/records",
            json={
                "record_type": "event",
                "title": "上午八点进场",
                "status": "occurred",
                "event_kind": "construction_start",
                "occurred_date": "2026-06-28",
                "source_refs": [{"source_id": source["id"]}],
            },
        )
        assert record.status_code == 201, record.text
        projected = client.get(f"/api/v1/records/{record.json()['id']}").json()
        assert projected["occurred_date"] == "2026-06-28"
        audit = client.get("/api/v1/audit?limit=1").json()[0]
        assert datetime.fromisoformat(audit["timestamp"]).utcoffset() is not None

    def test_safe_cascade_deletes_exclusive_record_and_detaches_shared_record(self):
        client = _make_client()
        first = client.post(
            "/api/v1/sources", json={"original_text": "无用来源"}
        ).json()
        second = client.post(
            "/api/v1/sources", json={"original_text": "保留来源"}
        ).json()
        exclusive = self._event(client, "独占记录", [first["id"]])
        shared = self._event(client, "共享记录", [first["id"], second["id"]])
        relation = client.post(
            "/api/v1/record-relations",
            json={
                "from_record_id": exclusive["id"],
                "to_record_id": shared["id"],
                "relation_type": "relates_to",
            },
        )
        assert relation.status_code == 201, relation.text

        impact = client.get(
            f"/api/v1/sources/{first['id']}/deletion-impact"
        ).json()
        assert impact["exclusive_records"] == 1
        assert impact["shared_records"] == 1
        assert impact["affected_relations"] == 1

        deleted = client.delete(f"/api/v1/sources/{first['id']}")
        assert deleted.status_code == 200, deleted.text
        assert client.get(f"/api/v1/records/{exclusive['id']}").status_code == 404
        kept = client.get(f"/api/v1/records/{shared['id']}")
        assert kept.status_code == 200
        assert [ref["source_id"] for ref in kept.json()["source_refs"]] == [second["id"]]
        assert client.get(f"/api/v1/sources/{first['id']}").status_code == 404
        source_audit = client.get(
            f"/api/v1/audit?target_table=source_entries&target_id={first['id']}"
        ).json()
        assert source_audit[0]["action"] == "delete"

    def test_content_addressed_file_is_removed_only_after_last_reference(self):
        client = _make_client()
        first = client.post("/api/v1/sources", json={"original_text": "图一"}).json()
        second = client.post("/api/v1/sources", json={"original_text": "图二"}).json()
        content = b"\x89PNG\r\n\x1a\n" + b"same-content"
        for source in (first, second):
            response = client.post(
                f"/api/v1/attachments?source_id={source['id']}",
                files={"file": ("same.png", io.BytesIO(content), "image/png")},
            )
            assert response.status_code == 201, response.text
        stored_files = list(client.app.state.storage_paths.attachment_originals.iterdir())
        assert len(stored_files) == 1

        first_delete = client.delete(f"/api/v1/sources/{first['id']}").json()
        assert first_delete["deleted_physical_files"] == 0
        assert stored_files[0].exists()
        second_delete = client.delete(f"/api/v1/sources/{second['id']}").json()
        assert second_delete["deleted_physical_files"] == 1
        assert not stored_files[0].exists()
