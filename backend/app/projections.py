from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain_models import (
    DEFAULT_PROJECT_ID,
    Material,
    MeasurementValue,
    Participant,
    ProjectStage,
    Record,
    Space,
    Vendor,
    record_attachments,
    record_materials,
    record_participants,
    record_sources,
    record_spaces,
)
from app.core.constants import DETAIL_MODELS, DETAIL_RENAMES_TO_JSON

def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, list):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    return value


def list_project_records(db: Session, *, include_archived: bool = False) -> list[Record]:
    stmt = select(Record).where(Record.project_id == DEFAULT_PROJECT_ID)
    if not include_archived:
        stmt = stmt.where(Record.archived_at.is_(None))
    return list(db.scalars(stmt.order_by(Record.created_at.desc())).all())


def _named_associations(
    db: Session,
    table: Any,
    target_model: Any,
    target_column: str,
    record_ids: list[str],
) -> dict[str, list[dict[str, str]]]:
    if not record_ids:
        return {}
    rows = db.execute(
        select(table.c.record_id, target_model.id, target_model.name)
        .join(target_model, getattr(table.c, target_column) == target_model.id)
        .where(table.c.record_id.in_(record_ids))
    ).all()
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[row.record_id].append({"id": row.id, "name": row.name})
    return grouped


def serialize_records(db: Session, records: list[Record]) -> dict[str, dict[str, Any]]:
    """批量构建视图投影，避免每张卡片重复查询关联表。"""
    record_ids = [record.id for record in records]
    if not record_ids:
        return {}

    source_rows = db.execute(
        select(
            record_sources.c.record_id,
            record_sources.c.source_id,
            record_sources.c.evidence_excerpt,
        ).where(record_sources.c.record_id.in_(record_ids))
    ).all()
    source_refs: dict[str, list[dict[str, str | None]]] = defaultdict(list)
    for row in source_rows:
        source_refs[row.record_id].append(
            {"source_id": row.source_id, "evidence_excerpt": row.evidence_excerpt}
        )

    spaces = _named_associations(db, record_spaces, Space, "space_id", record_ids)
    materials = _named_associations(
        db, record_materials, Material, "material_id", record_ids
    )
    participants = _named_associations(
        db, record_participants, Participant, "participant_id", record_ids
    )

    attachment_rows = db.execute(
        select(record_attachments.c.record_id, record_attachments.c.attachment_id).where(
            record_attachments.c.record_id.in_(record_ids)
        )
    ).all()
    attachment_ids: dict[str, list[str]] = defaultdict(list)
    for row in attachment_rows:
        attachment_ids[row.record_id].append(row.attachment_id)

    stage_ids = {record.stage_id for record in records if record.stage_id}
    stages = {
        stage.id: {"id": stage.id, "name": stage.name}
        for stage in db.scalars(select(ProjectStage).where(ProjectStage.id.in_(stage_ids))).all()
    } if stage_ids else {}

    details: dict[str, dict[str, Any]] = defaultdict(dict)
    vendor_ids: set[str] = set()
    for record_type, model in DETAIL_MODELS.items():
        ids_for_type = [record.id for record in records if record.record_type == record_type]
        if not ids_for_type:
            continue
        for row in db.scalars(select(model).where(model.record_id.in_(ids_for_type))).all():
            values: dict[str, Any] = {}
            for column in model.__table__.columns:
                if column.name == "record_id":
                    continue
                key = DETAIL_RENAMES_TO_JSON.get(record_type, {}).get(column.name, column.name)
                values[key] = _plain(getattr(row, column.name))
            if values.get("vendor_id"):
                vendor_ids.add(values["vendor_id"])
            details[row.record_id] = values

    measurement_ids = [record.id for record in records if record.record_type == "measurement"]
    if measurement_ids:
        values_by_record: dict[str, list[dict[str, Any]]] = defaultdict(list)
        rows = db.scalars(
            select(MeasurementValue)
            .where(MeasurementValue.record_id.in_(measurement_ids))
            .order_by(MeasurementValue.record_id, MeasurementValue.ordinal)
        ).all()
        for row in rows:
            values_by_record[row.record_id].append(
                {"axis": row.axis, "value": float(row.value), "unit": row.unit}
            )
        for record_id, values in values_by_record.items():
            details[record_id]["values"] = values

    vendors = {
        vendor.id: {"id": vendor.id, "name": vendor.name}
        for vendor in db.scalars(select(Vendor).where(Vendor.id.in_(vendor_ids))).all()
    } if vendor_ids else {}

    result: dict[str, dict[str, Any]] = {}
    for record in records:
        detail = details.get(record.id, {})
        vendor_id = detail.get("vendor_id")
        result[record.id] = {
            "id": record.id,
            "project_id": record.project_id,
            "record_type": record.record_type,
            "title": record.title,
            "description": record.description,
            "occurred_at": _plain(record.occurred_at),
            "time_precision": record.time_precision,
            "original_time_text": record.original_time_text,
            "timezone": record.timezone,
            "stage_id": record.stage_id,
            "stage": stages.get(record.stage_id),
            "status": record.status,
            "archived_at": _plain(record.archived_at),
            "created_at": _plain(record.created_at),
            "updated_at": _plain(record.updated_at),
            "source_refs": source_refs.get(record.id, []),
            "space_ids": [item["id"] for item in spaces.get(record.id, [])],
            "spaces": spaces.get(record.id, []),
            "material_ids": [item["id"] for item in materials.get(record.id, [])],
            "materials": materials.get(record.id, []),
            "participant_ids": [item["id"] for item in participants.get(record.id, [])],
            "participants": participants.get(record.id, []),
            "attachment_ids": attachment_ids.get(record.id, []),
            "vendor": vendors.get(vendor_id),
            **detail,
        }
    return result


def effective_date(record: dict[str, Any]) -> date | None:
    candidates = [
        record.get("occurred_at"),
        record.get("started_at"),
        record.get("payment_date"),
        record.get("discovered_at"),
        record.get("measured_at"),
        record.get("confirmed_at"),
        record.get("planned_at"),
        record.get("due_at"),
        record.get("promised_date"),
    ]
    for value in candidates:
        if not value:
            continue
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            continue
    return None


def record_search_text(record: dict[str, Any]) -> str:
    # JSON 展平可覆盖八类详情字段，同时不引入阶段 5 的全文索引。
    return json.dumps(record, ensure_ascii=False, default=str).casefold()


def record_matches(
    record: dict[str, Any],
    *,
    keyword: str | None = None,
    record_type: str | None = None,
    space_id: str | None = None,
    stage_id: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> bool:
    if keyword and keyword.casefold() not in record_search_text(record):
        return False
    if record_type and record["record_type"] != record_type:
        return False
    if space_id and space_id not in record["space_ids"]:
        return False
    if stage_id and record.get("stage_id") != stage_id:
        return False
    if status and record.get("status") != status:
        return False
    item_date = effective_date(record)
    if date_from and (item_date is None or item_date < date_from):
        return False
    if date_to and (item_date is None or item_date > date_to):
        return False
    return True
