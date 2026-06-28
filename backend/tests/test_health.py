from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.paths import build_storage_paths
from app.main import create_app


@dataclass
class StubHealthChecker:
    database_ok: bool
    storage_ok: bool

    def database_is_healthy(self) -> bool:
        return self.database_ok

    def storage_is_healthy(self) -> bool:
        return self.storage_ok


def create_client(tmp_path: Path, checker: StubHealthChecker) -> TestClient:
    app = create_app(
        storage_paths=build_storage_paths(tmp_path / ".local-data"),
        health_checker=checker,
    )
    return TestClient(app)


def test_health_reports_all_components_ok(tmp_path: Path) -> None:
    with create_client(tmp_path, StubHealthChecker(True, True)) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": {"status": "ok"},
        "storage": {"status": "ok"},
    }


@pytest.mark.parametrize(
    ("database_ok", "storage_ok", "expected_details"),
    [
        (False, True, {"database": "unavailable", "storage": "ok"}),
        (True, False, {"database": "ok", "storage": "unavailable"}),
    ],
)
def test_health_returns_safe_error_for_unavailable_component(
    tmp_path: Path,
    database_ok: bool,
    storage_ok: bool,
    expected_details: dict[str, str],
) -> None:
    with create_client(tmp_path, StubHealthChecker(database_ok, storage_ok)) as client:
        response = client.get("/api/v1/health")

    body = response.json()
    assert response.status_code == 503
    assert body["code"] == "LOCAL_SERVICE_UNAVAILABLE"
    assert body["details"] == expected_details
    assert body["retryable"] is True
    assert str(tmp_path) not in response.text

