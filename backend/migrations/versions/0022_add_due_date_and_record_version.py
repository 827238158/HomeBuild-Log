"""add optional issue due dates and optimistic record versions"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022_add_due_date_and_record_version"
down_revision = "0021_add_topics_and_issue_activities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 历史待办日期不推测，版本从 1 开始以保护后续编辑。
    op.add_column("records", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("issue_details", sa.Column("due_date", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("issue_details") as batch:
        batch.drop_column("due_date")
    with op.batch_alter_table("records") as batch:
        batch.drop_column("version")
