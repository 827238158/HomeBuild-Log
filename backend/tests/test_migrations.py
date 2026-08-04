from __future__ import annotations

import json
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

    assert revision == "0018_unify_relations"

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


def test_relation_migration_normalizes_direction_and_merges_duplicates(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_file = tmp_path / "migration-relations.sqlite3"
    url = database_url(database_file)
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0017_remove_purchase_orders")

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO records "
            "(id, project_id, record_type, title, timezone, status, created_at, updated_at) VALUES "
            "('record-a', '00000000000000000000000000000001', 'event', '甲', "
            "'Asia/Shanghai', 'occurred', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
            "('record-b', '00000000000000000000000000000001', 'issue', '乙', "
            "'Asia/Shanghai', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        connection.execute(text(
            "INSERT INTO record_relations "
            "(id, project_id, from_record_id, to_record_id, relation_type, created_at) VALUES "
            "('relation-oldest', '00000000000000000000000000000001', "
            "'record-b', 'record-a', 'implements', '2026-01-01 00:00:00'), "
            "('relation-reverse', '00000000000000000000000000000001', "
            "'record-a', 'record-b', 'resolves', '2026-01-02 00:00:00'), "
            "('relation-type', '00000000000000000000000000000001', "
            "'record-b', 'record-a', 'relates_to', '2026-01-03 00:00:00')"
        ))
    engine.dispose()

    command.upgrade(config, "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        rows = connection.execute(text(
            "SELECT id, from_record_id, to_record_id, relation_type FROM record_relations"
        )).all()
    engine.dispose()
    assert rows == [("relation-oldest", "record-a", "record-b", "relates_to")]


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
        source_revision, updated_at = connection.execute(
            text(
                "SELECT revision, updated_at FROM source_entries "
                "WHERE id='legacy-source'"
            )
        ).one()
    engine.dispose()
    assert project_name == "我的装修"
    assert source_revision == 1
    assert updated_at is not None

    command.downgrade(config, "0003_add_audit")
    command.upgrade(config, "head")


def test_business_time_migration_uses_beijing_calendar_date(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_file = tmp_path / "migration-business-dates.sqlite3"
    url = database_url(database_file)
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0012_issue_resolution_times")

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO records "
            "(id, project_id, record_type, title, timezone, status, created_at, updated_at) "
            "VALUES "
            "('date-issue', '00000000000000000000000000000001', 'issue', '日期问题', "
            "'Asia/Shanghai', 'open', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
            "('date-todo', '00000000000000000000000000000001', 'todo', '日期待办', "
            "'Asia/Shanghai', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ))
        connection.execute(text(
            "INSERT INTO issue_details "
            "(record_id, phenomenon, expected_resolution_at, resolved_at) VALUES "
            "('date-issue', '测试', '2026-06-30 16:30:00', '2026-06-30 15:30:00')"
        ))
        connection.execute(text(
            "INSERT INTO todo_details (record_id, action, due_at, completed_at) VALUES "
            "('date-todo', '测试', '2026-07-01 16:30:00', '2026-07-01 15:30:00')"
        ))
    engine.dispose()

    command.upgrade(config, "0013_business_times_dates")
    engine = create_engine(url)
    with engine.connect() as connection:
        issue_dates = connection.execute(text(
            "SELECT expected_resolution_at, resolved_at FROM issue_details "
            "WHERE record_id='date-issue'"
        )).one()
        todo_dates = connection.execute(text(
            "SELECT due_at, completed_at FROM todo_details WHERE record_id='date-todo'"
        )).one()
        issue_types = {
            row[1]: row[2]
            for row in connection.execute(text("PRAGMA table_info(issue_details)"))
        }
        todo_types = {
            row[1]: row[2]
            for row in connection.execute(text("PRAGMA table_info(todo_details)"))
        }
    engine.dispose()

    assert issue_dates == ("2026-07-01", "2026-06-30")
    assert todo_dates == ("2026-07-02", "2026-07-01")
    assert issue_types["expected_resolution_at"] == "DATE"
    assert issue_types["resolved_at"] == "DATE"
    assert todo_types["due_at"] == "DATE"
    assert todo_types["completed_at"] == "DATE"


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


def test_occurred_month_migration_converts_records_and_candidate_json(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_file = tmp_path / "migration-occurred-month.sqlite3"
    url = database_url(database_file)
    monkeypatch.setenv("HOMEBUILD_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "0009_add_source_maintenance")

    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO source_entries "
            "(id, project_id, input_type, original_text, captured_at, updated_at, revision) "
            "VALUES ('month-source', '00000000000000000000000000000001', 'text', "
            "'跨月测试', '2026-06-30 16:00:00', '2026-06-30 16:00:00', 1)"
        ))
        connection.execute(text(
            "INSERT INTO records "
            "(id, project_id, record_type, title, occurred_at, time_precision, timezone, "
            "status, created_at, updated_at) VALUES "
            "('month-record', '00000000000000000000000000000001', 'event', '跨月事件', "
            "'2026-06-30 16:30:00', 'exact', 'Asia/Shanghai', 'occurred', "
            "'2026-06-30 16:30:00', '2026-06-30 16:30:00')"
        ))
        connection.execute(text(
            "INSERT INTO event_details (record_id, event_kind) "
            "VALUES ('month-record', 'site_visit')"
        ))
        connection.execute(text(
            "INSERT INTO extraction_runs "
            "(id, request_id, source_id, attempt_no, requested_engine, engine, status, "
            "started_at, finished_at, duration_ms) VALUES "
            "('month-run', 'month-request', 'month-source', 1, 'local', 'local-rule-v1', "
            "'succeeded', '2026-06-30 16:00:00', '2026-06-30 16:00:00', 1)"
        ))
        content = json.dumps({
            "suggestions": [{
                "key": "event:1",
                "payload": {
                    "occurred_at": "2026-06-30T16:30:00+00:00",
                    "time_precision": "exact",
                },
            }],
        })
        connection.execute(text(
            "INSERT INTO candidate_bundles "
            "(id, source_id, extraction_run_id, engine, status, version, bundle_json, "
            "created_at, updated_at, source_revision) VALUES "
            "('month-bundle', 'month-source', 'month-run', 'local-rule-v1', 'pending', 1, "
            ":content, '2026-06-30 16:00:00', '2026-06-30 16:00:00', 1)"
        ), {"content": content})
    engine.dispose()

    command.upgrade(config, "0010_occurred_month")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT occurred_month FROM records WHERE id='month-record'"
        )).scalar_one() == "2026-07"
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(records)"))
        }
        raw_content = connection.execute(text(
            "SELECT bundle_json FROM candidate_bundles WHERE id='month-bundle'"
        )).scalar_one()
    engine.dispose()
    migrated = json.loads(raw_content)
    payload = migrated["suggestions"][0]["payload"]
    assert payload == {"occurred_month": "2026-07"}
    assert "occurred_at" not in columns
    assert "time_precision" not in columns

    command.upgrade(config, "head")
    engine = create_engine(url)
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT occurred_date FROM records WHERE id='month-record'"
        )).scalar_one() is None
        columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(records)"))
        }
        raw_content = connection.execute(text(
            "SELECT bundle_json FROM candidate_bundles WHERE id='month-bundle'"
        )).scalar_one()
    engine.dispose()
    payload = json.loads(raw_content)["suggestions"][0]["payload"]
    assert payload == {"occurred_date": None}
    assert "occurred_month" not in columns

    command.downgrade(config, "0009_add_source_maintenance")
    engine = create_engine(url)
    with engine.connect() as connection:
        precision = connection.execute(text(
            "SELECT time_precision FROM records WHERE id='month-record'"
        )).scalar_one()
    engine.dispose()
    assert precision == "unknown"
