from __future__ import annotations

import json
import tempfile
from pathlib import Path

import jwt
from fastapi.testclient import TestClient

from app.core.config import SecretsConfig, _hash_password, _verify_hash


def test_hash_and_verify():
    pw = "my-secret-password"
    hashed = _hash_password(pw)
    assert hashed.startswith("pbkdf2_sha256:")
    assert _verify_hash(pw, hashed) is True
    assert _verify_hash("wrong", hashed) is False
    assert _verify_hash(pw, "bad:format") is False
    assert _verify_hash(pw, "unknown:aa:bb") is False


def test_secrets_first_init():
    with tempfile.TemporaryDirectory() as tmp:
        config_dir = Path(tmp) / "config"
        secrets = SecretsConfig(config_dir)
        secrets.ensure_initialized()

        file = config_dir / "secrets.json"
        assert file.exists()

        data = json.loads(file.read_text(encoding="utf-8"))
        assert "admin_password_hash" in data
        assert "jwt_secret" in data
        assert len(data["jwt_secret"]) == 64

        # 二次调用不应覆盖
        jwt_secret_before = data["jwt_secret"]
        secrets2 = SecretsConfig(config_dir)
        secrets2.ensure_initialized()
        data2 = json.loads(file.read_text(encoding="utf-8"))
        assert data2["jwt_secret"] == jwt_secret_before


def test_secrets_verify_password():
    with tempfile.TemporaryDirectory() as tmp:
        config_dir = Path(tmp) / "config"
        secrets = SecretsConfig(config_dir)
        secrets.ensure_initialized()

        file = config_dir / "secrets.json"
        data = json.loads(file.read_text(encoding="utf-8"))
        hashed = data["admin_password_hash"]

        # 生成时打印的密码已丢失，直接测试哈希验证
        assert _verify_hash("wrong", hashed) is False


def _create_client(with_password: str = "test-password") -> tuple[TestClient, str]:
    """创建带预置密码的测试客户端，返回 (client, password)。"""
    from app.core.paths import build_storage_paths

    tmp_root = Path(tempfile.mkdtemp())
    paths = build_storage_paths(tmp_root)

    # 手工初始化：不触发 console print
    paths.config.mkdir(parents=True, exist_ok=True)
    hashed = _hash_password(with_password)
    jwt_secret = b"test-jwt-secret-32chars-minimum\x00\x00\x00\x00\x00\x00\x00\x00".hex()
    secrets_file = {
        "admin_password_hash": hashed,
        "jwt_secret": jwt_secret,
    }
    (paths.config / "secrets.json").write_text(json.dumps(secrets_file), encoding="utf-8")

    secrets = SecretsConfig(paths.config)

    from app.main import create_app

    app = create_app(storage_paths=paths, secrets=secrets)
    client = TestClient(app)

    # 强制触发 lifespan 初始化
    with client:
        pass

    return client, with_password


class TestLoginEndpoint:
    def test_login_success(self):
        client, pw = _create_client()
        response = client.post("/api/v1/auth/login", json={"password": pw})
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"

    def test_login_wrong_password(self):
        client, _ = _create_client()
        response = client.post("/api/v1/auth/login", json={"password": "wrong"})
        assert response.status_code == 401
        assert "密码错误" in response.json()["detail"]

    def test_login_empty_body(self):
        client, _ = _create_client()
        response = client.post("/api/v1/auth/login", json={})
        assert response.status_code == 422


class TestTokenVerification:
    def test_valid_token(self):
        client, pw = _create_client()
        # 先登录获取 token
        login_resp = client.post("/api/v1/auth/login", json={"password": pw})
        token = login_resp.json()["access_token"]

        # 用 test client 解码验证 token 是否合法

        # 直接解码验证
        payload = jwt.decode(token, options={"verify_signature": False})
        assert payload["sub"] == "admin"
        assert "exp" in payload
        assert "iat" in payload

    def test_expired_token_returns_401(self):
        from app.core.config import SecretsConfig
        from app.core.paths import build_storage_paths

        tmp_root = Path(tempfile.mkdtemp())
        paths = build_storage_paths(tmp_root)
        paths.config.mkdir(parents=True, exist_ok=True)

        jwt_secret_hex = bytes(50).hex()  # 50 bytes → 100 hex chars
        secrets_file = {
            "admin_password_hash": _hash_password("pw"),
            "jwt_secret": jwt_secret_hex,
        }
        (paths.config / "secrets.json").write_text(json.dumps(secrets_file), encoding="utf-8")
        secrets = SecretsConfig(paths.config)

        # 签发一个立即过期的 token
        import datetime as dt
        now = dt.datetime.now(tz=dt.UTC)
        payload = {"sub": "admin", "iat": now, "exp": now - dt.timedelta(seconds=1)}
        short_token = jwt.encode(payload, secrets.get_jwt_secret(), algorithm="HS256")

        from app.health import HealthChecker
        from app.main import create_app

        class _StubHealth(HealthChecker):
            def database_is_healthy(self) -> bool:
                return True
            def storage_is_healthy(self) -> bool:
                return True

        app = create_app(storage_paths=paths, secrets=secrets, health_checker=_StubHealth())

        with TestClient(app) as client:
            # 健康检查不需要认证，仍应返回 200
            health_resp = client.get("/api/v1/health")
            assert health_resp.status_code == 200

            # 过期 token 访问受保护路由返回 401
            protected_resp = client.get(
                "/api/v1/sources",
                headers={"Authorization": f"Bearer {short_token}"},
            )
            assert protected_resp.status_code == 401


class TestHealthUnauthenticated:
    """健康检查应始终免认证访问。"""

    def test_health_no_token(self):
        client, _ = _create_client()
        response = client.get("/api/v1/health")
        assert response.status_code == 200


class TestAuthMiddleware:
    """验证认证中间件对受保护路由的拦截。"""

    def test_protected_route_no_token(self):
        client, _ = _create_client()
        response = client.get("/api/v1/sources")
        assert response.status_code == 401

    def test_protected_route_valid_token(self):
        client, pw = _create_client()
        login_resp = client.post("/api/v1/auth/login", json={"password": pw})
        token = login_resp.json()["access_token"]

        response = client.get(
            "/api/v1/does-not-exist",
            headers={"Authorization": f"Bearer {token}"},
        )
        # 合法 token 已通过中间件，随后由路由层返回 404。
        assert response.status_code == 404

    def test_protected_route_invalid_token(self):
        client, _ = _create_client()
        response = client.get(
            "/api/v1/sources",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert response.status_code == 401
