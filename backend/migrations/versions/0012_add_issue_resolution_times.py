"""add issue expected and actual resolution times

Revision ID: 0012_issue_resolution_times
Revises: 0011_occurred_date
Create Date: 2026-07-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_issue_resolution_times"
down_revision: str | None = "0011_occurred_date"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("issue_details") as batch:
        batch.add_column(
            sa.Column("expected_resolution_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch.add_column(sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("issue_details") as batch:
        batch.drop_column("resolved_at")
        batch.drop_column("expected_resolution_at")
