from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.health import router as health_router
from app.core.paths import StoragePaths, ensure_storage_directories, get_storage_paths
from app.db import create_database_engine
from app.health import HealthChecker, RuntimeHealthChecker


def create_app(
    *,
    storage_paths: StoragePaths | None = None,
    health_checker: HealthChecker | None = None,
) -> FastAPI:
    paths = storage_paths or get_storage_paths()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 启动时只初始化基础目录；数据库结构始终由 Alembic 管理。
        ensure_storage_directories(paths)
        engine = create_database_engine(paths.database_file)
        app.state.health_checker = health_checker or RuntimeHealthChecker(engine, paths)
        try:
            yield
        finally:
            engine.dispose()

    application = FastAPI(title="HomeBuild Log API", version="0.1.0", lifespan=lifespan)
    application.include_router(health_router, prefix="/api/v1")
    return application


app = create_app()

