from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.paths import build_storage_paths
from app.health import DatabaseRevisionStatus
from app.main import create_app


@dataclass
class StubHealthChecker:
    database_ok: bool
    storage_ok: bool
    revision_ok: bool = True

    def database_revision_status(self) -> DatabaseRevisionStatus:
        return DatabaseRevisionStatus(
            current="0019_add_pitfall_logs" if self.revision_ok else "0015_merge_procurement",
            expected="0019_add_pitfall_logs",
            is_current=self.revision_ok,
        )

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
        "database_revision": {
            "status": "ok",
            "current": "0019_add_pitfall_logs",
            "expected": "0019_add_pitfall_logs",
        },
        "storage": {"status": "ok"},
    }


@pytest.mark.parametrize(
    ("database_ok", "storage_ok", "expected_details"),
    [
        (
            False,
            True,
            {"database": "unavailable", "database_revision": "ok", "storage": "ok"},
        ),
        (
            True,
            False,
            {"database": "ok", "database_revision": "ok", "storage": "unavailable"},
        ),
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


def test_health_rejects_outdated_database_revision(tmp_path: Path) -> None:
    with create_client(tmp_path, StubHealthChecker(True, True, False)) as client:
        response = client.get("/api/v1/health")

    body = response.json()
    assert response.status_code == 503
    assert body["code"] == "DATABASE_REVISION_MISMATCH"
    assert body["message"] == "数据库结构版本落后，请先完成数据库迁移。"
    assert body["details"] == {
        "database": "ok",
        "database_revision": "outdated",
        "storage": "ok",
    }
