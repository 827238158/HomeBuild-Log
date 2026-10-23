from __future__ import annotations

import json
import tempfile
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from sqlalchemy.orm import Session

from app.ai_adapter import (
    AIAdapterFailure,
    AIAdapterResult,
    AIExtractionDraft,
    OpenAICompatibleAdapter,
)
from app.core.config import AIProviderConfig, SecretsConfig, _hash_password
from app.core.paths import build_storage_paths, ensure_storage_directories
from app.db import Base, create_database_engine
from app.domain_models import CandidateBundle
from app.main import create_app
from tests.record_context import confirmation_payload
from tests.versioned_client import VersionedTestClient as TestClient


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
    assert "questions" not in bundle

    # 历史 JSON 即使残留 questions，读取接口也必须过滤该废弃协议字段。
    with Session(client.app.state.engine) as db:
        stored = db.get(CandidateBundle, bundle["id"])
        assert stored is not None
        stored.bundle_json = {**stored.bundle_json, "questions": ["旧版追问"]}
        db.commit()
    legacy_bundle = client.get(f"/api/v1/candidate-bundles/{bundle['id']}").json()
    assert "questions" not in legacy_bundle
    runs = client.get(f"/api/v1/extraction-runs?source_id={source_id}").json()
    assert [(run["engine"], run["status"]) for run in runs] == [
        ("local-rule-v1", "succeeded")
    ]


@pytest.mark.parametrize(
    "evidence",
    [
        None,
        "不存在的摘录",
        "  \r\n ",
        "现场 查看",
        "原文 “今天去现场查看。”",
        "“今天去现场查看。”",
        "今天去现场查看；记录现场情况",
    ],
)
def test_legacy_candidates_confirm_without_excerpt_and_remain_idempotent(
    client: TestClient, evidence: str | None,
) -> None:
    source_id = _source(client, "今天去现场查看。\r\n记录现场情况。")
    bundle = client.post(f"/api/v1/sources/{source_id}/extractions?engine=local").json()
    candidate = bundle["suggestions"][0]
    with Session(client.app.state.engine) as db:
        stored = db.get(CandidateBundle, bundle["id"])
        content = dict(stored.bundle_json)
        content["suggestions"] = [dict(item) for item in content["suggestions"]]
        legacy = content["suggestions"][0]
        if evidence is None:
            legacy.pop("evidence", None)
        else:
            legacy["evidence"] = evidence
        legacy["evidence_validation"] = "invalid"
        stored.bundle_json = content
        db.commit()
    loaded = client.get(f"/api/v1/candidate-bundles/{bundle['id']}").json()
    assert "evidence_validation" not in loaded["suggestions"][0]
    body = {"expected_version": bundle["version"], "selections": [{"key": candidate["key"]}]}
    confirmed = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(
            client, f"/api/v1/candidate-bundles/{bundle['id']}/confirm", body
        ),
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["bundle"]["suggestions"][0]["key"] == candidate["key"]
    records = client.get(f"/api/v1/records?source_id={source_id}").json()
    assert len(records) == 1
    assert records[0]["source_refs"][0]["source_id"] == source_id
    assert records[0]["source_refs"][0]["evidence_excerpt"] is None
    # 旧客户端仍可带摘录，但它不影响候选身份、来源或重复确认。
    body["selections"][0]["evidence"] = "另一个无须匹配原文的兼容字段"
    body["expected_version"] = confirmed.json()["bundle"]["version"]
    repeated = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(
            client, f"/api/v1/candidate-bundles/{bundle['id']}/confirm", body
        ),
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["records"][0]["created"] is False
    assert len(client.get(f"/api/v1/records?source_id={source_id}").json()) == 1

@pytest.mark.parametrize(
    "error_type", [httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError]
)
def test_adapter_wraps_network_failures_without_leaking_credentials(error_type) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error_type("secret-key-in-exception", request=request)
    provider = AIProviderConfig("mimo", "https://example.test", "model", "api-key", "secret")
    with httpx.Client(transport=httpx.MockTransport(handler)) as transport:
        adapter = OpenAICompatibleAdapter(provider, temperature=0.3, client=transport)
        with pytest.raises(AIAdapterFailure) as failure:
            adapter.extract_from_text("来源文字", 5)
    assert failure.value.code == "AI_NETWORK_ERROR"
    assert "secret" not in str(failure.value)


@pytest.mark.parametrize("backup_succeeds", [True, False])
def test_real_network_error_uses_backup_or_local_and_persists_failures(backup_succeeds) -> None:
    ai = {
        "enabled": True, "provider_order": ["mimo", "deepseek"], "timeout_seconds": 30,
        "providers": {"mimo": {"api_key": "mimo-key"}, "deepseek": {"api_key": "deep-key"}},
    }
    calls: list[float] = []
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.extensions["timeout"]["read"])
        if len(calls) == 1 or not backup_succeeds:
            raise httpx.ConnectError("连接失败", request=request)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": '{"suggestions": []}'}}],
        })
    generator = _test_client(ai=ai)
    client = next(generator)
    try:
        with httpx.Client(transport=httpx.MockTransport(handler)) as transport:
            client.app.state.ai_http_client.close()
            client.app.state.ai_http_client = transport
            source_id = _source(client, "今天去现场查看。")
            response = client.post(f"/api/v1/sources/{source_id}/extractions?engine=auto")
            assert response.status_code == 201, response.text
            assert "mimo:AI_NETWORK_ERROR" in response.json()["fallback_reason"]
            if not backup_succeeds:
                assert response.json()["engine"] == "local-rule-v1"
            runs = client.get(f"/api/v1/extraction-runs?source_id={source_id}").json()
            failed = [run for run in runs if run["status"] == "failed"]
            assert len(failed) == (1 if backup_succeeds else 2)
            assert all(run["error_code"] == "AI_NETWORK_ERROR" for run in failed)
            assert len(calls) == 2 and sum(calls) <= 45
    finally:
        generator.close()


def test_partial_confirmation_relation_invalidates_existing_record_edit(client: TestClient) -> None:
    source_id = _source(client, "今天去现场查看。")
    bundle = client.post(f"/api/v1/sources/{source_id}/extractions?engine=local").json()
    first = bundle["suggestions"][0]
    with Session(client.app.state.engine) as db:
        stored = db.get(CandidateBundle, bundle["id"])
        second = {**first, "key": "second-event", "confirmed_record_id": None}
        stored.bundle_json = {
            **stored.bundle_json, "suggestions": [first, second],
            "relations": [{"from_key": first["key"], "to_key": second["key"]}],
        }
        db.commit()
    first_result = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(
            client,
            f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
            {
                "expected_version": bundle["version"],
                "selections": [{"key": first["key"]}],
            },
        ),
    )
    assert first_result.status_code == 200, first_result.text
    record = first_result.json()["records"][0]["record"]
    second_result = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(
            client,
            f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
            {
                "expected_version": first_result.json()["bundle"]["version"],
                "selections": [{"key": second["key"]}],
            },
        ),
    )
    assert second_result.status_code == 200, second_result.text
    latest = client.get(f"/api/v1/records/{record['id']}").json()
    assert latest["version"] > record["version"]
    assert latest["related_record_ids"]
    stale = client.patch(f"/api/v1/records/{record['id']}", json={
        "record_type": record["record_type"],
        "expected_version": record["version"], "related_record_ids": [],
    })
    assert stale.status_code == 409, stale.text
    assert client.get(f"/api/v1/records/{record['id']}").json()["related_record_ids"]


def test_candidate_confirmation_is_atomic_and_idempotent(client: TestClient) -> None:
    text = "选定18片60*120cm花砖，共计1100元，已交500元，等待送货验收。"
    source_id = _source(client, text)
    bundle = client.post(
        f"/api/v1/sources/{source_id}/extractions?engine=local"
    ).json()
    explicit = [item for item in bundle["suggestions"] if item["certainty"] == "explicit"]
    vendor_id = client.post("/api/v1/vendors", json={"name": "候选交易对象"}).json()["id"]
    for item in explicit:
        if item["record_type"] == "ledger":
            item["payload"]["vendor_id"] = vendor_id
        if item["record_type"] == "issue":
            item["payload"]["severity"] = "low"
    body = {
        "expected_version": bundle["version"],
        "selections": [
            {"key": item["key"], "payload": item["payload"]} for item in explicit
        ],
        "relations": [
            {"from_key": explicit[0]["key"], "to_key": explicit[1]["key"]}
        ] if len(explicit) > 1 else [],
    }
    first = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(
            client, f"/api/v1/candidate-bundles/{bundle['id']}/confirm", body
        ),
    )
    assert first.status_code == 200, first.text
    assert all(item["created"] for item in first.json()["records"])
    if len(explicit) > 1:
        assert first.json()["relations"][0]["relation_type"] == "relates_to"
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
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(
            client, f"/api/v1/candidate-bundles/{bundle['id']}/confirm", second_body
        ),
    )
    assert second.status_code == 200, second.text
    assert all(not item["created"] for item in second.json()["records"])
    assert len(client.get(f"/api/v1/records?source_id={source_id}").json()) == first_count
    assert client.get(f"/api/v1/sources/{source_id}").json()["original_text"] == text


def test_confirmation_respects_manual_candidate_type_change(client: TestClient) -> None:
    source_id = _source(client, "待现场规划壁龛如何铺贴，是花砖还是普通砖。")
    bundle = client.post(
        f"/api/v1/sources/{source_id}/extractions?engine=local"
    ).json()
    research = next(
        item for item in bundle["suggestions"] if item["record_type"] == "research"
    )
    issue_payload = {
        "record_type": "issue",
        "title": "现场铺贴方案待确认",
        "status": "pending",
        "phenomenon": "壁龛铺贴方案尚未确认",
        "handling_plan": "现场确认使用花砖还是普通砖",
        "severity": "medium",
    }

    response = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(client, f"/api/v1/candidate-bundles/{bundle['id']}/confirm", {
            "expected_version": bundle["version"],
            "selections": [{"key": research["key"], "payload": issue_payload}],
        }),
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["records"][0]["record"]["record_type"] == "issue"
    assert result["records"][0]["record"]["phenomenon"] == issue_payload["phenomenon"]
    confirmed = next(
        item
        for item in result["bundle"]["suggestions"]
        if item["key"] == research["key"]
    )
    assert confirmed["record_type"] == "issue"
    assert confirmed["type_label"] == "待办与问题"
    assert confirmed["payload"]["record_type"] == "issue"


def test_confirmation_atomically_ignores_unselected_candidates(client: TestClient) -> None:
    source_id = _source(
        client,
        "今天选定18片60*120cm花砖，共计1100元，已交500元，等待送货验收。",
    )
    bundle = client.post(
        f"/api/v1/sources/{source_id}/extractions?engine=local"
    ).json()
    selected = next(item for item in bundle["suggestions"] if item["certainty"] == "explicit")
    if selected["record_type"] == "ledger":
        selected["payload"]["vendor_id"] = client.post(
            "/api/v1/vendors", json={"name": "确认测试交易对象"}
        ).json()["id"]
    if selected["record_type"] == "issue":
        selected["payload"]["severity"] = "low"
    ignored_keys = [
        item["key"] for item in bundle["suggestions"] if item["key"] != selected["key"]
    ]

    response = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(client, f"/api/v1/candidate-bundles/{bundle['id']}/confirm", {
            "expected_version": bundle["version"],
            "selections": [{"key": selected["key"], "payload": selected["payload"]}],
            "ignored_keys": ignored_keys,
        }),
    )

    assert response.status_code == 200, response.text
    by_key = {item["key"]: item for item in response.json()["bundle"]["suggestions"]}
    assert by_key[selected["key"]]["review_state"] == "confirmed"
    assert all(by_key[key]["review_state"] == "deferred" for key in ignored_keys)


def test_deferred_candidate_stays_removed_and_cannot_be_confirmed(client: TestClient) -> None:
    source_id = _source(client, "今天去现场查看。")
    bundle = client.post(
        f"/api/v1/sources/{source_id}/extractions?engine=local"
    ).json()
    candidate = bundle["suggestions"][0]
    before_defer = next(
        item for item in client.get("/api/v1/sources").json() if item["id"] == source_id
    )
    assert before_defer["analysis_status"] == "pending"
    assert before_defer["pending_candidate_count"] == len(bundle["suggestions"])
    assert before_defer["generated_record_count"] == 0

    deferred = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/suggestions/{candidate['key']}/defer",
        json={"expected_version": bundle["version"]},
    )
    assert deferred.status_code == 200, deferred.text
    data = deferred.json()
    assert data["version"] == bundle["version"] + 1
    assert data["suggestions"][0]["review_state"] == "deferred"
    assert data["status"] == "reviewed"
    source_row = next(
        item for item in client.get("/api/v1/sources").json() if item["id"] == source_id
    )
    assert source_row["analysis_status"] == "reviewed"
    assert source_row["pending_candidate_count"] == 0
    assert source_row["confirmed_candidate_count"] == 0
    assert source_row["ignored_candidate_count"] == 1
    latest = client.get(
        f"/api/v1/sources/{source_id}/candidate-bundles/latest"
    ).json()
    assert latest["suggestions"][0]["review_state"] == "deferred"

    rejected = client.post(
        f"/api/v1/candidate-bundles/{bundle['id']}/confirm",
        json=confirmation_payload(client, f"/api/v1/candidate-bundles/{bundle['id']}/confirm", {
            "expected_version": data["version"],
            "selections": [{"key": candidate["key"], "payload": candidate["payload"]}],
        }),
    )
    assert rejected.status_code == 409


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
        json=confirmation_payload(client, f"/api/v1/candidate-bundles/{bundle['id']}/confirm", {
            "expected_version": bundle["version"],
            "selections": [{"key": candidate["key"], "payload": candidate["payload"]}],
        }),
    )
    assert confirmation.status_code == 409
    assert "重新加载" in confirmation.json()["detail"]


@pytest.mark.parametrize("requested_engine", ["auto", "ai"])
def test_deepseek_failure_falls_back_to_mimo_with_one_budget(
    monkeypatch, requested_engine: str
) -> None:
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
        **_context: str,
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

        response = client.post(
            f"/api/v1/sources/{source_id}/extractions?engine={requested_engine}"
        )
        assert response.status_code == 201, response.text
        assert response.json()["engine"] == "mimo-v2.6-pro"
        candidate = response.json()["suggestions"][0]
        assert candidate["payload"]["occurred_date"] is not None
        assert candidate["payload"]["original_time_text"] == "今天"
        assert candidate["evidence"] == ""
        confirmed = client.post(
            f"/api/v1/candidate-bundles/{response.json()['id']}/confirm",
            json=confirmation_payload(
                client, f"/api/v1/candidate-bundles/{response.json()['id']}/confirm", {
                    "expected_version": response.json()["version"],
                    "selections": [{"key": candidate["key"]}],
                },
            ),
        )
        assert confirmed.status_code == 200, confirmed.text
        record = confirmed.json()["records"][0]["record"]
        assert record["source_refs"][0]["source_id"] == source_id
        assert record["source_refs"][0]["evidence_excerpt"] is None
        assert calls[0][0] == "deepseek" and calls[1][0] == "mimo"
        assert 0 < calls[0][1] <= 15.1
        assert 0 < calls[1][1] <= 30
        runs = client.get(f"/api/v1/extraction-runs?source_id={source_id}").json()
        assert {run["status"] for run in runs} == {"failed", "succeeded"}
    finally:
        test_client.close()


@pytest.mark.parametrize("selected_provider", ["mimo", "deepseek"])
def test_selected_model_only_calls_requested_provider(monkeypatch, selected_provider: str) -> None:
    other_provider = "deepseek" if selected_provider == "mimo" else "mimo"
    ai = {
        "enabled": True,
        "provider_order": [other_provider],
        "providers": {
            "mimo": {"api_key": "mimo-key"},
            "deepseek": {"api_key": "deep-key"},
        },
    }
    calls: list[str] = []

    def fake_extract(
        self: OpenAICompatibleAdapter,
        text: str,
        timeout_seconds: float,
        **_context: str,
    ) -> AIAdapterResult:
        calls.append(self.provider.name)
        return AIAdapterResult(
            draft=AIExtractionDraft(),
            prompt_text="safe prompt",
            raw_response="{}",
            duration_ms=5,
            prompt_tokens=None,
            completion_tokens=None,
            total_tokens=None,
        )

    monkeypatch.setattr(OpenAICompatibleAdapter, "extract_from_text", fake_extract)
    test_client = _test_client(ai=ai)
    client = next(test_client)
    try:
        source_id = _source(client, "已到现场查看。")
        response = client.post(
            f"/api/v1/sources/{source_id}/extractions?engine={selected_provider}"
        )

        assert response.status_code == 201, response.text
        assert response.json()["requested_engine"] == selected_provider
        configured_model = (
            client.app.state.secrets.get_ai_config().providers[selected_provider].model
        )
        assert response.json()["engine"] == configured_model
        assert calls == [selected_provider]
        runs = client.get(f"/api/v1/extraction-runs?source_id={source_id}").json()
        assert [(run["provider"], run["status"]) for run in runs] == [
            (selected_provider, "succeeded")
        ]
    finally:
        test_client.close()


@pytest.mark.parametrize("selected_provider", ["mimo", "deepseek"])
def test_selected_model_failure_does_not_switch_or_use_local(
    monkeypatch, selected_provider: str
) -> None:
    ai = {
        "enabled": True,
        "provider_order": ["mimo", "deepseek"],
        "providers": {
            "mimo": {"api_key": "mimo-key"},
            "deepseek": {"api_key": "deep-key"},
        },
    }
    calls: list[str] = []

    def fake_extract(
        self: OpenAICompatibleAdapter,
        text: str,
        timeout_seconds: float,
        **_context: str,
    ) -> AIAdapterResult:
        calls.append(self.provider.name)
        raise AIAdapterFailure("AI_TIMEOUT", "供应商超时", prompt_text="safe prompt")

    monkeypatch.setattr(OpenAICompatibleAdapter, "extract_from_text", fake_extract)
    test_client = _test_client(ai=ai)
    client = next(test_client)
    try:
        source_id = _source(client, "已到现场查看。")
        response = client.post(
            f"/api/v1/sources/{source_id}/extractions?engine={selected_provider}"
        )

        assert response.status_code == 503
        assert f"{selected_provider}:AI_TIMEOUT" in response.json()["detail"]
        assert calls == [selected_provider]
        runs = client.get(f"/api/v1/extraction-runs?source_id={source_id}").json()
        assert [(run["provider"], run["status"]) for run in runs] == [
            (selected_provider, "failed")
        ]
    finally:
        test_client.close()


def test_selected_unconfigured_model_reports_error_without_fallback(monkeypatch) -> None:
    ai = {
        "enabled": True,
        "provider_order": ["mimo", "deepseek"],
        "providers": {"mimo": {"api_key": "mimo-key"}},
    }

    def unexpected_extract(*_args, **_kwargs) -> None:
        pytest.fail("未配置的指定模型不应调用其他供应商")

    monkeypatch.setattr(OpenAICompatibleAdapter, "extract_from_text", unexpected_extract)
    test_client = _test_client(ai=ai)
    client = next(test_client)
    try:
        source_id = _source(client, "已到现场查看。")
        response = client.post(f"/api/v1/sources/{source_id}/extractions?engine=deepseek")

        assert response.status_code == 503
        assert "AI_NOT_CONFIGURED" in response.json()["detail"]
        assert client.get(f"/api/v1/extraction-runs?source_id={source_id}").json() == []
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
        assert "原始文字：只发送这段来源" in request_body["messages"][-1]["content"]
        assert "时区：Asia/Shanghai" in request_body["messages"][-1]["content"]
        # 新协议只提取业务字段，不再要求用户核对摘录。
        system_prompt = request_body["messages"][0]["content"]
        assert "不需要输出 evidence、原文摘录或原文对照" in system_prompt
        assert "连续片段" not in system_prompt
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
                                            "record_type": "issue",
                                            "summary": "补资料",
                                            "certainty": "explicit",
                                            "payload": {
                                                "record_type": "issue",
                                                "title": "补资料",
                                                "status": "pending",
                                                "phenomenon": "补资料",
                                                "severity": "low",
                                            },
                                            "missing_fields": [],
                                        }
                                    ],
                                    "relations": [],
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
    assert result.draft.suggestions[0].record_type == "issue"
    assert result.total_tokens == 3
