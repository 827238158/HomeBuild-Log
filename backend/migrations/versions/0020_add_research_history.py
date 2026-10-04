"""add append-only research entries and conclusion history

Revision ID: 0020_add_research_history
Revises: 0019_add_pitfall_logs
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0020_add_research_history"
down_revision = "0019_add_pitfall_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "research_entries",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("record_id", sa.String(32), nullable=False),
        sa.Column("research_date", sa.Date(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("uncertainties", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["records.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_research_entries_record_id", "research_entries", ["record_id"])
    history = op.create_table(
        "research_conclusions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("record_id", sa.String(32), nullable=False),
        sa.Column("conclusion", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("entry_id", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["record_id"], ["records.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["entry_id"], ["research_entries.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_research_conclusions_record_id", "research_conclusions", ["record_id"])
    # 原始形成时间未知，记录迁移时的保留时间，不推断为主题创建时间。
    connection = op.get_bind()
    previous = connection.execute(sa.text(
        "SELECT record_id, conclusion FROM research_details "
        "WHERE conclusion IS NOT NULL"
    )).all()
    for record_id, conclusion in previous:
        if not conclusion.strip():
            continue
        connection.execute(history.insert().values(
            id=uuid.uuid4().hex, record_id=record_id, conclusion=conclusion,
            reason="启用结论历史时保留的已有结论（原形成时间未知）",
            created_at=datetime.now(tz=UTC),
        ))


def downgrade() -> None:
    op.drop_index("ix_research_conclusions_record_id", table_name="research_conclusions")
    op.drop_table("research_conclusions")
    op.drop_index("ix_research_entries_record_id", table_name="research_entries")
    op.drop_table("research_entries")
