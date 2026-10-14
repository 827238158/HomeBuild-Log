"""add cross-type topics and append-only issue activities"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_add_topics_and_issue_activities"
down_revision = "0020_add_research_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 只新增聚合与历史表，已有业务内容和旧事项状态不回填、不改写。
    op.create_table(
        "topics",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("goal", sa.Text()),
        sa.Column("current_situation", sa.Text()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "name"),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_topic_status"),
    )
    op.create_index("ix_topics_project_id", "topics", ["project_id"])
    for table, column, parent in [
        ("record_topics", "record_id", "records"),
        ("pitfall_topics", "pitfall_id", "pitfalls"),
    ]:
        op.create_table(
            table,
            sa.Column(column, sa.String(32), sa.ForeignKey(f"{parent}.id", ondelete="CASCADE"),
                      primary_key=True),
            sa.Column("topic_id", sa.String(32), sa.ForeignKey("topics.id", ondelete="CASCADE"),
                      primary_key=True),
        )
        op.create_index(f"ix_{table}_topic_id", table, ["topic_id"])
    op.create_table(
        "issue_activities",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("record_id", sa.String(32), sa.ForeignKey("records.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("previous_status", sa.String(32)),
        sa.Column("next_status", sa.String(32)),
        sa.Column("content", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('status', 'note')", name="ck_issue_activity_kind"),
    )
    op.create_index("ix_issue_activities_record_id", "issue_activities", ["record_id"])


def downgrade() -> None:
    for table in ["issue_activities", "pitfall_topics", "record_topics", "topics"]:
        op.drop_table(table)
