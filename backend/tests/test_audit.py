from __future__ import annotations

import json
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import _hash_password
from app.core.paths import build_storage_paths


def _make_client() -> TestClient:
    """创建带认证和已迁移数据库的测试客户端。"""
    from app.core.config import SecretsConfig
    from app.db import Base, create_database_engine
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

    engine = create_database_engine(paths.database_file)
    Base.metadata.create_all(engine)
    engine.dispose()

    resp = client.post("/api/v1/auth/login", json={"password": "test-password"})
    token = resp.json()["access_token"]
    client.headers = {"Authorization": f"Bearer {token}"}
    return client


class TestAuditLogging:
    def test_source_creation_is_audited(self):
        client = _make_client()

        # 创建来源
        resp = client.post(
            "/api/v1/sources",
            json={"original_text": "测试审计日志"},
        )
        assert resp.status_code == 201
        source_id = resp.json()["id"]

        # 查询审计日志
        resp = client.get("/api/v1/audit?target_table=source_entries")
        assert resp.status_code == 200
        entries = resp.json()
        assert len(entries) >= 1

        entry = entries[0]
        assert entry["action"] == "create"
        assert entry["target_table"] == "source_entries"
        assert entry["target_id"] == source_id
        assert entry["after_json"]["original_text"] == "测试审计日志"

    def test_attachment_creation_is_audited(self):
        client = _make_client()

        import io
        resp = client.post(
            "/api/v1/attachments",
            files={"file": ("photo.jpg", io.BytesIO(b"\xff\xd8\xff" + b"\x00" * 50), "image/jpeg")},
        )
        assert resp.status_code == 201
        attachment_id = resp.json()["id"]

        resp = client.get("/api/v1/audit?target_table=attachments")
        assert resp.status_code == 200
        entries = resp.json()
        assert len(entries) >= 1
        assert entries[0]["action"] == "create"
        assert entries[0]["target_id"] == attachment_id

    def test_audit_list_respects_limit(self):
        client = _make_client()

        for i in range(3):
            client.post(
                "/api/v1/sources",
                json={"original_text": f"记录 {i}"},
            )

        resp = client.get("/api/v1/audit?limit=2")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_audit_filter_by_action(self):
        client = _make_client()

        client.post("/api/v1/sources", json={"original_text": "x"})

        resp = client.get("/api/v1/audit?action=create")
        assert resp.status_code == 200
        entries = resp.json()
        assert len(entries) >= 1
        # 至少包含刚创建的 source
        source_logs = [e for e in entries if e["target_table"] == "source_entries"]
        assert len(source_logs) >= 1

    def test_audit_entries_ordered_descending(self):
        client = _make_client()

        client.post("/api/v1/sources", json={"original_text": "第一条"})
        client.post("/api/v1/sources", json={"original_text": "第二条"})

        resp = client.get("/api/v1/audit?target_table=source_entries")
        entries = resp.json()
        assert len(entries) >= 2
        ts0 = entries[0]["timestamp"]
        ts1 = entries[1]["timestamp"]
        assert ts0 >= ts1  # 降序排列

    def test_audit_requires_auth(self):
        from app.core.config import SecretsConfig
        from app.main import create_app

        # 无 token 的独立客户端
        tmp_root = Path(tempfile.mkdtemp())
        paths2 = build_storage_paths(tmp_root)
        paths2.config.mkdir(parents=True, exist_ok=True)
        (paths2.config / "secrets.json").write_text(
            json.dumps({"admin_password_hash": _hash_password("pw"), "jwt_secret": bytes(50).hex()}),
            encoding="utf-8",
        )
        secrets2 = SecretsConfig(paths2.config)
        app2 = create_app(storage_paths=paths2, secrets=secrets2)

        with TestClient(app2) as client2:
            resp = client2.get("/api/v1/audit")
            assert resp.status_code == 401
