from __future__ import annotations

import json
import tempfile
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai_adapter import (
    AIAdapterFailure,
    AIAdapterResult,
    AIExtractionDraft,
    OpenAICompatibleAdapter,
)
from app.core.config import AIProviderConfig, SecretsConfig, _hash_password
from app.core.paths import build_storage_paths, ensure_storage_directories
from app.db import Base, create_database_engine
from app.main import create_app


def _test_client(*, ai: dict | None = None) -> Iterator[TestClient]:
    root = Path(tempfile.mkdtemp(prefix="homebuild-phase3-"))
    paths = build_storage_paths(root)
    paths.config.mkdir(parents=True, exist_ok=True)
    data = {
        "admin_password_hash": _hash_password("test-password"),
        "jwt_secret": bytes(50).hex(),
    }
    if ai is not None:
        data["ai"] = ai
    (paths.config / "secrets.json").write_text(
        json.dumps(data, ensure_ascii=False),
        encoding="utf-8",
    )
    app = create_app(storage_paths=paths, secrets=SecretsConfig(paths.config))
    ensure_storage_directories(paths)
    engine = create_database_engine(paths.database_file)
    Base.metadata.create_all(engine)
    engine.dispose()
    with TestClient(app) as client:
        token = client.post(
            "/api/v1/auth/login", json={"password": "test-password"}
        ).json()["access_token"]
        client.headers = {"Authorization": f"Bearer {token}"}
        yield client


def _source(client: TestClient, text: str) -> str:
    response = client.post("/api/v1/sources", json={"original_text": text})
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.fixture
def client() -> Iterator[TestClient]:
    yield from _test_client()


def test_auto_without_key_persists_local_bundle_and_run(client: TestClient) -> None:
    source_id = _source(client, "选定18片花砖，共计1100元，已交500元。")

    response = client.post(f"/api/v1/sources/{source_id}/extractions?engine=auto")

    assert response.status_code == 201, response.text
    bundle = response.json()
    assert bundle["engine"] == "local-rule-v1"
    assert bundle["fallback_reason"] == "AI_NOT_CONFIGURED"
    assert bundle["suggestions"]
    runs = client.get(f"/api/v1/extraction-runs?source_id={source_id}").json()
    assert [(run["engine"], run["status"]) for run in runs] == [
        ("local-rule-v1", "succeeded")
    ]


def test_candidate_confirmation_is_atomic_and_idempotent(client: TestClient) -> None:
    text = "选定18片60*120cm花砖，共计1100元，已交500元，等待送货验收。"
    source_id = _source(client, text)
    bundle = client.post(
        f"/api/v1/sources/{source_id}/extractions?engine=local"
    ).json()
    explicit = [item for item in bundle["suggestions"] if item["certainty"] == "explicit"]
    body = {
        "expected_version": bundle["version"],
        "selections": [
            {"key": item["key"], "payload": item["payload"]} for item in explicit
        ],
    }
    first = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm", json=body
    )
    assert first.status_code == 200, first.text
    assert all(item["created"] for item in first.json()["records"])
    first_count = len(client.get(f"/api/v1/records?source_id={source_id}").json())
    reloaded = client.get(
        f"/api/v1/sources/{source_id}/candidate-bundles/latest"
    ).json()
    assert all(
        item["confirmed_record_id"]
        for item in reloaded["suggestions"]
        if item["key"] in {candidate["key"] for candidate in explicit}
    )

    second_body = {
        **body,
        "expected_version": first.json()["bundle"]["version"],
    }
    second = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm", json=second_body
    )
    assert second.status_code == 200, second.text
    assert all(not item["created"] for item in second.json()["records"])
    assert len(client.get(f"/api/v1/records?source_id={source_id}").json()) == first_count
    assert client.get(f"/api/v1/sources/{source_id}").json()["original_text"] == text


def test_source_edit_supersedes_bundle_and_rejects_stale_confirmation(
    client: TestClient,
) -> None:
    source_id = _source(client, "今天去现场查看。")
    bundle = client.post(
        f"/api/v1/sources/{source_id}/extractions?engine=local"
    ).json()
    candidate = bundle["suggestions"][0]

    updated = client.patch(
        f"/api/v1/sources/{source_id}",
        json={"original_text": "今天下午重新去现场查看。"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2
    assert client.get(f"/api/v1/candidate-bundles/{bundle['id']}").json()["status"] == "superseded"

    confirmation = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json={
            "expected_version": bundle["version"],
            "selections": [{"key": candidate["key"], "payload": candidate["payload"]}],
        },
    )
    assert confirmation.status_code == 409
    assert "重新加载" in confirmation.json()["detail"]


def test_deepseek_failure_falls_back_to_mimo_with_one_budget(monkeypatch) -> None:
    ai = {
        "enabled": True,
        "provider_order": ["deepseek", "mimo"],
        "timeout_seconds": 30,
        "temperature": 0.3,
        "providers": {
            "deepseek": {"api_key": "deep-key"},
            "mimo": {"api_key": "mimo-key"},
        },
    }
    calls: list[tuple[str, float]] = []

    def fake_extract(
        self: OpenAICompatibleAdapter,
        text: str,
        timeout_seconds: float,
    ) -> AIAdapterResult:
        calls.append((self.provider.name, timeout_seconds))
        if self.provider.name == "deepseek":
            raise AIAdapterFailure(
                "AI_TIMEOUT",
                "主引擎超时",
                prompt_text="safe prompt",
                duration_ms=5,
            )
        return AIAdapterResult(
            draft=AIExtractionDraft.model_validate(
                {
                    "suggestions": [
                        {
                            "ref": "e1",
                            "record_type": "event",
                            "summary": "现场查看",
                            "evidence": text,
                            "certainty": "explicit",
                            "payload": {
                                "record_type": "event",
                                "title": "现场查看",
                                "status": "occurred",
                                "event_kind": "site_visit",
                            },
                        }
                    ]
                }
            ),
            prompt_text="safe prompt",
            raw_response="{}",
            duration_ms=5,
            prompt_tokens=10,
            completion_tokens=20,
            total_tokens=30,
        )

    monkeypatch.setattr(OpenAICompatibleAdapter, "extract_from_text", fake_extract)
    test_client = _test_client(ai=ai)
    client = next(test_client)
    try:
        source_id = _source(client, "今天去现场查看。")

        response = client.post(f"/api/v1/sources/{source_id}/extractions?engine=auto")
        assert response.status_code == 201, response.text
        assert response.json()["engine"] == "mimo-v2.5-pro"
        assert calls[0][0] == "deepseek" and calls[1][0] == "mimo"
        assert 0 < calls[0][1] <= 15.1
        assert 0 < calls[1][1] <= 30
        runs = client.get(f"/api/v1/extraction-runs?source_id={source_id}").json()
        assert {run["status"] for run in runs} == {"failed", "succeeded"}
    finally:
        test_client.close()


@pytest.mark.parametrize(
    ("provider", "expected_header"),
    [
        (
            AIProviderConfig("deepseek", "https://example.test", "deep-model", "bearer", "secret"),
            ("authorization", "Bearer secret"),
        ),
        (
            AIProviderConfig("mimo", "https://example.test/v1", "mimo-model", "api-key", "secret"),
            ("api-key", "secret"),
        ),
    ],
)
def test_openai_adapter_uses_provider_auth_and_parses_json(
    provider: AIProviderConfig,
    expected_header: tuple[str, str],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers[expected_header[0]] == expected_header[1]
        request_body = json.loads(request.content)
        assert request_body["messages"][-1]["content"] == "只发送这段来源"
        assert "secret" not in request.content.decode()
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "suggestions": [
                                        {
                                            "ref": "t1",
                                            "record_type": "todo",
                                            "summary": "补资料",
                                            "evidence": "补资料",
                                            "certainty": "explicit",
                                            "payload": {
                                                "record_type": "todo",
                                                "title": "补资料",
                                                "status": "pending",
                                                "action": "补资料",
                                            },
                                            "missing_fields": [],
                                        }
                                    ],
                                    "relations": [],
                                    "questions": [],
                                    "warnings": [],
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 2,
                    "total_tokens": 3,
                },
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        result = OpenAICompatibleAdapter(
            provider,
            temperature=0.3,
            client=http_client,
        ).extract_from_text("只发送这段来源", 5)
    assert result.draft.suggestions[0].record_type == "todo"
    assert result.total_tokens == 3
