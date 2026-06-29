"""add default root space

Revision ID: 0008_add_default_root_space
Revises: 0007_add_candidate_bundles
Create Date: 2026-06-29
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0008_add_default_root_space"
down_revision: str | None = "0007_add_candidate_bundles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_PROJECT_ID = "00000000000000000000000000000001"
DEFAULT_ROOT_SPACE_ID = "00000000000000000000000000000002"


def upgrade() -> None:
    connection = op.get_bind()
    root_id = connection.execute(
        sa.text(
            "SELECT id FROM spaces "
            "WHERE project_id = :project_id AND kind = 'house' AND parent_id IS NULL "
            "ORDER BY created_at, id LIMIT 1"
        ),
        {"project_id": DEFAULT_PROJECT_ID},
    ).scalar_one_or_none()
    if root_id is not None:
        return

    now = datetime.now(tz=UTC)
    connection.execute(
        sa.text(
            "INSERT INTO spaces "
            "(id, project_id, parent_id, name, kind, archived_at, created_at, updated_at) "
            "VALUES (:id, :project_id, NULL, :name, 'house', NULL, :created_at, :updated_at)"
        ),
        {
            "id": DEFAULT_ROOT_SPACE_ID,
            "project_id": DEFAULT_PROJECT_ID,
            "name": "整套房屋",
            "created_at": now,
            "updated_at": now,
        },
    )
    # 旧数据中没有房屋层级的空间统一归到新根空间，避免继续成为孤立节点。
    connection.execute(
        sa.text(
            "UPDATE spaces SET parent_id = :root_id, updated_at = :updated_at "
            "WHERE project_id = :project_id AND parent_id IS NULL "
            "AND kind <> 'house' AND id <> :root_id"
        ),
        {
            "root_id": DEFAULT_ROOT_SPACE_ID,
            "project_id": DEFAULT_PROJECT_ID,
            "updated_at": now,
        },
    )


def downgrade() -> None:
    connection = op.get_bind()
    root_exists = connection.execute(
        sa.text("SELECT id FROM spaces WHERE id = :id"),
        {"id": DEFAULT_ROOT_SPACE_ID},
    ).scalar_one_or_none()
    if root_exists is None:
        return

    connection.execute(
        sa.text("UPDATE spaces SET parent_id = NULL WHERE parent_id = :root_id"),
        {"root_id": DEFAULT_ROOT_SPACE_ID},
    )
    connection.execute(
        sa.text("DELETE FROM spaces WHERE id = :id"),
        {"id": DEFAULT_ROOT_SPACE_ID},
    )
