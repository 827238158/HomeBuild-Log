"""add extraction run audit records

Revision ID: 0006_add_extraction_runs
Revises: 0005_add_record_origin_key
Create Date: 2026-06-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_add_extraction_runs"
down_revision: str | None = "0005_add_record_origin_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "extraction_runs",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("request_id", sa.String(32), nullable=False),
        sa.Column("source_id", sa.String(32), nullable=False),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("requested_engine", sa.String(16), nullable=False),
        sa.Column("provider", sa.String(32), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("engine", sa.String(128), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("prompt_text", sa.Text(), nullable=True),
        sa.Column("raw_response", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["source_id"], ["source_entries.id"]),
    )
    op.create_index("ix_extraction_runs_request_id", "extraction_runs", ["request_id"])
    op.create_index("ix_extraction_runs_source_id", "extraction_runs", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_extraction_runs_source_id", table_name="extraction_runs")
    op.drop_index("ix_extraction_runs_request_id", table_name="extraction_runs")
    op.drop_table("extraction_runs")
