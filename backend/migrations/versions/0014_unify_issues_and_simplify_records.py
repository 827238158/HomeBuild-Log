"""unify todos and issues and simplify record fields

Revision ID: 0014_unify_issues
Revises: 0013_business_times_dates
Create Date: 2026-07-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_unify_issues"
down_revision: str | None = "0013_business_times_dates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 先完整保存旧待办详情，降级和人工核查时都不会丢失原始字段。
    op.create_table(
        "legacy_todo_backup",
        sa.Column("record_id", sa.String(32), primary_key=True),
        sa.Column("original_status", sa.String(32), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("planned_at", sa.DateTime(), nullable=True),
        sa.Column("due_at", sa.Date(), nullable=True),
        sa.Column("trigger_condition", sa.Text(), nullable=True),
        sa.Column("priority", sa.String(32), nullable=True),
        sa.Column("completed_at", sa.Date(), nullable=True),
        sa.Column("completion_evidence", sa.Text(), nullable=True),
    )
    op.execute(sa.text(
        "INSERT INTO legacy_todo_backup "
        "SELECT t.record_id, r.status, t.action, t.planned_at, t.due_at, "
        "t.trigger_condition, t.priority, t.completed_at, t.completion_evidence "
        "FROM todo_details t JOIN records r ON r.id = t.record_id"
    ))

    with op.batch_alter_table("issue_details") as batch:
        batch.add_column(sa.Column("completed_at", sa.Date(), nullable=True))
    op.execute(sa.text(
        "UPDATE issue_details SET completed_at = resolved_at WHERE resolved_at IS NOT NULL"
    ))
    op.execute(sa.text(
        "INSERT INTO issue_details "
        "(record_id, discovered_at, phenomenon, severity, responsible_party, handling_plan, "
        "completed_at, actual_result, resolution_kind) "
        "SELECT record_id, planned_at, action, NULL, NULL, NULL, completed_at, "
        "completion_evidence, NULL FROM todo_details"
    ))
    op.execute(sa.text(
        "UPDATE records SET record_type = 'issue', status = CASE "
        "WHEN status IN ('done') THEN 'done' "
        "WHEN status = 'in_progress' THEN 'in_progress' ELSE 'pending' END "
        "WHERE record_type = 'todo'"
    ))
    op.execute(sa.text(
        "UPDATE records SET status = CASE "
        "WHEN status IN ('resolved', 'closed') THEN 'done' "
        "WHEN status = 'in_progress' THEN 'in_progress' ELSE 'pending' END "
        "WHERE record_type = 'issue'"
    ))
    op.execute(sa.text(
        "UPDATE records SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) "
        "WHERE record_type = 'issue' AND id IN "
        "(SELECT record_id FROM legacy_todo_backup WHERE original_status = 'cancelled')"
    ))
    with op.batch_alter_table("issue_details") as batch:
        batch.drop_column("expected_resolution_at")
        batch.drop_column("resolved_at")

    # 尺寸统一换算为毫米；无法识别的单位原样保留，交由界面提示复核。
    op.execute(sa.text(
        "UPDATE measurement_values SET value = value * 10, unit = 'mm' WHERE lower(unit) = 'cm'"
    ))
    op.execute(sa.text(
        "UPDATE measurement_values SET value = value * 1000, unit = 'mm' WHERE lower(unit) = 'm'"
    ))
    op.execute(sa.text(
        "UPDATE records SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP), "
        "status = 'active' "
        "WHERE record_type = 'measurement' AND status IN ('superseded', 'cancelled')"
    ))
    op.execute(sa.text(
        "UPDATE records SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP), "
        "status = 'cancelled' "
        "WHERE record_type = 'decision' AND status = 'superseded'"
    ))


def downgrade() -> None:
    with op.batch_alter_table("issue_details") as batch:
        batch.add_column(sa.Column("expected_resolution_at", sa.Date(), nullable=True))
        batch.add_column(sa.Column("resolved_at", sa.Date(), nullable=True))
    op.execute(sa.text(
        "UPDATE issue_details SET resolved_at = completed_at WHERE completed_at IS NOT NULL"
    ))
    op.execute(sa.text(
        "DELETE FROM issue_details WHERE record_id IN (SELECT record_id FROM legacy_todo_backup)"
    ))
    op.execute(sa.text(
        "UPDATE records SET record_type = 'todo', status = "
        "(SELECT original_status FROM legacy_todo_backup b WHERE b.record_id = records.id) "
        "WHERE id IN (SELECT record_id FROM legacy_todo_backup)"
    ))
    with op.batch_alter_table("issue_details") as batch:
        batch.drop_column("completed_at")
    op.drop_table("legacy_todo_backup")
