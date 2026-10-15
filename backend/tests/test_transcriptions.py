from __future__ import annotations

import base64
import io
import json
import math
import struct
import wave
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import SecretsConfig, _hash_password
from app.core.paths import build_storage_paths
from app.main import create_app


def _wav(seconds: float = 1, amplitude: float = 0.1, active_seconds: float | None = None,
         dc_offset: float = 0) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16_000)
        # 合成音用于验证能量边界，不代表真实麦克风或人声识别验收。
        active_frames = int((seconds if active_seconds is None else active_seconds) * 16_000)
        audio.writeframes(b"".join(
            struct.pack("<h", round(32767 * (dc_offset + (
                amplitude * math.sin(2 * math.pi * 200 * index / 16_000)
                if index < active_frames else 0
            ))))
            for index in range(int(seconds * 16_000))
        ))
    return output.getvalue()


@pytest.fixture
def client(tmp_path) -> TestClient:
    paths = build_storage_paths(tmp_path)
    paths.config.mkdir(parents=True)
    (paths.config / "secrets.json").write_text(
        json.dumps(
            {
                "admin_password_hash": _hash_password("test-password"),
                "jwt_secret": bytes(50).hex(),
                "ai": {
                    "enabled": True,
                    "providers": {"mimo": {"api_key": "test-key"}},
                },
            }
        ),
        encoding="utf-8",
    )
    app = create_app(storage_paths=paths, secrets=SecretsConfig(paths.config))
    with TestClient(app) as test_client:
        token = test_client.post(
            "/api/v1/auth/login", json={"password": "test-password"}
        ).json()["access_token"]
        test_client.headers = {"Authorization": f"Bearer {token}"}
        yield test_client


def _post(client: TestClient, content: bytes | None = None):
    return client.post(
        "/api/v1/transcriptions",
        files={"file": ("recording.wav", content if content is not None else _wav(), "audio/wav")},
    )


def test_transcription_requires_authentication(client: TestClient) -> None:
    response = client.post(
        "/api/v1/transcriptions",
        headers={"Authorization": ""},
        files={"file": ("recording.wav", _wav(), "audio/wav")},
    )
    assert response.status_code == 401


def test_transcription_requires_mimo_v26_configuration(client: TestClient, monkeypatch) -> None:
    config = client.app.state.secrets.get_ai_config()
    changed = replace(
        config,
        providers={**config.providers, "mimo": replace(config.providers["mimo"], model="other")},
    )
    monkeypatch.setattr(client.app.state.secrets, "get_ai_config", lambda: changed)
    assert _post(client).status_code == 503


def test_transcription_uses_configured_mimo_and_returns_text(
    client: TestClient, monkeypatch
) -> None:
    captured = {}

    def fake_post(url, *, headers, json, timeout):
        captured.update(url=url, headers=headers, payload=json, timeout=timeout)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "今天买了 18 片瓷砖。"}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(client.app.state.ai_http_client, "post", fake_post)
    response = _post(client)
    assert response.status_code == 200, response.text
    assert response.json()["text"] == "今天买了 18 片瓷砖。"
    assert response.json()["duration_ms"] >= 0
    assert captured["url"] == "https://api.xiaomimimo.com/v1/chat/completions"
    assert captured["headers"] == {"api-key": "test-key"}
    assert captured["payload"]["model"] == "mimo-v2.6-pro"
    assert captured["payload"]["thinking"] == {"type": "disabled"}
    audio_data = captured["payload"]["messages"][1]["content"][0]["input_audio"]["data"]
    assert audio_data.startswith("data:audio/wav;base64,")
    assert base64.b64decode(audio_data.split(",", 1)[1]) == _wav()


@pytest.mark.parametrize(
    ("content", "expected_status"),
    [
        (b"not wave", 415),
        (b"", 413),
    ],
)
def test_transcription_rejects_invalid_audio(
    client: TestClient, content: bytes, expected_status: int
) -> None:
    assert _post(client, content).status_code == expected_status


def test_transcription_rejects_too_long_audio(client: TestClient) -> None:
    assert _post(client, _wav(181)).status_code == 413


def test_transcription_rejects_oversized_audio(client: TestClient) -> None:
    content = b"x" * (8 * 1024 * 1024 + 1)
    assert _post(client, content).status_code == 413


@pytest.mark.parametrize(
    ("failure", "expected_status"),
    [("empty", 422), ("invalid", 502), ("malformed", 502), ("timeout", 504), ("rate", 503)],
)
def test_transcription_reports_provider_failure(
    client: TestClient, monkeypatch, failure, expected_status
) -> None:
    def fake_post(url, **kwargs):
        request = httpx.Request("POST", url)
        if failure == "timeout":
            raise httpx.ReadTimeout("timed out", request=request)
        if failure == "rate":
            return httpx.Response(429, request=request)
        return httpx.Response(
            200,
            json={} if failure == "malformed" else {
                "choices": [{"message": {"content": None if failure == "invalid" else " "}}]
            },
            request=request,
        )

    monkeypatch.setattr(client.app.state.ai_http_client, "post", fake_post)
    response = _post(client)
    assert response.status_code == expected_status
    assert "test-key" not in response.text


@pytest.mark.parametrize("content", [
    _wav(amplitude=0),
    _wav(amplitude=0.0001),
    _wav(amplitude=0, dc_offset=0.1),
    _wav(active_seconds=0.02),
    _wav(seconds=0.1),
], ids=["silence", "near-silence", "dc-offset", "short-pulse", "too-short"])
def test_transcription_rejects_silence_without_provider_call(
    client: TestClient, monkeypatch, content: bytes
) -> None:
    def forbidden_post(*args, **kwargs):
        pytest.fail("无有效声音时不应调用转写服务")

    monkeypatch.setattr(client.app.state.ai_http_client, "post", forbidden_post)
    response = _post(client, content)
    assert response.status_code == 422
    assert response.json()["detail"] == "未检测到有效声音，请靠近麦克风重新录制。"


@pytest.mark.parametrize("content", [_wav(amplitude=0.002), _wav(seconds=0.12)],
                         ids=["quiet", "minimum-duration"])
def test_transcription_allows_quiet_audio_and_minimum_duration(
    client: TestClient, monkeypatch, content: bytes
) -> None:
    calls = []

    def fake_post(url, **kwargs):
        calls.append(url)
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "轻声内容"}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(client.app.state.ai_http_client, "post", fake_post)
    response = _post(client, content)
    assert response.status_code == 200
    assert response.json()["text"] == "轻声内容"
    assert len(calls) == 1


def test_transcription_does_not_persist_audio(client: TestClient, monkeypatch, tmp_path) -> None:
    def fake_post(url, **kwargs):
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "测试"}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(client.app.state.ai_http_client, "post", fake_post)
    _post(client)
    assert not list(tmp_path.rglob("*.wav"))
