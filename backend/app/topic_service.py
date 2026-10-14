from __future__ import annotations

from datetime import UTC, date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain_models import (
    DEFAULT_PROJECT_ID,
    IssueDetail,
    Pitfall,
    PitfallResolution,
    Record,
    ResearchEntry,
)
from app.projections import effective_date, serialize_records
from app.topic_models import IssueActivity, PitfallTopic, RecordTopic, Topic


def get_topic(db: Session, topic_id: str) -> Topic:
    item = db.get(Topic, topic_id)
    if item is None or item.project_id != DEFAULT_PROJECT_ID:
        raise HTTPException(status_code=404, detail="主题不存在。")
    return item


def get_record_topic_ids(db: Session, record_id: str) -> list[str]:
    return sorted(db.scalars(select(RecordTopic.topic_id).where(
        RecordTopic.record_id == record_id,
    )).all())


def get_pitfall_topic_ids(db: Session, pitfall_id: str) -> list[str]:
    return sorted(db.scalars(select(PitfallTopic.topic_id).where(
        PitfallTopic.pitfall_id == pitfall_id,
    )).all())


def _replace(db: Session, item: Record | Pitfall, ids: list[str], model: Any, column: str) -> None:
    if ids is None:
        raise HTTPException(status_code=422, detail="主题归属不能为空，请传入主题列表。")
    current = set(db.scalars(select(model.topic_id).where(
        getattr(model, column) == item.id,
    )).all())
    requested = set(ids)
    # 先验证全部归属，再修改；保留旧归档归属允许，新增归档归属须先恢复。
    for topic_id in requested:
        topic = db.get(Topic, topic_id)
        if topic is None or topic.project_id != item.project_id:
            raise HTTPException(status_code=422, detail="主题不存在或不属于当前项目。")
        if topic.status == "archived" and topic_id not in current:
            raise HTTPException(status_code=422, detail="请先恢复已归档主题，再关联内容。")
    removed = current - requested
    if removed:
        db.execute(delete(model).where(getattr(model, column) == item.id,
                                       model.topic_id.in_(removed)))
    for topic_id in requested - current:
        db.add(model(**{column: item.id, "topic_id": topic_id}))
    db.flush()


def replace_record_topics(db: Session, record: Record, topic_ids: list[str]) -> None:
    _replace(db, record, topic_ids, RecordTopic, "record_id")


def replace_pitfall_topics(db: Session, pitfall: Pitfall, topic_ids: list[str]) -> None:
    _replace(db, pitfall, topic_ids, PitfallTopic, "pitfall_id")


def log_issue_status(
    db: Session, record: Record, previous_status: str | None,
    previous_result: str | None = None,
    previous_completed_at: date | str | None = None,
) -> None:
    if record.record_type != "issue" or previous_status == record.status:
        return
    detail = db.get(IssueDetail, record.id)
    result = detail.actual_result if detail else None
    completed = (detail.completed_at if detail else None) or previous_completed_at
    # 保存完成快照；重新打开后也能在历史里追溯原处理结果。
    content = result or previous_result
    if completed:
        completed_text = completed.isoformat() if isinstance(completed, date) else completed
        content = f"完成日期：{completed_text}" + (f"\n{content}" if content else "")
    db.add(IssueActivity(record_id=record.id, kind="status", previous_status=previous_status,
                         next_status=record.status, content=content))
    db.flush()


def issue_activity_json(item: IssueActivity) -> dict[str, Any]:
    return {"id": item.id, "record_id": item.record_id, "kind": item.kind,
            "previous_status": item.previous_status, "next_status": item.next_status,
            "content": item.content, "created_at": item.created_at}


def topic_records(db: Session, topic_id: str) -> list[Record]:
    return list(db.scalars(select(Record).join(RecordTopic).where(
        RecordTopic.topic_id == topic_id, Record.archived_at.is_(None),
    ).order_by(Record.created_at.desc(), Record.id)).all())


def topic_pitfalls(db: Session, topic_id: str) -> list[Pitfall]:
    return list(db.scalars(select(Pitfall).join(PitfallTopic).where(
        PitfallTopic.topic_id == topic_id,
    ).order_by(Pitfall.occurred_date.desc(), Pitfall.id)).all())


def topic_activities(db: Session, topic_id: str, record_type: str | None = None) -> list[dict]:
    records = topic_records(db, topic_id)
    if record_type:
        records = [row for row in records if row.record_type == record_type]
    projections = serialize_records(db, records)
    items: list[dict] = []

    def append(kind: str, obj: str, identity: str, parent: str | None, category: str,
               title: str, content: str | None, when: date | datetime | None,
               created: datetime, **extra: Any) -> None:
        items.append({"id": f"{obj}:{identity}", "activity_kind": kind, "object_kind": obj,
                      "object_id": identity, "parent_id": parent, "record_type": category,
                      "title": title, "content": content, "occurred_at": when or created,
                      "date_missing": when is None, "created_at": created,
                      "previous_status": None, "next_status": None, **extra})

    for record in records:
        append("record", "record", record.id, None, record.record_type, record.title,
               record.description, effective_date(projections[record.id]), record.created_at)
    parents = {row.id: row for row in records}
    ids = list(parents)
    if ids:
        for entry in db.scalars(select(ResearchEntry).where(ResearchEntry.record_id.in_(ids))):
            append("research_entry", "research_entry", entry.id, entry.record_id, "research",
                   parents[entry.record_id].title, entry.content, entry.research_date,
                   entry.created_at)
        for entry in db.scalars(select(IssueActivity).where(IssueActivity.record_id.in_(ids))):
            if entry.kind == "status" and entry.previous_status is None:
                continue
            append(entry.kind, "issue_activity", entry.id, entry.record_id, "issue",
                   parents[entry.record_id].title, entry.content, entry.created_at,
                   entry.created_at, previous_status=entry.previous_status,
                   next_status=entry.next_status)
    pitfalls = topic_pitfalls(db, topic_id) if record_type in (None, "pitfall") else []
    for pitfall in pitfalls:
        append("pitfall", "pitfall", pitfall.id, None, "pitfall", pitfall.description,
               pitfall.description, pitfall.occurred_date, pitfall.created_at)
    pitfall_ids = {row.id: row for row in pitfalls}
    if pitfall_ids:
        for row in db.scalars(select(PitfallResolution).where(
            PitfallResolution.pitfall_id.in_(pitfall_ids),
        )):
            append("resolution", "pitfall_resolution", row.id, row.pitfall_id, "pitfall",
                   pitfall_ids[row.pitfall_id].description, row.content, row.resolved_date,
                   row.created_at)

    def sort_key(item: dict) -> tuple[datetime, str]:
        when = item["occurred_at"]
        if isinstance(when, date) and not isinstance(when, datetime):
            when = datetime.combine(when, time.min, ZoneInfo("Asia/Shanghai"))
        elif when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        return when.astimezone(UTC), item["id"]

    return sorted(items, key=sort_key, reverse=True)
