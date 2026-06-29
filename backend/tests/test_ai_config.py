from __future__ import annotations

import json
import uuid
from pathlib import Path

from app.core.config import SecretsConfig, _hash_password


def _config_dir(ai: dict) -> Path:
    config_dir = Path(__file__).parent / ".runtime" / uuid.uuid4().hex / "config"
    config_dir.mkdir(parents=True)
    (config_dir / "secrets.json").write_text(
        json.dumps(
            {
                "admin_password_hash": _hash_password("password"),
                "jwt_secret": bytes(50).hex(),
                "ai": ai,
            }
        ),
        encoding="utf-8",
    )
    return config_dir


def test_ai_config_without_key_effectively_disables_ai() -> None:
    config = SecretsConfig(
        _config_dir(
            {
                "enabled": True,
                "provider_order": ["deepseek", "mimo"],
                "providers": {},
            }
        )
    ).get_ai_config()

    assert config.enabled is False
    assert config.providers["deepseek"].model == "deepseek-v4-flash"
    assert config.providers["mimo"].auth_style == "api-key"


def test_environment_key_overrides_file(monkeypatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "environment-key")
    config = SecretsConfig(
        _config_dir(
            {
                "enabled": True,
                "provider_order": ["deepseek"],
                "timeout_seconds": 30,
                "providers": {"deepseek": {"api_key": "file-key"}},
            }
        )
    ).get_ai_config()

    assert config.enabled is True
    assert config.providers["deepseek"].api_key == "environment-key"
