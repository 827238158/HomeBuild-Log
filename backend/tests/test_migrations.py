from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

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

    assert revision == "0001_local_foundation"
