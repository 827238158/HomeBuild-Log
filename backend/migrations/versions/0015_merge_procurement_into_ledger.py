"""merge procurement records into ledger subtypes

Revision ID: 0015_merge_procurement
Revises: 0014_unify_issues
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0015_merge_procurement"
down_revision = "0014_unify_issues"
branch_labels = None
depends_on = None


_ORDER_COLUMNS = (
    "item_name", "specification", "quantity", "quantity_unit", "vendor_id",
    "order_number", "order_total_minor", "currency", "promised_date",
    "delivery_address", "return_terms", "acceptance_result",
)


def _convert_candidate(value: object, *, to_ledger: bool) -> object:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        return value
    for item in value.get("suggestions", []):
        if not isinstance(item, dict):
            continue
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        if to_ledger and item.get("record_type") == "procurement":
            item["record_type"] = "ledger"
            item["type_label"] = "账目"
            payload.update(ledger_kind="purchase_order", direction=None,
                           payment_kind=None, amount_minor=None)
        elif (
            not to_ledger
            and item.get("record_type") == "ledger"
            and payload.get("ledger_kind") == "purchase_order"
        ):
            item["record_type"] = "procurement"
            item["type_label"] = "采购"
            payload.pop("ledger_kind", None)
            payload.pop("direction", None)
            payload.pop("payment_kind", None)
            payload.pop("amount_minor", None)
        item["payload"] = payload
    return value


def upgrade() -> None:
    with op.batch_alter_table("ledger_details") as batch:
        batch.add_column(sa.Column("ledger_kind", sa.String(24), nullable=True))
        batch.alter_column("direction", existing_type=sa.String(16), nullable=True)
        batch.alter_column("payment_kind", existing_type=sa.String(32), nullable=True)
        batch.alter_column("amount_minor", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("item_name", sa.String(300), nullable=True))
        batch.add_column(sa.Column("specification", sa.String(500), nullable=True))
        batch.add_column(sa.Column("quantity", sa.Numeric(18, 4), nullable=True))
        batch.add_column(sa.Column("quantity_unit", sa.String(32), nullable=True))
        batch.add_column(sa.Column("order_number", sa.String(200), nullable=True))
        batch.add_column(sa.Column("order_total_minor", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("promised_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("delivery_address", sa.Text(), nullable=True))
        batch.add_column(sa.Column("return_terms", sa.Text(), nullable=True))
        batch.add_column(sa.Column("acceptance_result", sa.Text(), nullable=True))

    op.execute(sa.text(
        "UPDATE ledger_details SET ledger_kind = CASE direction "
        "WHEN 'refund' THEN 'refund' WHEN 'income' THEN 'income' ELSE 'payment' END"
    ))
    op.execute(sa.text(
        "INSERT INTO ledger_details (record_id, ledger_kind, direction, payment_kind, "
        "amount_minor, currency, payment_date, payment_method, vendor_id, item_name, "
        "specification, quantity, quantity_unit, order_number, order_total_minor, "
        "promised_date, delivery_address, return_terms, acceptance_result) "
        "SELECT record_id, 'purchase_order', NULL, NULL, NULL, currency, NULL, NULL, "
        "vendor_id, item_name, specification, quantity, quantity_unit, order_number, "
        "order_total_minor, promised_date, delivery_address, return_terms, acceptance_result "
        "FROM procurement_details"
    ))
    op.execute(sa.text(
        "UPDATE records SET record_type = 'ledger' WHERE record_type = 'procurement'"
    ))

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, bundle_json FROM candidate_bundles")).all()
    for row in rows:
        converted = _convert_candidate(row.bundle_json, to_ledger=True)
        connection.execute(
            sa.text("UPDATE candidate_bundles SET bundle_json=:value WHERE id=:id"),
            {"id": row.id, "value": json.dumps(converted, ensure_ascii=False)},
        )

    with op.batch_alter_table("ledger_details") as batch:
        batch.alter_column("ledger_kind", existing_type=sa.String(24), nullable=False)


def downgrade() -> None:
    connection = op.get_bind()
    op.execute(sa.text(
        "INSERT OR REPLACE INTO procurement_details (record_id, item_name, specification, "
        "quantity, quantity_unit, vendor_id, order_number, order_total_minor, currency, "
        "promised_date, delivery_address, return_terms, acceptance_result) "
        "SELECT record_id, item_name, specification, quantity, quantity_unit, vendor_id, "
        "order_number, order_total_minor, currency, promised_date, delivery_address, "
        "return_terms, acceptance_result FROM ledger_details WHERE ledger_kind='purchase_order'"
    ))
    op.execute(sa.text(
        "UPDATE records SET record_type='procurement' WHERE id IN "
        "(SELECT record_id FROM ledger_details WHERE ledger_kind='purchase_order')"
    ))
    op.execute(sa.text("DELETE FROM ledger_details WHERE ledger_kind='purchase_order'"))
    rows = connection.execute(sa.text("SELECT id, bundle_json FROM candidate_bundles")).all()
    for row in rows:
        converted = _convert_candidate(row.bundle_json, to_ledger=False)
        connection.execute(
            sa.text("UPDATE candidate_bundles SET bundle_json=:value WHERE id=:id"),
            {"id": row.id, "value": json.dumps(converted, ensure_ascii=False)},
        )
    with op.batch_alter_table("ledger_details") as batch:
        for column in reversed(_ORDER_COLUMNS[:-1]):
            if column != "currency" and column != "vendor_id":
                batch.drop_column(column)
        batch.drop_column("acceptance_result")
        batch.drop_column("ledger_kind")
        batch.alter_column("direction", existing_type=sa.String(16), nullable=False)
        batch.alter_column("payment_kind", existing_type=sa.String(32), nullable=False)
        batch.alter_column("amount_minor", existing_type=sa.Integer(), nullable=False)
