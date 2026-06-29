"""add persistent candidate bundles

Revision ID: 0007_add_candidate_bundles
Revises: 0006_add_extraction_runs
Create Date: 2026-06-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_add_candidate_bundles"
down_revision: str | None = "0006_add_extraction_runs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "candidate_bundles",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("source_id", sa.String(32), nullable=False),
        sa.Column("extraction_run_id", sa.String(32), nullable=False, unique=True),
        sa.Column("engine", sa.String(128), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("bundle_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["source_entries.id"]),
        sa.ForeignKeyConstraint(["extraction_run_id"], ["extraction_runs.id"]),
    )
    op.create_index("ix_candidate_bundles_source_id", "candidate_bundles", ["source_id"])
    op.create_index("ix_candidate_bundles_status", "candidate_bundles", ["status"])


def downgrade() -> None:
    op.drop_index("ix_candidate_bundles_status", table_name="candidate_bundles")
    op.drop_index("ix_candidate_bundles_source_id", table_name="candidate_bundles")
    op.drop_table("candidate_bundles")
