"""replace record occurrence month with an exact calendar date

Revision ID: 0011_occurred_date
Revises: 0010_occurred_month
Create Date: 2026-06-30
"""

from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op

revision: str = "0011_occurred_date"
down_revision: str | None = "0010_occurred_month"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _migrate_candidate_payloads(*, downgrade: bool = False) -> None:
    connection = op.get_bind()
    bundles = sa.table(
        "candidate_bundles",
        sa.column("id", sa.String()),
        sa.column("bundle_json", sa.JSON()),
    )
    for bundle_id, content in connection.execute(
        sa.select(bundles.c.id, bundles.c.bundle_json)
    ):
        changed = False
        for candidate in (content or {}).get("suggestions", []):
            payload = candidate.get("payload")
            if not isinstance(payload, dict):
                continue
            if downgrade:
                occurred_date = payload.pop("occurred_date", None)
                payload["occurred_month"] = (
                    str(occurred_date)[:7] if occurred_date else None
                )
            else:
                # 旧值只能确定到月，不伪造具体日期。
                payload.pop("occurred_month", None)
                payload["occurred_date"] = None
            changed = True
        if changed:
            connection.execute(
                bundles.update()
                .where(bundles.c.id == bundle_id)
                .values(bundle_json=content)
            )


def upgrade() -> None:
    with op.batch_alter_table("records") as batch:
        batch.add_column(sa.Column("occurred_date", sa.Date(), nullable=True))

    # 小主明确要求旧月份值留空，避免人为填充每月 1 日。
    _migrate_candidate_payloads()
    with op.batch_alter_table("records") as batch:
        batch.drop_column("occurred_month")


def downgrade() -> None:
    with op.batch_alter_table("records") as batch:
        batch.add_column(sa.Column("occurred_month", sa.String(7), nullable=True))

    connection = op.get_bind()
    records = sa.table(
        "records",
        sa.column("id", sa.String()),
        sa.column("occurred_date", sa.Date()),
        sa.column("occurred_month", sa.String(7)),
    )
    for record_id, occurred_date in connection.execute(
        sa.select(records.c.id, records.c.occurred_date)
    ):
        connection.execute(
            records.update()
            .where(records.c.id == record_id)
            .values(
                occurred_month=(
                    occurred_date.strftime("%Y-%m")
                    if isinstance(occurred_date, date)
                    else None
                )
            )
        )

    _migrate_candidate_payloads(downgrade=True)
    with op.batch_alter_table("records") as batch:
        batch.drop_column("occurred_date")
