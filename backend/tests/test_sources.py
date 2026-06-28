from __future__ import annotations

import io
import json
import tempfile
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
