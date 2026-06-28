from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

import app.domain_models  # noqa: F401 — 加载阶段 2A 领域模型
import app.models  # noqa: F401 — 确保 Alembic 可发现所有模型表
from app.core.paths import ensure_storage_directories, get_storage_paths
from app.db import Base, database_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def configured_database_url() -> str:
    # 测试可覆盖 URL；正常运行始终使用项目根目录内的 SQLite。
    override_url = os.environ.get("HOMEBUILD_DATABASE_URL")
    if override_url:
        return override_url

    paths = get_storage_paths()
    ensure_storage_directories(paths)
    return database_url(paths.database_file)


def run_migrations_offline() -> None:
    context.configure(
        url=configured_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = configured_database_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
