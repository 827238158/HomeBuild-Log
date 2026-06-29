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

    assert revision == "0008_add_default_root_space"

    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            root = connection.execute(
                text(
                    "SELECT name, kind, parent_id FROM spaces "
                    "WHERE project_id='00000000000000000000000000000001'"
                )
            ).one()
    finally:
        engine.dispose()
    assert root == ("整套房屋", "house", None)


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


def test_default_root_space_adopts_orphans_and_downgrades_cleanly(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_file = tmp_path / "migration-default-space.sqlite3"
    url = database_url(database_file)
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0007_add_candidate_bundles")

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO spaces "
                "(id, project_id, parent_id, name, kind, created_at, updated_at) "
                "VALUES ('legacy-room', '00000000000000000000000000000001', NULL, "
                "'旧主卧', 'room', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
    engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        parent_id = connection.execute(
            text("SELECT parent_id FROM spaces WHERE id='legacy-room'")
        ).scalar_one()
        root_name = connection.execute(
            text("SELECT name FROM spaces WHERE id=:id"),
            {"id": "00000000000000000000000000000002"},
        ).scalar_one()
    engine.dispose()
    assert parent_id == "00000000000000000000000000000002"
    assert root_name == "整套房屋"

    command.downgrade(config, "0007_add_candidate_bundles")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT parent_id FROM spaces WHERE id='legacy-room'")
        ).scalar_one() is None
        assert connection.execute(
            text("SELECT COUNT(*) FROM spaces WHERE id=:id"),
            {"id": "00000000000000000000000000000002"},
        ).scalar_one() == 0
    engine.dispose()


def test_default_root_space_does_not_duplicate_existing_house(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_file = tmp_path / "migration-existing-root.sqlite3"
    url = database_url(database_file)
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0007_add_candidate_bundles")

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO spaces "
                "(id, project_id, parent_id, name, kind, created_at, updated_at) "
                "VALUES ('existing-house', '00000000000000000000000000000001', NULL, "
                "'我的房屋', 'house', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
    engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        roots = connection.execute(
            text(
                "SELECT id FROM spaces WHERE project_id=:project_id "
                "AND kind='house' AND parent_id IS NULL"
            ),
            {"project_id": "00000000000000000000000000000001"},
        ).scalars().all()
    engine.dispose()
    assert roots == ["existing-house"]

    command.downgrade(config, "0007_add_candidate_bundles")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT COUNT(*) FROM spaces WHERE id='existing-house'")
        ).scalar_one() == 1
    engine.dispose()
