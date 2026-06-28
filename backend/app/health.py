from __future__ import annotations

import os
from typing import Protocol

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.core.paths import StoragePaths


class HealthChecker(Protocol):
    def database_is_healthy(self) -> bool: ...

    def storage_is_healthy(self) -> bool: ...


class RuntimeHealthChecker:
    def __init__(self, engine: Engine, paths: StoragePaths) -> None:
        self._engine = engine
        self._paths = paths

    def database_is_healthy(self) -> bool:
        try:
            with self._engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return True
        except Exception:
            # 健康接口只报告组件状态，详细异常留给本地日志，避免泄露路径。
            return False

    def storage_is_healthy(self) -> bool:
        return all(path.is_dir() and os.access(path, os.W_OK) for path in self._paths.directories)

