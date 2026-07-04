from __future__ import annotations

import hashlib
import json
import math
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

CONFIG_FILE_NAME = "secrets.json"


@dataclass(frozen=True)
class AIProviderConfig:
    """单个 OpenAI 兼容供应商的有效配置。"""

    name: str
    base_url: str
    model: str
    auth_style: str
    api_key: str


@dataclass(frozen=True)
class AIConfig:
    """外部文本 AI 的运行时配置。"""

    enabled: bool
    provider_order: tuple[str, ...]
    timeout_seconds: float
    temperature: float
    providers: dict[str, AIProviderConfig]


DEFAULT_AI_CONFIG: dict[str, Any] = {
    "enabled": False,
    "provider_order": ["mimo", "deepseek"],
    "timeout_seconds": 30,
    "temperature": 0.3,
    "providers": {
        "deepseek": {
            "base_url": "https://api.deepseek.com",
            "model": "deepseek-v4-flash",
            "auth_style": "bearer",
            "api_key": "",
        },
        "mimo": {
            "base_url": "https://api.xiaomimimo.com/v1",
            "model": "mimo-v2.5-pro",
            "auth_style": "api-key",
            "api_key": "",
        },
    },
}


def _safe_float(value: object, default: float, minimum: float, maximum: float) -> float:
    """容错读取有限浮点数，错误配置不会阻断服务启动。"""
    if isinstance(value, bool):
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(parsed):
        return default
    return max(minimum, min(maximum, parsed))


def _safe_http_url(value: object, default: str) -> str:
    candidate = str(value).strip().rstrip("/") if value is not None else ""
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        return default.rstrip("/")
    return candidate


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
            "ai": DEFAULT_AI_CONFIG,
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

    def get_ai_config(self) -> AIConfig:
        """读取 AI 配置，并让环境变量中的 Key 覆盖文件值。"""
        data = self._load()
        raw_ai = data.get("ai")
        if not isinstance(raw_ai, dict):
            raw_ai = {}

        raw_order = raw_ai.get("provider_order", DEFAULT_AI_CONFIG["provider_order"])
        if not isinstance(raw_order, list):
            raw_order = DEFAULT_AI_CONFIG["provider_order"]
        known = DEFAULT_AI_CONFIG["providers"]
        provider_order = tuple(
            dict.fromkeys(
                item.strip().lower()
                for item in raw_order
                if isinstance(item, str) and item.strip().lower() in known
            )
        ) or tuple(DEFAULT_AI_CONFIG["provider_order"])
        raw_providers = raw_ai.get("providers")
        if not isinstance(raw_providers, dict):
            raw_providers = {}

        providers: dict[str, AIProviderConfig] = {}
        defaults_by_provider = DEFAULT_AI_CONFIG["providers"]
        for name in provider_order:
            defaults = defaults_by_provider.get(name)
            if not isinstance(defaults, dict):
                continue
            configured = raw_providers.get(name)
            if not isinstance(configured, dict):
                configured = {}
            api_key = os.getenv(f"{name.upper()}_API_KEY") or str(
                configured.get("api_key", defaults["api_key"])
            )
            providers[name] = AIProviderConfig(
                name=name,
                base_url=_safe_http_url(configured.get("base_url"), defaults["base_url"]),
                model=(str(configured.get("model", "")).strip() or defaults["model"]),
                auth_style=(
                    str(configured.get("auth_style", "")).strip().lower()
                    if str(configured.get("auth_style", "")).strip().lower()
                    in {"bearer", "api-key"}
                    else defaults["auth_style"]
                ),
                api_key=api_key.strip(),
            )

        requested_enabled = raw_ai.get("enabled") is True
        timeout_seconds = _safe_float(raw_ai.get("timeout_seconds"), 30.0, 1.0, 120.0)
        temperature = _safe_float(raw_ai.get("temperature"), 0.3, -2.0, 2.0)
        return AIConfig(
            enabled=requested_enabled and any(provider.api_key for provider in providers.values()),
            provider_order=provider_order,
            timeout_seconds=timeout_seconds,
            temperature=temperature,
            providers=providers,
        )

    def _load(self) -> dict[str, Any]:
        with open(self._file_path, encoding="utf-8") as f:
            return json.load(f)
