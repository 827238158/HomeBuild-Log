from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.core.paths import PROJECT_ROOT, StoragePaths


@dataclass(frozen=True)
class DatabaseRevisionStatus:
    current: str | None
    expected: str | None
    is_current: bool


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

    def database_revision_status(self) -> DatabaseRevisionStatus:
        try:
            config = Config(str(PROJECT_ROOT / "backend" / "alembic.ini"))
            expected = ScriptDirectory.from_config(config).get_current_head()
            with self._engine.connect() as connection:
                current = MigrationContext.configure(connection).get_current_revision()
            return DatabaseRevisionStatus(
                current=current,
                expected=expected,
                is_current=current is not None and current == expected,
            )
        except Exception:
            # 路径或迁移链异常同样视为 schema 不可信，具体异常只保留在本地日志。
            return DatabaseRevisionStatus(current=None, expected=None, is_current=False)

    def storage_is_healthy(self) -> bool:
        return all(path.is_dir() and os.access(path, os.W_OK) for path in self._paths.directories)
