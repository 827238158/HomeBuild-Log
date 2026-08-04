from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.core.paths import build_storage_paths
from app.main import create_app


def _write_frontend(static_directory: Path) -> None:
    (static_directory / "assets").mkdir(parents=True)
    (static_directory / "index.html").write_text(
        "<!doctype html><title>HomeBuild Log</title>", encoding="utf-8"
    )
    (static_directory / "assets" / "app.js").write_text(
        "console.log('homebuild')", encoding="utf-8"
    )


def test_static_frontend_serves_root_assets_and_page_fallback(tmp_path: Path) -> None:
    static_directory = tmp_path / "dist"
    _write_frontend(static_directory)
    app = create_app(
        storage_paths=build_storage_paths(tmp_path / ".local-data"),
        static_directory=static_directory,
    )

    with TestClient(app) as client:
        root = client.get("/")
        asset = client.get("/assets/app.js")
        fallback = client.get("/records/example")

    assert root.status_code == 200
    assert "HomeBuild Log" in root.text
    assert asset.status_code == 200
    assert "homebuild" in asset.text
    assert fallback.status_code == 200
    assert "HomeBuild Log" in fallback.text


def test_static_frontend_does_not_hide_api_or_asset_404(tmp_path: Path) -> None:
    static_directory = tmp_path / "dist"
    _write_frontend(static_directory)
    app = create_app(
        storage_paths=build_storage_paths(tmp_path / ".local-data"),
        static_directory=static_directory,
    )

    with TestClient(app) as client:
        api_response = client.get("/api/v1/not-found")
        asset_response = client.get("/assets/missing.js")

    # 受保护的未知 API 仍先经过既有认证中间件，不得被静态页面接管。
    assert api_response.status_code == 401
    assert asset_response.status_code == 404
    assert "HomeBuild Log" not in api_response.text
    assert "HomeBuild Log" not in asset_response.text
