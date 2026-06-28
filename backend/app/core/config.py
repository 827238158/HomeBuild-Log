from __future__ import annotations

import hashlib
import json
import os
import secrets
from pathlib import Path

CONFIG_FILE_NAME = "secrets.json"


def _hash_password(password: str) -> str:
    """使用 PBKDF2-HMAC-SHA256 生成密码哈希，返回 `algorithm:salt:hash` 格式。"""
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000, dklen=32)
    salt_hex = salt.hex()
    key_hex = key.hex()
    return f"pbkdf2_sha256:{salt_hex}:{key_hex}"


def _verify_hash(password: str, stored: str) -> bool:
    """验证密码与存储的哈希是否匹配。"""
    try:
        algorithm, salt_hex, key_hex = stored.split(":", 2)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = bytes.fromhex(salt_hex)
        stored_key = bytes.fromhex(key_hex)
        computed_key = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, 600_000, dklen=32
        )
        return secrets.compare_digest(computed_key, stored_key)
    except (ValueError, AttributeError):
        return False


class SecretsConfig:
    """管理本地管理员密码和 JWT 签发的机密配置。

    首次启动时自动生成管理员密码和 JWT 密钥，并打印密码到控制台。
    """

    def __init__(self, config_dir: Path) -> None:
        self._config_dir = config_dir
        self._file_path = config_dir / CONFIG_FILE_NAME

    def ensure_initialized(self) -> None:
        """确保机密文件存在；首次调用时生成并保存初始密码。"""
        if self._file_path.exists():
            return

        admin_password = secrets.token_hex(16)
        jwt_secret = secrets.token_hex(32)

        data = {
            "admin_password_hash": _hash_password(admin_password),
            "jwt_secret": jwt_secret,
        }

        self._config_dir.mkdir(parents=True, exist_ok=True)
        with open(self._file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        print(f"\n{'=' * 60}")
        print("  HomeBuild Log 管理员密码（首次自动生成）")
        print(f"  {admin_password}")
        print("  请妥善保存，或后续手动修改 secrets.json 中的密码哈希。")
        print(f"{'=' * 60}\n")

    def verify_password(self, password: str) -> bool:
        """验证管理员密码。"""
        data = self._load()
        return _verify_hash(password, data["admin_password_hash"])

    def get_jwt_secret(self) -> str:
        """返回 JWT 签发密钥。"""
        return self._load()["jwt_secret"]

    def _load(self) -> dict[str, str]:
        with open(self._file_path, encoding="utf-8") as f:
            return json.load(f)
