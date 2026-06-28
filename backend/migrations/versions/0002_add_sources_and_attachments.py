"""add source_entries and attachments tables

Revision ID: 0002_add_sources_and_attachments
Revises: 0001_local_foundation
Create Date: 2026-06-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_add_sources_and_attachments"
down_revision: str | None = "0001_local_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "source_entries",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("input_type", sa.String(16), nullable=False, server_default="text"),
        sa.Column("original_text", sa.Text(), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reported_time_text", sa.Text(), nullable=True),
    )

    op.create_table(
        "attachments",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("source_id", sa.String(32), sa.ForeignKey("source_entries.id"), nullable=True),
        sa.Column("original_filename", sa.String(512), nullable=False),
        sa.Column("media_type", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("sha256_hex", sa.String(64), nullable=False),
        sa.Column("storage_path", sa.String(1024), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("attachments")
    op.drop_table("source_entries")
