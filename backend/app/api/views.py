from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

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
            if record.record_type in {"ledger", "procurement"}
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
        ledgers = [item for item in selected if item["record_type"] == "ledger"]
        procurements = [item for item in selected if item["record_type"] == "procurement"]
        procurement_ids = {item["id"] for item in procurements}
        links: dict[str, list[str]] = defaultdict(list)
        for relation in _relations(db):
            if relation.relation_type == "pays_for" and relation.to_record_id in procurement_ids:
                links[relation.from_record_id].append(relation.to_record_id)

        allocated: dict[str, list[dict[str, Any]]] = defaultdict(list)
        warnings: list[str] = []
        unallocated: list[dict[str, Any]] = []
        for ledger in ledgers:
            targets = list(dict.fromkeys(links.get(ledger["id"], [])))
            if ledger["status"] != "posted":
                continue
            if len(targets) != 1:
                unallocated.append(ledger)
                if len(targets) > 1:
                    warnings.append(f"流水“{ledger['title']}”关联多个采购，未参与待付计算。")
                continue
            target = next(item for item in procurements if item["id"] == targets[0])
            if target.get("currency", "CNY") != ledger.get("currency", "CNY"):
                unallocated.append(ledger)
                warnings.append(f"流水“{ledger['title']}”与采购币种不同，未参与待付计算。")
                continue
            allocated[target["id"]].append(ledger)

        totals: dict[str, dict[str, int | str]] = {}

        def currency_total(currency: str) -> dict[str, int | str]:
            return totals.setdefault(
                currency,
                {
                    "currency": currency,
                    "procurement_total_minor": 0,
                    "expense_minor": 0,
                    "refund_minor": 0,
                    "income_minor": 0,
                    "net_paid_minor": 0,
                    "outstanding_minor": 0,
                    "overpaid_minor": 0,
                    "unallocated_expense_minor": 0,
                    "unallocated_refund_minor": 0,
                    "unallocated_income_minor": 0,
                },
            )

        procurement_rows: list[dict[str, Any]] = []
        for procurement in procurements:
            currency = procurement.get("currency", "CNY")
            total = currency_total(currency)
            order_total = int(procurement.get("order_total_minor") or 0)
            if procurement["status"] != "cancelled":
                total["procurement_total_minor"] += order_total
            linked = allocated.get(procurement["id"], [])
            expense = sum(
                int(item["amount_minor"])
                for item in linked
                if item["direction"] == "expense"
            )
            refund = sum(
                int(item["amount_minor"])
                for item in linked
                if item["direction"] == "refund"
            )
            income = sum(
                int(item["amount_minor"])
                for item in linked
                if item["direction"] == "income"
            )
            net = expense - refund
            outstanding = max(order_total - net, 0) if procurement["status"] != "cancelled" else 0
            overpaid = max(net - order_total, 0) if procurement["status"] != "cancelled" else 0
            total["outstanding_minor"] += outstanding
            total["overpaid_minor"] += overpaid
            procurement_rows.append(
                {
                    **procurement,
                    "paid_minor": expense,
                    "refund_minor": refund,
                    "income_minor": income,
                    "net_paid_minor": net,
                    "outstanding_minor": outstanding,
                    "overpaid_minor": overpaid,
                    "calculation_record_ids": [item["id"] for item in linked],
                }
            )

        _DIRECTION_FIELD: dict[str, str] = {
            "expense": "expense_minor",
            "refund": "refund_minor",
            "income": "income_minor",
        }
        _DIRECTION_UNALLOCATED: dict[str, str] = {
            "expense": "unallocated_expense_minor",
            "refund": "unallocated_refund_minor",
            "income": "unallocated_income_minor",
        }
        for ledger in ledgers:
            if ledger["status"] != "posted":
                continue
            total = currency_total(ledger.get("currency", "CNY"))
            field = _DIRECTION_FIELD.get(ledger["direction"])
            if field:
                total[field] += int(ledger["amount_minor"])
        for total in totals.values():
            total["net_paid_minor"] = int(total["expense_minor"]) - int(total["refund_minor"])
        for ledger in unallocated:
            total = currency_total(ledger.get("currency", "CNY"))
            field = _DIRECTION_UNALLOCATED.get(ledger["direction"])
            if field:
                total[field] += int(ledger["amount_minor"])

        return {
            "totals_by_currency": list(totals.values()),
            "procurements": procurement_rows,
            "ledger_entries": ledgers,
            "warnings": warnings,
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
        todos = {
            record.id: serialized[record.id]
            for record in records
            if record.record_type == "todo"
            and serialized[record.id]["status"] not in {"done", "cancelled"}
        }
        todo_by_issue: dict[str, list[dict[str, Any]]] = defaultdict(list)
        issue_ids = {item["id"] for item in issues}
        for relation in _relations(db):
            if relation.from_record_id in issue_ids and relation.to_record_id in todos:
                todo_by_issue[relation.from_record_id].append(todos[relation.to_record_id])
            if relation.to_record_id in issue_ids and relation.from_record_id in todos:
                todo_by_issue[relation.to_record_id].append(todos[relation.from_record_id])

        status_meta = [
            ("open", "发现"),
            ("in_progress", "处理中"),
            ("waiting", "等待"),
            ("resolved", "已解决"),
            ("closed", "已关闭"),
        ]
        cards_by_status: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for issue in issues:
            cards_by_status[issue["status"]].append(
                {
                    **issue,
                    "next_todos": todo_by_issue.get(issue["id"], []),
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
                    if record["record_type"] == "issue" and record["status"] != "closed"
                ),
                "measurement_count": len(grouped.get("measurement", [])),
                "material_count": len(material_map),
            },
            "records_by_type": grouped,
            "materials": list(material_map.values()),
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
