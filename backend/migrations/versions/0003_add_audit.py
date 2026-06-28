"""add audit_entries table

Revision ID: 0003_add_audit
Revises: 0002_add_sources_and_attachments
Create Date: 2026-06-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_add_audit"
down_revision: str | None = "0002_add_sources_and_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_entries",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(128), nullable=False, server_default="admin"),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("target_table", sa.String(128), nullable=False),
        sa.Column("target_id", sa.String(32), nullable=False),
        sa.Column("before_json", sa.JSON, nullable=True),
        sa.Column("after_json", sa.JSON, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("audit_entries")
