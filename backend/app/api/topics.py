from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.domain import User, _current_project, _db, _get_record, _now
from app.api.pitfalls import _get_pitfall, _pitfall_json
from app.audit import log_audit
from app.domain_models import DEFAULT_PROJECT_ID
from app.projections import serialize_records
from app.record_version import bump_record_version
from app.topic_models import IssueActivity, Topic
from app.topic_service import (
    get_pitfall_topic_ids,
    get_record_topic_ids,
    get_topic,
    issue_activity_json,
    replace_pitfall_topics,
    replace_record_topics,
    topic_activities,
    topic_pitfalls,
    topic_records,
)

router = APIRouter(tags=["topics"])


class TopicInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=10000)
    current_situation: str | None = Field(default=None, max_length=10000)


class TopicUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    goal: str | None = Field(default=None, max_length=10000)
    current_situation: str | None = Field(default=None, max_length=10000)
    status: Literal["active", "archived"] | None = None


class NoteInput(BaseModel):
    content: str = Field(min_length=1, max_length=10000)


def _name(db: Session, name: str | None, identity: str | None = None) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="主题名称不能为空。")
    duplicate = db.scalar(select(Topic).where(
        Topic.project_id == DEFAULT_PROJECT_ID, Topic.name == name, Topic.id != (identity or ""),
    ))
    if duplicate:
        raise HTTPException(status_code=409, detail="当前项目已存在同名主题。")
    return name


def _json(item: Topic) -> dict[str, Any]:
    return {key: getattr(item, key) for key in (
        "id", "project_id", "name", "goal", "current_situation", "status",
        "created_at", "updated_at",
    )}


def _detail(db: Session, item: Topic) -> dict[str, Any]:
    records = topic_records(db, item.id)
    projections = serialize_records(db, records)
    return {**_json(item), "records": [projections[row.id] for row in records],
            "pitfalls": [_pitfall_json(row, db) for row in topic_pitfalls(db, item.id)]}


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="内容已被其他操作修改，请刷新后重试。",
        ) from None


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="当前项目已存在同名主题。") from None


@router.get("/topics")
def list_topics(request: Request, user: User, search: str = "",
                state: Literal["all", "active", "archived"] = "all") -> dict:
    db = _db(request)
    try:
        rows = db.scalars(select(Topic).where(Topic.project_id == DEFAULT_PROJECT_ID)
                          .order_by(Topic.updated_at.desc(), Topic.id)).all()
        summary = {"total": len(rows), **{
            status: sum(row.status == status for row in rows) for status in ("active", "archived")
        }}
        keyword = search.strip().casefold()
        return {"items": [_json(row) for row in rows
                          if (state == "all" or row.status == state)
                          and (not keyword or keyword in " ".join(
                              [row.name, row.goal or "", row.current_situation or ""],
                          ).casefold())], "summary": summary}
    finally:
        db.close()


@router.post("/topics", status_code=201)
def create_topic(request: Request, body: TopicInput, user: User) -> dict:
    db = _db(request)
    try:
        _current_project(db)
        item = Topic(project_id=DEFAULT_PROJECT_ID, **{
            **body.model_dump(), "name": _name(db, body.name),
        })
        db.add(item)
        _flush(db)
        log_audit(db, "create", "topics", item.id, after=jsonable_encoder(_json(item)))
        _commit(db)
        return _detail(db, item)
    finally:
        db.close()


@router.get("/topics/{topic_id}")
def detail(topic_id: str, request: Request, user: User) -> dict:
    db = _db(request)
    try:
        return _detail(db, get_topic(db, topic_id))
    finally:
        db.close()


@router.patch("/topics/{topic_id}")
def update(topic_id: str, request: Request, body: TopicUpdate, user: User) -> dict:
    db = _db(request)
    try:
        item = get_topic(db, topic_id)
        before = jsonable_encoder(_json(item))
        payload = body.model_dump(exclude_unset=True)
        if "name" in payload:
            payload["name"] = _name(db, payload["name"], item.id)
        if "status" in payload and payload["status"] is None:
            raise HTTPException(status_code=422, detail="主题状态不能为空。")
        for key, value in payload.items():
            setattr(item, key, value)
        item.updated_at = _now()
        _flush(db)
        log_audit(db, "update", "topics", item.id, before=before,
                  after=jsonable_encoder(_json(item)))
        _commit(db)
        return _detail(db, item)
    finally:
        db.close()


@router.get("/topics/{topic_id}/overview")
def overview(topic_id: str, request: Request, user: User) -> dict:
    db = _db(request)
    try:
        get_topic(db, topic_id)
        records = [row for row in topic_records(db, topic_id)
                   if row.record_type == "issue" and row.status != "done"]
        projections = serialize_records(db, records)
        return {"pending_issues": [projections[row.id] for row in records],
                "recent_activities": topic_activities(db, topic_id)[:10]}
    finally:
        db.close()


@router.get("/topics/{topic_id}/activities")
def activities(topic_id: str, request: Request, user: User,
               record_type: Literal["event", "ledger", "issue", "measurement", "decision",
                                    "research", "pitfall"] | None = None,
               offset: int = Query(default=0, ge=0),
               limit: int = Query(default=30, ge=1, le=100)) -> dict:
    db = _db(request)
    try:
        get_topic(db, topic_id)
        items = topic_activities(db, topic_id, record_type)
        return {"items": items[offset:offset + limit], "total": len(items),
                "offset": offset, "limit": limit}
    finally:
        db.close()


def _link(topic_id: str, object_id: str, request: Request, kind: str, remove: bool,
          expected_version: int | None = None) -> dict:
    db = _db(request)
    try:
        topic = get_topic(db, topic_id)
        if kind == "record":
            item = _get_record(db, object_id)
            bump_record_version(db, item, expected_version)
            ids = get_record_topic_ids(db, item.id)
            replace = replace_record_topics
        else:
            item = _get_pitfall(db, object_id)
            ids = get_pitfall_topic_ids(db, item.id)
            replace = replace_pitfall_topics
        updated = [value for value in ids if value != topic_id] if remove else [*ids, topic_id]
        replace(db, item, updated)
        if set(ids) != set(updated):
            log_audit(db, "update", "topics", topic.id,
                      after={"object_kind": kind, "object_id": object_id,
                             "action": "unlink" if remove else "link"})
        _commit(db)
        return _detail(db, topic)
    finally:
        db.close()


@router.put("/topics/{topic_id}/records/{record_id}")
def link_record(topic_id: str, record_id: str, request: Request, user: User,
                expected_version: int = Query(ge=1)) -> dict:
    return _link(topic_id, record_id, request, "record", False, expected_version)


@router.delete("/topics/{topic_id}/records/{record_id}")
def unlink_record(topic_id: str, record_id: str, request: Request, user: User,
                  expected_version: int = Query(ge=1)) -> dict:
    return _link(topic_id, record_id, request, "record", True, expected_version)


@router.put("/topics/{topic_id}/pitfalls/{pitfall_id}")
def link_pitfall(topic_id: str, pitfall_id: str, request: Request, user: User) -> dict:
    return _link(topic_id, pitfall_id, request, "pitfall", False)


@router.delete("/topics/{topic_id}/pitfalls/{pitfall_id}")
def unlink_pitfall(topic_id: str, pitfall_id: str, request: Request, user: User) -> dict:
    return _link(topic_id, pitfall_id, request, "pitfall", True)


def _issue_items(db: Session, record_id: str) -> dict:
    record = _get_record(db, record_id)
    if record.record_type != "issue":
        raise HTTPException(status_code=422, detail="只有待办与问题可以记录进展。")
    items = db.scalars(select(IssueActivity).where(IssueActivity.record_id == record_id)
                       .order_by(IssueActivity.created_at.desc(), IssueActivity.id.desc())).all()
    return {"items": [issue_activity_json(row) for row in items]}


@router.get("/records/{record_id}/activities")
def issue_activities(record_id: str, request: Request, user: User) -> dict:
    db = _db(request)
    try:
        return _issue_items(db, record_id)
    finally:
        db.close()


@router.post("/records/{record_id}/activities", status_code=201)
def append_note(record_id: str, request: Request, body: NoteInput, user: User) -> dict:
    db = _db(request)
    try:
        _issue_items(db, record_id)
        content = body.content.strip()
        if not content:
            raise HTTPException(status_code=422, detail="进展备注不能为空。")
        item = IssueActivity(record_id=record_id, kind="note", content=content)
        db.add(item)
        record = _get_record(db, record_id)
        bump_record_version(db, record)
        record.updated_at = _now()
        db.flush()
        log_audit(db, "create", "issue_activities", item.id,
                  after=jsonable_encoder(issue_activity_json(item)))
        _commit(db)
        return _issue_items(db, record_id)
    finally:
        db.close()
