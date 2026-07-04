from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.analytics import (
    STATUS_LABELS,
    TYPE_LABELS,
    base_record_analytics,
    distribution,
    money_trend,
)
from app.auth import CurrentUser, require_user
from app.db import create_session_factory
from app.domain_models import (
    DEFAULT_PROJECT_ID,
    Material,
    Record,
    RecordRelation,
    Space,
    Vendor,
)
from app.ledger_rules import is_effective_ledger
from app.models import SourceEntry
from app.projections import (
    effective_date,
    list_project_records,
    record_matches,
    serialize_records,
)

router = APIRouter(tags=["views"])
User = Annotated[CurrentUser, Depends(require_user)]


def _db(request: Request) -> Session:
    return create_session_factory(request.app.state.engine)()


def _relations(db: Session) -> list[RecordRelation]:
    return list(
        db.scalars(
            select(RecordRelation).where(RecordRelation.project_id == DEFAULT_PROJECT_ID)
        ).all()
    )


def _filtered_records(
    db: Session,
    *,
    keyword: str | None = None,
    record_type: str | None = None,
    space_id: str | None = None,
    stage_id: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> tuple[list[Record], dict[str, dict[str, Any]]]:
    records = list_project_records(db)
    serialized = serialize_records(db, records)
    selected = [
        record
        for record in records
        if record_matches(
            serialized[record.id],
            keyword=keyword,
            record_type=record_type,
            space_id=space_id,
            stage_id=stage_id,
            status=status,
            date_from=date_from,
            date_to=date_to,
        )
    ]
    return selected, serialized


@router.get("/timeline")
def timeline(
    request: Request,
    user: User,
    q: str | None = Query(default=None, max_length=200),
    record_type: str | None = None,
    space_id: str | None = None,
    stage_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    db = _db(request)
    try:
        records, serialized = _filtered_records(
            db,
            keyword=q,
            record_type=record_type,
            space_id=space_id,
            stage_id=stage_id,
            date_from=date_from,
            date_to=date_to,
        )
        selected_ids = {record.id for record in records}
        related_by_event: dict[str, list[str]] = defaultdict(list)
        related_non_events: set[str] = set()
        for relation in _relations(db):
            if (
                relation.from_record_id not in selected_ids
                or relation.to_record_id not in selected_ids
            ):
                continue
            first = serialized[relation.from_record_id]
            second = serialized[relation.to_record_id]
            if first["record_type"] == "event" and second["record_type"] != "event":
                related_by_event[first["id"]].append(second["id"])
                related_non_events.add(second["id"])
            elif second["record_type"] == "event" and first["record_type"] != "event":
                related_by_event[second["id"]].append(first["id"])
                related_non_events.add(first["id"])

        items: list[dict[str, Any]] = []
        for record in records:
            summary = serialized[record.id]
            if summary["record_type"] != "event" and summary["id"] in related_non_events:
                continue
            items.append(
                {
                    "record": summary,
                    "related_records": [
                        serialized[record_id]
                        for record_id in dict.fromkeys(related_by_event.get(record.id, []))
                    ],
                }
            )

        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in items:
            item_date = effective_date(item["record"])
            date_key = item_date.isoformat() if item_date else "unknown"
            groups[date_key].append(item)
        ordered_keys = sorted((key for key in groups if key != "unknown"), reverse=True)
        if "unknown" in groups:
            ordered_keys.append("unknown")
        return {
            "groups": [
                {
                    "date_key": key,
                    "label": (
                        "时间待补充"
                        if key == "unknown"
                        else f"{key[:4]}年{int(key[5:7])}月{int(key[8:10])}日"
                    ),
                    "items": groups[key],
                }
                for key in ordered_keys
            ],
            "total": len(items),
            "analytics": base_record_analytics(
                [serialized[record.id] for record in records]
            ),
        }
    finally:
        db.close()


@router.get("/ledger/summary")
def ledger_summary(
    request: Request,
    user: User,
    vendor_id: str | None = None,
    space_id: str | None = None,
    stage_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    db = _db(request)
    try:
        records = list_project_records(db)
        serialized = serialize_records(db, records)
        selected = [
            serialized[record.id]
            for record in records
            if record.record_type == "ledger"
            and record_matches(
                serialized[record.id],
                space_id=space_id,
                stage_id=stage_id,
                date_from=date_from,
                date_to=date_to,
            )
            and (
                not vendor_id
                or serialized[record.id].get("vendor_id") == vendor_id
            )
        ]
        non_cny = [item for item in selected if item.get("currency", "CNY") != "CNY"]
        if non_cny:
            raise HTTPException(
                status_code=409,
                detail="检测到非人民币历史记录，请先核对数据后再查看账本。",
            )
        totals: dict[str, int] = {
            "expense_minor": 0,
            "refund_minor": 0,
            "income_minor": 0,
            "net_expense_minor": 0,
        }

        _DIRECTION_FIELD: dict[str, str] = {
            "expense": "expense_minor",
            "refund": "refund_minor",
            "income": "income_minor",
        }
        effective_ledgers = [ledger for ledger in selected if is_effective_ledger(ledger)]
        for ledger in effective_ledgers:
            field = _DIRECTION_FIELD.get(ledger["direction"])
            if field:
                totals[field] += int(ledger["amount_minor"])
        totals["net_expense_minor"] = (
            totals["expense_minor"] - totals["refund_minor"] - totals["income_minor"]
        )

        vendor_amounts: dict[str, int] = defaultdict(int)
        for ledger in effective_ledgers:
            vendor = ledger.get("vendor")
            if not vendor:
                continue
            amount = int(ledger.get("amount_minor") or 0)
            vendor_amounts[vendor["name"]] += (
                amount if ledger["direction"] == "expense" else -amount
            )

        return {
            "totals": totals,
            "ledger_entries": selected,
            "analytics": {
                "money_trend": money_trend(selected),
                "payment_composition": [
                    {"key": "expense", "label": "付款", "value": totals["expense_minor"]},
                    {
                        "key": "refund",
                        "label": "退款",
                        "value": totals["refund_minor"],
                    },
                    {
                        "key": "income",
                        "label": "收入",
                        "value": totals["income_minor"],
                    },
                ],
                "vendor_distribution": [
                    {"key": name, "label": name, "value": amount}
                    for name, amount in sorted(
                        vendor_amounts.items(), key=lambda item: (-item[1], item[0])
                    )
                ],
            },
        }
    finally:
        db.close()


@router.get("/issues/board")
def issues_board(request: Request, user: User, space_id: str | None = None) -> dict[str, Any]:
    db = _db(request)
    try:
        records = list_project_records(db)
        serialized = serialize_records(db, records)
        issues = [
            serialized[record.id]
            for record in records
            if record.record_type == "issue"
            and record_matches(serialized[record.id], space_id=space_id)
        ]
        status_meta = [
            ("pending", "待处理"),
            ("in_progress", "处理中"),
            ("done", "已完成"),
        ]
        cards_by_status: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for issue in issues:
            cards_by_status[issue["status"]].append(
                {
                    **issue,
                    "source_count": len(issue["source_refs"]),
                    "attachment_count": len(issue["attachment_ids"]),
                }
            )
        return {
            "columns": [
                {"status": status, "label": label, "items": cards_by_status.get(status, [])}
                for status, label in status_meta
            ],
            "total": len(issues),
            "analytics": {
                "status_distribution": distribution(
                    (item["status"] for item in issues), STATUS_LABELS
                ),
                "space_distribution": distribution(
                    space["name"]
                    for item in issues
                    for space in (item["spaces"] or [{"name": "未指定空间"}])
                ),
                "severity_distribution": distribution(
                    (item.get("severity") for item in issues),
                    {"low": "低", "medium": "中", "high": "高"},
                ),
            },
        }
    finally:
        db.close()


@router.get("/spaces/{space_id}/archive")
def space_archive(space_id: str, request: Request, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        spaces = list(
            db.scalars(
                select(Space)
                .where(Space.project_id == DEFAULT_PROJECT_ID, Space.archived_at.is_(None))
                .order_by(Space.created_at)
            ).all()
        )
        by_id = {space.id: space for space in spaces}
        selected = by_id.get(space_id)
        if selected is None:
            raise HTTPException(status_code=404, detail="空间不存在。")
        child_ids: dict[str | None, list[str]] = defaultdict(list)
        for space in spaces:
            child_ids[space.parent_id].append(space.id)
        descendant_ids: set[str] = set()
        pending = [space_id]
        while pending:
            current = pending.pop()
            if current in descendant_ids:
                continue
            descendant_ids.add(current)
            pending.extend(child_ids.get(current, []))

        records = list_project_records(db)
        serialized = serialize_records(db, records)
        matched = [
            serialized[record.id]
            for record in records
            if descendant_ids.intersection(serialized[record.id]["space_ids"])
        ]
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for record in matched:
            grouped[record["record_type"]].append(record)
        material_map = {
            material["id"]: material
            for record in matched
            for material in record["materials"]
        }
        breadcrumbs: list[dict[str, str]] = []
        cursor: Space | None = selected
        while cursor is not None:
            breadcrumbs.append({"id": cursor.id, "name": cursor.name})
            cursor = by_id.get(cursor.parent_id) if cursor.parent_id else None
        breadcrumbs.reverse()
        return {
            "space": {
                "id": selected.id,
                "name": selected.name,
                "kind": selected.kind,
                "parent_id": selected.parent_id,
            },
            "breadcrumbs": breadcrumbs,
            "children": [
                {
                    "id": by_id[item_id].id,
                    "name": by_id[item_id].name,
                    "kind": by_id[item_id].kind,
                    "parent_id": by_id[item_id].parent_id,
                }
                for item_id in child_ids.get(space_id, [])
            ],
            "descendant_ids": sorted(descendant_ids),
            "summary": {
                "record_count": len(matched),
                "unclosed_issue_count": sum(
                    1
                    for record in matched
                    if record["record_type"] == "issue" and record["status"] != "done"
                ),
                "measurement_count": len(grouped.get("measurement", [])),
                "material_count": len(material_map),
            },
            "records_by_type": grouped,
            "materials": list(material_map.values()),
            "analytics": {
                "type_distribution": distribution(
                    (record["record_type"] for record in matched), TYPE_LABELS
                ),
                "issue_status_distribution": distribution(
                    (
                        record["status"]
                        for record in matched
                        if record["record_type"] == "issue"
                    ),
                    STATUS_LABELS,
                ),
                "expense_minor": sum(
                    int(record.get("amount_minor") or 0)
                    for record in matched
                    if record["record_type"] == "ledger"
                    and is_effective_ledger(record)
                    and record.get("direction") == "expense"
                    and record.get("currency", "CNY") == "CNY"
                ),
                "refund_minor": sum(
                    int(record.get("amount_minor") or 0)
                    for record in matched
                    if record["record_type"] == "ledger"
                    and is_effective_ledger(record)
                    and record.get("direction") == "refund"
                    and record.get("currency", "CNY") == "CNY"
                ),
                "income_minor": sum(
                    int(record.get("amount_minor") or 0)
                    for record in matched
                    if record["record_type"] == "ledger"
                    and is_effective_ledger(record)
                    and record.get("direction") == "income"
                    and record.get("currency", "CNY") == "CNY"
                ),
            },
        }
    finally:
        db.close()


@router.get("/search")
def search(
    request: Request,
    user: User,
    q: str | None = Query(default=None, max_length=200),
    record_type: str | None = None,
    space_id: str | None = None,
    stage_id: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    if not q and not any([record_type, space_id, stage_id, status, date_from, date_to]):
        raise HTTPException(status_code=400, detail="请输入关键词或至少选择一个筛选条件。")
    db = _db(request)
    try:
        records, serialized = _filtered_records(
            db,
            keyword=q,
            record_type=record_type,
            space_id=space_id,
            stage_id=stage_id,
            status=status,
            date_from=date_from,
            date_to=date_to,
        )
        record_results = [serialized[record.id] for record in records]
        keyword = q.casefold() if q else None

        def contains(*values: Any) -> bool:
            return bool(keyword) and any(
                keyword in str(value or "").casefold() for value in values
            )

        sources = []
        materials = []
        vendors = []
        spaces = []
        if keyword:
            sources = [
                {
                    "id": item.id,
                    "original_text": item.original_text,
                    "captured_at": item.captured_at,
                    "reported_time_text": item.reported_time_text,
                }
                for item in db.scalars(
                    select(SourceEntry).where(
                        SourceEntry.project_id == DEFAULT_PROJECT_ID,
                        or_(
                            SourceEntry.original_text.contains(q),
                            SourceEntry.reported_time_text.contains(q),
                        ),
                    )
                ).all()
            ]
            materials = [
                {"id": item.id, "name": item.name, "brand": item.brand, "model": item.model}
                for item in db.scalars(
                    select(Material).where(Material.project_id == DEFAULT_PROJECT_ID)
                ).all()
                if contains(item.name, item.notes, item.brand, item.model, item.color, item.finish)
            ]
            vendors = [
                {"id": item.id, "name": item.name, "notes": item.notes}
                for item in db.scalars(
                    select(Vendor).where(Vendor.project_id == DEFAULT_PROJECT_ID)
                ).all()
                if contains(item.name, item.notes)
            ]
            spaces = [
                {"id": item.id, "name": item.name, "kind": item.kind, "parent_id": item.parent_id}
                for item in db.scalars(
                    select(Space).where(
                        Space.project_id == DEFAULT_PROJECT_ID, Space.archived_at.is_(None)
                    )
                ).all()
                if contains(item.name, item.kind)
            ]

        groups = {
            "sources": sources,
            "records": record_results,
            "materials": materials,
            "vendors": vendors,
            "spaces": spaces,
        }
        return {
            "query": q,
            "counts": {key: len(items) for key, items in groups.items()},
            "groups": {key: items[offset : offset + limit] for key, items in groups.items()},
            "limit": limit,
            "offset": offset,
        }
    finally:
        db.close()
