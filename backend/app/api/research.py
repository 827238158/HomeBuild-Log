from __future__ import annotations

from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.domain import (
    User,
    _create_record_in_session,
    _current_project,
    _db,
    _get_record,
    _now,
    _record_json,
    log_audit,
)
from app.domain_models import (
    DEFAULT_PROJECT_ID,
    Record,
    ResearchConclusion,
    ResearchEntry,
)
from app.models import SourceEntry
from app.record_schemas import ResearchCreate
from app.research_history import append_conclusion

router = APIRouter(prefix="/research", tags=["research"])
ResearchState = Literal["collecting", "comparing", "concluded", "archived"]


class TopicInput(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=10000)


class TopicUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=10000)
    status: ResearchState | None = None


class EntryInput(BaseModel):
    research_date: date
    content: str = Field(min_length=1, max_length=20000)
    sources: list[str] = Field(default_factory=list, max_length=100)
    uncertainties: str | None = Field(default=None, max_length=10000)


class ConclusionInput(BaseModel):
    conclusion: str | None = Field(max_length=20000)
    reason: str = Field(min_length=1, max_length=10000)
    entry_id: str | None = None


def _required(value: str | None, label: str) -> str:
    if not value or not value.strip():
        raise HTTPException(status_code=422, detail=f"{label}不能为空。")
    return value.strip()


def _topic(db: Session, record_id: str) -> Record:
    item = _get_record(db, record_id)
    if item.record_type != "research" or item.archived_at is not None:
        raise HTTPException(status_code=404, detail="调研主题不存在。")
    return item


def _serialize(db: Session, item: Record) -> dict[str, Any]:
    result = _record_json(db, item)
    # 主题列表展示真实创建与最近更新时间，不能依赖通用审计快照的字段。
    result["created_at"] = item.created_at
    result["updated_at"] = item.updated_at
    entries = db.scalars(select(ResearchEntry).where(
        ResearchEntry.record_id == item.id
    ).order_by(ResearchEntry.research_date, ResearchEntry.created_at, ResearchEntry.id)).all()
    history = db.scalars(select(ResearchConclusion).where(
        ResearchConclusion.record_id == item.id
    ).order_by(ResearchConclusion.created_at, ResearchConclusion.id)).all()
    result["entries"] = [{
        "id": row.id, "record_id": row.record_id, "research_date": row.research_date,
        "content": row.content, "sources": row.sources, "uncertainties": row.uncertainties,
        "created_at": row.created_at,
    } for row in entries]
    result["conclusion_history"] = [{
        "id": row.id, "record_id": row.record_id, "conclusion": row.conclusion,
        "reason": row.reason, "entry_id": row.entry_id, "created_at": row.created_at,
    } for row in history]
    return result


@router.get("")
def list_topics(
    request: Request, user: User,
    state: Literal["all", "collecting", "comparing", "concluded", "archived"] = "all",
) -> dict[str, Any]:
    db = _db(request)
    try:
        records = db.scalars(select(Record).where(
            Record.project_id == DEFAULT_PROJECT_ID, Record.record_type == "research",
            Record.archived_at.is_(None),
        ).order_by(Record.updated_at.desc(), Record.id)).all()
        summary = {"total": len(records), **{
            key: sum(row.status == key for row in records)
            for key in ("collecting", "comparing", "concluded", "archived")
        }}
        return {"items": [_serialize(db, row) for row in records
                          if state == "all" or row.status == state], "summary": summary}
    finally:
        db.close()


@router.post("", status_code=201)
def create_topic(request: Request, body: TopicInput, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        _current_project(db)
        title = _required(body.title, "调研问题")
        # 随手记录同时保留原始来源，继续遵守正式记录的事实追溯约束。
        source = SourceEntry(project_id=DEFAULT_PROJECT_ID, input_type="text",
                             original_text=title + ("\n" + body.description
                                                    if body.description else ""))
        db.add(source)
        db.flush()
        log_audit(db, "create", "source_entries", source.id,
                  after={"input_type": "text", "original_text": source.original_text})
        record = _create_record_in_session(db, ResearchCreate(
            record_type="research", title=title, question=title, status="collecting",
            description=body.description, source_refs=[{"source_id": source.id}],
        ))
        result = _serialize(db, record)
        db.commit()
        return result
    finally:
        db.close()


@router.get("/{record_id}")
def get_topic(record_id: str, request: Request, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        return _serialize(db, _topic(db, record_id))
    finally:
        db.close()


@router.patch("/{record_id}")
def update_topic(
    record_id: str, request: Request, body: TopicUpdate, user: User,
) -> dict[str, Any]:
    db = _db(request)
    try:
        item = _topic(db, record_id)
        before = _record_json(db, item)
        payload = body.model_dump(exclude_unset=True)
        if "title" in payload:
            payload["title"] = _required(payload["title"], "调研问题")
        if "status" in payload and payload["status"] is None:
            raise HTTPException(status_code=422, detail="调研状态不能为空。")
        for key, value in payload.items():
            setattr(item, key, value)
        item.updated_at = _now()
        db.flush()
        result = _serialize(db, item)
        log_audit(db, "update", "records", item.id, before=before, after=result)
        db.commit()
        return result
    finally:
        db.close()


@router.post("/{record_id}/entries", status_code=201)
def append_entry(
    record_id: str, request: Request, body: EntryInput, user: User,
) -> dict[str, Any]:
    db = _db(request)
    try:
        item = _topic(db, record_id)
        entry = ResearchEntry(
            record_id=item.id, research_date=body.research_date,
            content=_required(body.content, "调研内容"),
            sources=[_required(value, "来源") for value in body.sources],
            uncertainties=body.uncertainties,
        )
        db.add(entry)
        item.updated_at = _now()
        db.flush()
        log_audit(db, "create", "research_entries", entry.id, after=body.model_dump())
        result = _serialize(db, item)
        db.commit()
        return result
    finally:
        db.close()


@router.post("/{record_id}/conclusions", status_code=201)
def revise_conclusion(
    record_id: str, request: Request, body: ConclusionInput, user: User,
) -> dict[str, Any]:
    db = _db(request)
    try:
        item = _topic(db, record_id)
        before = _record_json(db, item)
        append_conclusion(db, item, body.conclusion, _required(body.reason, "修正原因"),
                          body.entry_id)
        item.updated_at = _now()
        db.flush()
        result = _serialize(db, item)
        log_audit(db, "update", "records", item.id, before=before, after=result)
        db.commit()
        return result
    finally:
        db.close()
