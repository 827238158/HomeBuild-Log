"""convert issue and todo business times to dates

Revision ID: 0013_business_times_dates
Revises: 0012_issue_resolution_times
Create Date: 2026-07-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013_business_times_dates"
down_revision: str | None = "0012_issue_resolution_times"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ISSUE_COLUMNS = ("expected_resolution_at", "resolved_at")
TODO_COLUMNS = ("due_at", "completed_at")


def _upgrade_table(table: str, columns: tuple[str, ...]) -> None:
    with op.batch_alter_table(table) as batch:
        for column in columns:
            batch.add_column(sa.Column(f"_{column}_date", sa.String(10), nullable=True))
    for column in columns:
        # 历史 UTC 时间先换算为北京时间，再截取业务日期，避免午夜附近偏移一天。
        op.execute(sa.text(
            f'UPDATE "{table}" SET "_{column}_date" = date("{column}", \'+8 hours\') '
            f'WHERE "{column}" IS NOT NULL'
        ))
    with op.batch_alter_table(table) as batch:
        for column in columns:
            batch.alter_column(column, existing_type=sa.DateTime(), type_=sa.Date())
    for column in columns:
        # SQLite 的 CAST(... AS DATE) 只会留下年份，必须从临时文本列写回完整日期。
        op.execute(sa.text(
            f'UPDATE "{table}" SET "{column}" = "_{column}_date" '
            f'WHERE "_{column}_date" IS NOT NULL'
        ))
    with op.batch_alter_table(table) as batch:
        for column in columns:
            batch.drop_column(f"_{column}_date")


def _downgrade_table(table: str, columns: tuple[str, ...]) -> None:
    with op.batch_alter_table(table) as batch:
        for column in columns:
            batch.add_column(sa.Column(f"_{column}_date", sa.String(10), nullable=True))
    for column in columns:
        op.execute(sa.text(
            f'UPDATE "{table}" SET "_{column}_date" = "{column}" '
            f'WHERE "{column}" IS NOT NULL'
        ))
    with op.batch_alter_table(table) as batch:
        for column in columns:
            batch.alter_column(column, existing_type=sa.Date(), type_=sa.DateTime())
    for column in columns:
        op.execute(sa.text(
            f'UPDATE "{table}" SET "{column}" = "_{column}_date" || \' 00:00:00\' '
            f'WHERE "_{column}_date" IS NOT NULL'
        ))
    with op.batch_alter_table(table) as batch:
        for column in columns:
            batch.drop_column(f"_{column}_date")


def upgrade() -> None:
    _upgrade_table("issue_details", ISSUE_COLUMNS)
    _upgrade_table("todo_details", TODO_COLUMNS)


def downgrade() -> None:
    _downgrade_table("issue_details", ISSUE_COLUMNS)
    _downgrade_table("todo_details", TODO_COLUMNS)
