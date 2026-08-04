"""unify record relations as undirected relates_to links

Revision ID: 0018_unify_relations
Revises: 0017_remove_purchase_orders

历史关系类型会不可逆地收敛为 relates_to；反向或跨类型重复关系只保留最早一条。
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "0018_unify_relations"
down_revision = "0017_remove_purchase_orders"
branch_labels = None
depends_on = None


def _normalize_bundle(value: object) -> object:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        return value
    relations = value.get("relations")
    if not isinstance(relations, list):
        return value
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for relation in relations:
        if not isinstance(relation, dict):
            continue
        from_key = str(relation.get("from_key") or relation.get("from_ref") or "")
        to_key = str(relation.get("to_key") or relation.get("to_ref") or "")
        if not from_key or not to_key or from_key == to_key:
            continue
        pair = tuple(sorted((from_key, to_key)))
        if pair in seen:
            continue
        seen.add(pair)
        normalized.append({
            "from_key": pair[0],
            "to_key": pair[1],
            "relation_type": "relates_to",
        })
    value["relations"] = normalized
    return value


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(sa.text(
        "SELECT id, project_id, from_record_id, to_record_id, created_at "
        "FROM record_relations ORDER BY created_at, id"
    )).mappings().all()
    survivors: dict[tuple[str, str], dict[str, object]] = {}
    for row in rows:
        pair = tuple(sorted((str(row["from_record_id"]), str(row["to_record_id"]))))
        if pair[0] == pair[1] or pair in survivors:
            continue
        survivors[pair] = dict(row)

    # 先整体清空再写回，避免旧的方向唯一约束与规范化更新互相冲突。
    connection.execute(sa.text("DELETE FROM record_relations"))
    for pair, row in survivors.items():
        connection.execute(sa.text(
            "INSERT INTO record_relations "
            "(id, project_id, from_record_id, to_record_id, relation_type, created_at) "
            "VALUES (:id, :project_id, :from_id, :to_id, 'relates_to', :created_at)"
        ), {
            "id": row["id"],
            "project_id": row["project_id"],
            "from_id": pair[0],
            "to_id": pair[1],
            "created_at": row["created_at"],
        })

    bundles = connection.execute(
        sa.text("SELECT id, bundle_json FROM candidate_bundles")
    ).all()
    for bundle in bundles:
        normalized = _normalize_bundle(bundle.bundle_json)
        connection.execute(
            sa.text("UPDATE candidate_bundles SET bundle_json=:value WHERE id=:id"),
            {"id": bundle.id, "value": json.dumps(normalized, ensure_ascii=False)},
        )


def downgrade() -> None:
    # 原关系类型和被合并的重复行无法可靠重建，降级保留通用关系数据。
    pass
