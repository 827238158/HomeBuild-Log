"""add optional payment ownership for ledger refunds"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023_add_ledger_refund_links"
down_revision = "0022_add_due_date_and_record_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 历史独立退款保持原样，不推测或补建付款归属。
    with op.batch_alter_table("ledger_details") as batch:
        batch.add_column(sa.Column("refund_of_record_id", sa.String(32), nullable=True))
        batch.create_foreign_key(
            "fk_ledger_refund_payment", "records", ["refund_of_record_id"], ["id"],
        )
        batch.create_index("ix_ledger_details_refund_of_record_id", ["refund_of_record_id"])


def downgrade() -> None:
    with op.batch_alter_table("ledger_details") as batch:
        batch.drop_index("ix_ledger_details_refund_of_record_id")
        batch.drop_constraint("fk_ledger_refund_payment", type_="foreignkey")
        batch.drop_column("refund_of_record_id")
