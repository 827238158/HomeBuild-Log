"""remove purchase orders and normalize cash-flow statuses

Revision ID: 0017_remove_purchase_orders
Revises: 0016_retire_legacy

注意：upgrade 会永久删除采购订单数据，downgrade 只能恢复字段结构。
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0017_remove_purchase_orders"
down_revision = "0016_retire_legacy"
branch_labels = None
depends_on = None

_PURCHASE_COLUMNS = (
    "item_name", "specification", "quantity", "quantity_unit", "order_number",
    "order_total_minor", "promised_date", "delivery_address", "return_terms",
    "acceptance_result",
)


def _clean_bundle(value: object) -> object:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        return value
    suggestions = value.get("suggestions")
    if not isinstance(suggestions, list):
        return value
    removed_refs: set[str] = set()
    kept: list[object] = []
    for item in suggestions:
        if not isinstance(item, dict):
            kept.append(item)
            continue
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        is_purchase = (
            item.get("record_type") == "procurement"
            or payload.get("ledger_kind") == "purchase_order"
        )
        if is_purchase:
            removed_refs.update(str(item.get(key)) for key in ("ref", "key") if item.get(key))
            continue
        if item.get("record_type") == "ledger":
            kind = str(payload.get("ledger_kind") or "payment")
            payload["direction"] = {
                "payment": "expense", "refund": "refund", "income": "income",
            }.get(kind, "expense")
            if payload.get("status") not in {"planned", "voided"}:
                payload["status"] = "paid" if kind == "payment" else "posted"
            item["payload"] = payload
        kept.append(item)
    value["suggestions"] = kept
    relations = value.get("relations")
    if isinstance(relations, list):
        value["relations"] = [
            relation for relation in relations
            if not isinstance(relation, dict)
            or (
                str(relation.get("from_ref") or relation.get("from_key") or "") not in removed_refs
                and str(relation.get("to_ref") or relation.get("to_key") or "") not in removed_refs
                and relation.get("relation_type") not in {"pays_for", "tracks_delivery"}
            )
        ]
    return value


def upgrade() -> None:
    connection = op.get_bind()
    # 记录关系未配置级联删除，必须先显式清理两端引用。
    op.execute(sa.text(
        "DELETE FROM record_relations WHERE relation_type IN ('pays_for','tracks_delivery') "
        "OR from_record_id IN "
        "(SELECT record_id FROM ledger_details WHERE ledger_kind='purchase_order') "
        "OR to_record_id IN "
        "(SELECT record_id FROM ledger_details WHERE ledger_kind='purchase_order')"
    ))
    op.execute(sa.text(
        "DELETE FROM records WHERE id IN "
        "(SELECT record_id FROM ledger_details WHERE ledger_kind='purchase_order')"
    ))
    op.execute(sa.text(
        "UPDATE records SET status='paid' WHERE status NOT IN ('planned','voided') AND id IN "
        "(SELECT record_id FROM ledger_details WHERE ledger_kind='payment')"
    ))
    op.execute(sa.text(
        "UPDATE records SET status='posted' WHERE status NOT IN ('planned','voided') AND id IN "
        "(SELECT record_id FROM ledger_details WHERE ledger_kind IN ('refund','income'))"
    ))
    op.execute(sa.text(
        "UPDATE ledger_details SET direction=CASE ledger_kind "
        "WHEN 'payment' THEN 'expense' WHEN 'refund' THEN 'refund' WHEN 'income' THEN 'income' END "
        "WHERE ledger_kind IN ('payment','refund','income')"
    ))
    rows = connection.execute(sa.text("SELECT id, bundle_json FROM candidate_bundles")).all()
    for row in rows:
        cleaned = _clean_bundle(row.bundle_json)
        connection.execute(
            sa.text("UPDATE candidate_bundles SET bundle_json=:value WHERE id=:id"),
            {"id": row.id, "value": json.dumps(cleaned, ensure_ascii=False)},
        )
    with op.batch_alter_table("ledger_details") as batch:
        for column in _PURCHASE_COLUMNS:
            batch.drop_column(column)


def downgrade() -> None:
    with op.batch_alter_table("ledger_details") as batch:
        batch.add_column(sa.Column("item_name", sa.String(300)))
        batch.add_column(sa.Column("specification", sa.String(500)))
        batch.add_column(sa.Column("quantity", sa.Numeric(18, 4)))
        batch.add_column(sa.Column("quantity_unit", sa.String(32)))
        batch.add_column(sa.Column("order_number", sa.String(200)))
        batch.add_column(sa.Column("order_total_minor", sa.Integer()))
        batch.add_column(sa.Column("promised_date", sa.Date()))
        batch.add_column(sa.Column("delivery_address", sa.Text()))
        batch.add_column(sa.Column("return_terms", sa.Text()))
        batch.add_column(sa.Column("acceptance_result", sa.Text()))
