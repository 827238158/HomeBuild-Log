"""add source revision tracking for maintenance

Revision ID: 0009_add_source_maintenance
Revises: 0008_add_default_root_space
Create Date: 2026-06-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_add_source_maintenance"
down_revision: str | None = "0008_add_default_root_space"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("source_entries") as batch:
        batch.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1")
        )
    op.execute(sa.text("UPDATE source_entries SET updated_at = captured_at"))
    with op.batch_alter_table("source_entries") as batch:
        batch.alter_column("updated_at", existing_type=sa.DateTime(), nullable=False)

    with op.batch_alter_table("record_sources") as batch:
        batch.add_column(
            sa.Column("source_revision", sa.Integer(), nullable=False, server_default="1")
        )
    with op.batch_alter_table("candidate_bundles") as batch:
        batch.add_column(
            sa.Column("source_revision", sa.Integer(), nullable=False, server_default="1")
        )


def downgrade() -> None:
    with op.batch_alter_table("candidate_bundles") as batch:
        batch.drop_column("source_revision")
    with op.batch_alter_table("record_sources") as batch:
        batch.drop_column("source_revision")
    with op.batch_alter_table("source_entries") as batch:
        batch.drop_column("revision")
        batch.drop_column("updated_at")
