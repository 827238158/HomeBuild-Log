"""add independent pitfall logs

Revision ID: 0019_add_pitfall_logs
Revises: 0018_unify_relations
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_add_pitfall_logs"
down_revision = "0018_unify_relations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pitfalls",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("project_id", sa.String(length=32), nullable=False),
        sa.Column("occurred_date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pitfalls_project_id", "pitfalls", ["project_id"])
    op.create_index("ix_pitfalls_occurred_date", "pitfalls", ["occurred_date"])
    op.create_table(
        "pitfall_resolutions",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("pitfall_id", sa.String(length=32), nullable=False),
        sa.Column("resolved_date", sa.Date(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["pitfall_id"], ["pitfalls.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_pitfall_resolutions_pitfall_id", "pitfall_resolutions", ["pitfall_id"]
    )
    op.create_index(
        "ix_pitfall_resolutions_resolved_date", "pitfall_resolutions", ["resolved_date"]
    )


def downgrade() -> None:
    op.drop_index("ix_pitfall_resolutions_resolved_date", table_name="pitfall_resolutions")
    op.drop_index("ix_pitfall_resolutions_pitfall_id", table_name="pitfall_resolutions")
    op.drop_table("pitfall_resolutions")
    op.drop_index("ix_pitfalls_occurred_date", table_name="pitfalls")
    op.drop_index("ix_pitfalls_project_id", table_name="pitfalls")
    op.drop_table("pitfalls")
