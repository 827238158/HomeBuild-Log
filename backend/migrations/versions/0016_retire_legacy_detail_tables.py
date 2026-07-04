"""retire legacy procurement and todo detail tables

Revision ID: 0016_retire_legacy
Revises: 0015_merge_procurement
"""

import sqlalchemy as sa
from alembic import op

revision = "0016_retire_legacy"
down_revision = "0015_merge_procurement"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    missing_orders = connection.scalar(
        sa.text(
            "SELECT COUNT(*) FROM procurement_details p LEFT JOIN ledger_details l "
            "ON l.record_id=p.record_id AND l.ledger_kind='purchase_order' WHERE l.record_id IS NULL"
        )
    )
    missing_issues = connection.scalar(
        sa.text(
            "SELECT COUNT(*) FROM todo_details t LEFT JOIN issue_details i "
            "ON i.record_id=t.record_id WHERE i.record_id IS NULL"
        )
    )
    if missing_orders or missing_issues:
        raise RuntimeError("旧详情表仍有未迁移数据，已停止退役。")
    op.drop_table("procurement_details")
    op.drop_table("todo_details")


def downgrade() -> None:
    op.create_table(
        "procurement_details",
        sa.Column(
            "record_id",
            sa.String(32),
            sa.ForeignKey("records.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("item_name", sa.String(300), nullable=False),
        sa.Column("specification", sa.String(500)),
        sa.Column("quantity", sa.Numeric(18, 4)),
        sa.Column("quantity_unit", sa.String(32)),
        sa.Column("vendor_id", sa.String(32), sa.ForeignKey("vendors.id")),
        sa.Column("order_number", sa.String(200)),
        sa.Column("order_total_minor", sa.Integer()),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("promised_date", sa.Date()),
        sa.Column("delivery_address", sa.Text()),
        sa.Column("return_terms", sa.Text()),
        sa.Column("acceptance_result", sa.Text()),
    )
    op.execute(
        sa.text(
            "INSERT INTO procurement_details SELECT record_id,item_name,specification,quantity,quantity_unit,vendor_id,"
            "order_number,order_total_minor,currency,promised_date,delivery_address,return_terms,acceptance_result "
            "FROM ledger_details WHERE ledger_kind='purchase_order'"
        )
    )
    op.create_table(
        "todo_details",
        sa.Column(
            "record_id",
            sa.String(32),
            sa.ForeignKey("records.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("planned_at", sa.DateTime()),
        sa.Column("due_at", sa.Date()),
        sa.Column("trigger_condition", sa.Text()),
        sa.Column("priority", sa.String(32)),
        sa.Column("completed_at", sa.Date()),
        sa.Column("completion_evidence", sa.Text()),
    )
