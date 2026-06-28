from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

import app.models  # noqa: F401 — 确保迁移可发现所有模型
from app.db import database_url


def test_migrations_upgrade_temporary_database_to_head(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_file = tmp_path / "migration-test.sqlite3"
    url = database_url(database_file)
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)

    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")

    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            revision = connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
    finally:
        engine.dispose()

    assert revision == "0005_add_record_origin_key"


def test_domain_migration_backfills_existing_sources_and_round_trips(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_file = tmp_path / "migration-existing.sqlite3"
    url = database_url(database_file)
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0003_add_audit")

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO source_entries "
                "(id, input_type, original_text, captured_at) "
                "VALUES ('legacy-source', 'text', '旧来源', CURRENT_TIMESTAMP)"
            )
        )
    engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        project_id = connection.execute(
            text("SELECT project_id FROM source_entries WHERE id='legacy-source'")
        ).scalar_one()
        project_name = connection.execute(
            text("SELECT name FROM projects WHERE id=:project_id"), {"project_id": project_id}
        ).scalar_one()
    engine.dispose()
    assert project_name == "我的装修"

    command.downgrade(config, "0003_add_audit")
    command.upgrade(config, "head")
