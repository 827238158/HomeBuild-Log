from __future__ import annotations

import json
import time
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.audit import log_audit
from app.auth import CurrentUser, require_user
from app.db import create_session_factory
from app.domain_models import DEFAULT_PROJECT_ID, Pitfall, PitfallResolution, Project

router = APIRouter(tags=["pitfalls"], prefix="/pitfalls")
User = Annotated[CurrentUser, Depends(require_user)]


def _db(request: Request) -> Session:
    return create_session_factory(request.app.state.engine)()


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _required_text(value: str, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail=f"{label}不能为空。")
    return cleaned


class PitfallInput(BaseModel):
    occurred_date: date
    description: str = Field(max_length=10000)


class PitfallUpdate(BaseModel):
    occurred_date: date | None = None
    description: str | None = Field(default=None, max_length=10000)


class ResolutionInput(BaseModel):
    resolved_date: date
    content: str = Field(max_length=10000)


class ResolutionUpdate(BaseModel):
    resolved_date: date | None = None
    content: str | None = Field(default=None, max_length=10000)


class AIAnalysisDraft(BaseModel):
    summary: str = Field(min_length=1)
    recurring_patterns: list[str] = Field(default_factory=list)
    approaches: list[str] = Field(default_factory=list)
    unresolved_items: list[str] = Field(default_factory=list)
    prevention_advice: list[str] = Field(default_factory=list)


def _resolution_json(item: PitfallResolution) -> dict[str, Any]:
    return {
        "id": item.id,
        "pitfall_id": item.pitfall_id,
        "resolved_date": item.resolved_date,
        "content": item.content,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _pitfall_json(item: Pitfall) -> dict[str, Any]:
    resolutions = sorted(item.resolutions, key=lambda row: (row.resolved_date, row.created_at))
    return {
        "id": item.id,
        "occurred_date": item.occurred_date,
        "description": item.description,
        "status": "resolved" if resolutions else "unresolved",
        "resolutions": [_resolution_json(row) for row in resolutions],
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _get_pitfall(db: Session, pitfall_id: str) -> Pitfall:
    item = db.execute(
        select(Pitfall)
        .options(selectinload(Pitfall.resolutions))
        .where(Pitfall.id == pitfall_id, Pitfall.project_id == DEFAULT_PROJECT_ID)
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="踩坑记录不存在。")
    return item


def _get_resolution(db: Session, resolution_id: str) -> PitfallResolution:
    item = db.execute(
        select(PitfallResolution)
        .join(Pitfall)
        .where(
            PitfallResolution.id == resolution_id,
            Pitfall.project_id == DEFAULT_PROJECT_ID,
        )
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="处理记录不存在。")
    return item


def _ensure_project(db: Session) -> None:
    if db.get(Project, DEFAULT_PROJECT_ID) is None:
        # 迁移会创建默认项目；直接建表的测试和首次空库访问仍需安全兜底。
        db.add(Project(id=DEFAULT_PROJECT_ID, name="我的装修", is_active=True))
        db.flush()


@router.get("")
def list_pitfalls(
    request: Request,
    user: User,
    state: Literal["all", "unresolved", "resolved"] = Query(default="all"),
) -> dict[str, Any]:
    db = _db(request)
    try:
        items = db.execute(
            select(Pitfall)
            .options(selectinload(Pitfall.resolutions))
            .where(Pitfall.project_id == DEFAULT_PROJECT_ID)
            .order_by(Pitfall.occurred_date.desc(), Pitfall.created_at.desc())
        ).scalars().all()
        serialized = [_pitfall_json(item) for item in items]
        total = len(serialized)
        unresolved = sum(item["status"] == "unresolved" for item in serialized)
        if state != "all":
            serialized = [item for item in serialized if item["status"] == state]
        return {
            "items": serialized,
            "summary": {"total": total, "unresolved": unresolved, "resolved": total - unresolved},
        }
    finally:
        db.close()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_pitfall(request: Request, body: PitfallInput, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        _ensure_project(db)
        item = Pitfall(
            project_id=DEFAULT_PROJECT_ID,
            occurred_date=body.occurred_date,
            description=_required_text(body.description, "踩坑经过"),
        )
        db.add(item)
        db.flush()
        log_audit(db, "create", "pitfalls", item.id, after=jsonable_encoder(_pitfall_json(item)))
        db.commit()
        return _pitfall_json(item)
    finally:
        db.close()


@router.post("/analyze")
def analyze_pitfalls(request: Request, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        items = db.execute(
            select(Pitfall)
            .options(selectinload(Pitfall.resolutions))
            .where(Pitfall.project_id == DEFAULT_PROJECT_ID)
            .order_by(Pitfall.occurred_date, Pitfall.created_at)
        ).scalars().all()
        if not items:
            raise HTTPException(status_code=422, detail="还没有踩坑记录，暂时无法分析。")
        source = json.dumps(
            [_pitfall_json(item) for item in items], ensure_ascii=False, default=str
        )
    finally:
        db.close()

    config = request.app.state.secrets.get_ai_config()
    if not config.enabled:
        raise HTTPException(status_code=503, detail="AI 尚未启用或未配置可用密钥。")

    system_prompt = (
        "你是装修复盘助手。只根据用户提供的踩坑与处理记录分析，不推断不存在的事实。"
        "返回 JSON，字段必须为 summary、recurring_patterns、approaches、unresolved_items、"
        "prevention_advice；后四项均为字符串数组。重点识别重复问题、已有做法、未处理事项和避免建议。"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"以下是全部踩坑记录，处理记录已按日期排列：\n{source}"},
    ]
    deadline = time.monotonic() + config.timeout_seconds
    failures: list[str] = []
    providers = [
        provider for name in config.provider_order
        if (provider := config.providers.get(name)) is not None and provider.api_key
    ]
    for index, provider in enumerate(providers):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            failures.append("总预算超时")
            break
        timeout_seconds = remaining / (len(providers) - index)
        headers = {"Content-Type": "application/json"}
        headers["api-key" if provider.auth_style == "api-key" else "Authorization"] = (
            provider.api_key if provider.auth_style == "api-key" else f"Bearer {provider.api_key}"
        )
        payload: dict[str, Any] = {
            "model": provider.model,
            "messages": messages,
            "temperature": config.temperature,
            "stream": False,
            "response_format": {"type": "json_object"},
        }
        if provider.name == "deepseek":
            payload["thinking"] = {"type": "disabled"}
        try:
            response = request.app.state.ai_http_client.post(
                f"{provider.base_url}/chat/completions",
                headers=headers,
                json=payload,
                timeout=httpx.Timeout(
                    max(0.1, timeout_seconds),
                    connect=min(5.0, max(0.1, timeout_seconds)),
                    pool=min(5.0, max(0.1, timeout_seconds)),
                ),
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("响应缺少文本内容")
            cleaned = content.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.removeprefix("```json").removeprefix("```")
                cleaned = cleaned.removesuffix("```").strip()
            draft = AIAnalysisDraft.model_validate_json(cleaned)
            return {
                **draft.model_dump(),
                "provider": provider.name,
                "model": provider.model,
                "generated_at": _now(),
            }
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, ValidationError):
            # 不向前端泄露供应商原始响应，只提供可行动的汇总错误。
            failures.append(f"{provider.name} 分析失败")
    raise HTTPException(status_code=503, detail="AI 分析失败：" + "；".join(failures))


@router.patch("/{pitfall_id}")
def update_pitfall(
    pitfall_id: str, request: Request, body: PitfallUpdate, user: User
) -> dict[str, Any]:
    db = _db(request)
    try:
        item = _get_pitfall(db, pitfall_id)
        before = _pitfall_json(item)
        if body.occurred_date is not None:
            item.occurred_date = body.occurred_date
        if body.description is not None:
            item.description = _required_text(body.description, "踩坑经过")
        item.updated_at = _now()
        after = _pitfall_json(item)
        log_audit(
            db,
            "update",
            "pitfalls",
            item.id,
            before=jsonable_encoder(before),
            after=jsonable_encoder(after),
        )
        db.commit()
        return after
    finally:
        db.close()


@router.delete("/{pitfall_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pitfall(pitfall_id: str, request: Request, user: User) -> None:
    db = _db(request)
    try:
        item = _get_pitfall(db, pitfall_id)
        before = jsonable_encoder(_pitfall_json(item))
        log_audit(db, "delete", "pitfalls", item.id, before=before)
        db.delete(item)
        db.commit()
    finally:
        db.close()


@router.post("/{pitfall_id}/resolutions", status_code=status.HTTP_201_CREATED)
def create_resolution(
    pitfall_id: str, request: Request, body: ResolutionInput, user: User
) -> dict[str, Any]:
    db = _db(request)
    try:
        pitfall = _get_pitfall(db, pitfall_id)
        item = PitfallResolution(
            pitfall_id=pitfall.id,
            resolved_date=body.resolved_date,
            content=_required_text(body.content, "处理内容"),
        )
        db.add(item)
        pitfall.updated_at = _now()
        db.flush()
        after = _resolution_json(item)
        log_audit(db, "create", "pitfall_resolutions", item.id, after=jsonable_encoder(after))
        db.commit()
        return after
    finally:
        db.close()


@router.patch("/resolutions/{resolution_id}")
def update_resolution(
    resolution_id: str, request: Request, body: ResolutionUpdate, user: User
) -> dict[str, Any]:
    db = _db(request)
    try:
        item = _get_resolution(db, resolution_id)
        before = _resolution_json(item)
        if body.resolved_date is not None:
            item.resolved_date = body.resolved_date
        if body.content is not None:
            item.content = _required_text(body.content, "处理内容")
        item.updated_at = _now()
        item.pitfall.updated_at = _now()
        after = _resolution_json(item)
        log_audit(
            db,
            "update",
            "pitfall_resolutions",
            item.id,
            before=jsonable_encoder(before),
            after=jsonable_encoder(after),
        )
        db.commit()
        return after
    finally:
        db.close()


@router.delete("/resolutions/{resolution_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resolution(resolution_id: str, request: Request, user: User) -> None:
    db = _db(request)
    try:
        item = _get_resolution(db, resolution_id)
        before = jsonable_encoder(_resolution_json(item))
        pitfall = item.pitfall
        log_audit(db, "delete", "pitfall_resolutions", item.id, before=before)
        db.delete(item)
        pitfall.updated_at = _now()
        db.commit()
    finally:
        db.close()
