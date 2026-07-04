from __future__ import annotations

import copy
import hashlib
import time
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.ai_adapter import AIAdapterFailure, AIExtractionDraft, OpenAICompatibleAdapter
from app.auth import CurrentUser, require_user
from app.candidate_fields import candidate_validation_message, normalize_measurement_role
from app.core.constants import (
    CERTAINTY_LABELS,
    FIELDS_BY_TYPE,
    RELATION_TYPES,
    STATUS_DEFAULTS,
    TYPE_LABELS,
    VALID_ENUMS,
)
from app.db import create_session_factory
from app.domain_models import (
    DEFAULT_PROJECT_ID,
    CandidateBundle,
    ExtractionRun,
    Record,
    RecordRelation,
)
from app.local_suggestions import resolve_date_text, suggest_from_text, unique_resolved_date
from app.models import SourceEntry

from .domain import RECORD_CREATE_ADAPTER, _create_record_in_session, _record_json, log_audit

router = APIRouter(tags=["extractions"])
User = Annotated[CurrentUser, Depends(require_user)]


class CandidateSelection(BaseModel):
    key: str
    payload: dict[str, Any] | None = None


class CandidateConfirmRequest(BaseModel):
    expected_version: int = Field(ge=1)
    selections: list[CandidateSelection] = Field(default_factory=list)
    ignored_keys: list[str] = Field(default_factory=list)


class CandidateDeferRequest(BaseModel):
    expected_version: int = Field(ge=1)


def _db(request: Request) -> Session:
    return create_session_factory(request.app.state.engine)()


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _bundle_json(bundle: CandidateBundle) -> dict[str, Any]:
    content = copy.deepcopy(bundle.bundle_json)
    # 兼容历史候选包：旧版 questions 追问协议已停用，不再对外返回。
    content.pop("questions", None)
    return {
        "id": bundle.id,
        "source_id": bundle.source_id,
        "extraction_run_id": bundle.extraction_run_id,
        "source_revision": bundle.source_revision,
        "engine": bundle.engine,
        "status": bundle.status,
        "version": bundle.version,
        "created_at": bundle.created_at,
        "updated_at": bundle.updated_at,
        **content,
    }


def _refresh_bundle_status(bundle: CandidateBundle, content: dict[str, Any]) -> None:
    """按候选实际处理状态刷新候选包状态，避免已忽略候选继续显示为待处理。"""
    suggestions = content.get("suggestions", [])
    confirmed_count = sum(
        item.get("review_state") == "confirmed" or bool(item.get("confirmed_record_id"))
        for item in suggestions
    )
    active_count = sum(
        item.get("review_state") not in {"confirmed", "deferred"}
        and not item.get("confirmed_record_id")
        for item in suggestions
    )
    if active_count:
        bundle.status = "partially_confirmed" if confirmed_count else "pending"
    elif confirmed_count:
        bundle.status = "confirmed"
    else:
        bundle.status = "reviewed"


def _run_json(run: ExtractionRun, *, include_raw: bool = False) -> dict[str, Any]:
    result = {
        "id": run.id,
        "request_id": run.request_id,
        "source_id": run.source_id,
        "attempt_no": run.attempt_no,
        "requested_engine": run.requested_engine,
        "provider": run.provider,
        "model": run.model,
        "engine": run.engine,
        "status": run.status,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "duration_ms": run.duration_ms,
        "prompt_tokens": run.prompt_tokens,
        "completion_tokens": run.completion_tokens,
        "total_tokens": run.total_tokens,
        "error_code": run.error_code,
        "error_message": run.error_message,
    }
    if include_raw:
        result["prompt_text"] = run.prompt_text
        result["raw_response"] = run.raw_response
    return result


def _candidate_key(source_id: str, record_type: str, evidence: str, occurrence: int) -> str:
    normalized = " ".join(evidence.split()).lower()
    digest = hashlib.sha256(
        f"{source_id}|{record_type}|{normalized}|{occurrence}".encode()
    ).hexdigest()[:20]
    return f"{record_type}-{digest}"


def _origin_key(prefix: str, source_id: str, key: str, source_revision: int) -> str:
    # 第一版沿用历史键，后续来源版本使用显式版本段，避免覆盖旧正式记录。
    return (
        f"{prefix}:{source_id}:{key}"
        if source_revision == 1
        else f"{prefix}:{source_id}:r{source_revision}:{key}"
    )


def _existing_record_id(
    db: Session,
    source_id: str,
    key: str,
    engine: str,
    source_revision: int,
) -> str | None:
    prefixes = ["local"] if engine == "local-rule-v1" else ["candidate"]
    for prefix in prefixes:
        record = db.execute(
            select(Record).where(
                Record.project_id == DEFAULT_PROJECT_ID,
                Record.origin_key == _origin_key(prefix, source_id, key, source_revision),
            )
        ).scalar_one_or_none()
        if record is not None:
            return record.id
    return None


def _local_bundle_content(db: Session, source: SourceEntry) -> dict[str, Any]:
    local = suggest_from_text(source.id, source.original_text, source.captured_at)
    suggestions: list[dict[str, Any]] = []
    for item in local["suggestions"]:
        certainty = "inferred" if item["certainty"] == "likely" else item["certainty"]
        confirmed_record_id = _existing_record_id(
            db, source.id, item["key"], "local-rule-v1", source.revision
        )
        suggestions.append(
            {
                **item,
                "certainty": certainty,
                "certainty_label": CERTAINTY_LABELS[certainty],
                "selected_by_default": certainty == "explicit",
                "review_state": "confirmed" if confirmed_record_id else "active",
                "deferred_at": None,
                "confirmed_record_id": confirmed_record_id,
            }
        )
    return {
        "suggestions": suggestions,
        "relations": local["relations"],
        "warnings": [],
    }


def _ai_bundle_content(
    db: Session,
    source: SourceEntry,
    draft: AIExtractionDraft,
    engine: str,
) -> dict[str, Any]:
    suggestions: list[dict[str, Any]] = []
    ref_to_key: dict[str, str] = {}
    occurrences: dict[tuple[str, str], int] = defaultdict(int)
    warnings = list(draft.warnings)
    reference_date = source.captured_at.astimezone(ZoneInfo("Asia/Shanghai")).date()
    source_date = unique_resolved_date(source.original_text or "", reference_date)
    for candidate in draft.suggestions:
        occurrence_id = (candidate.record_type, " ".join(candidate.evidence.split()).lower())
        occurrence = occurrences[occurrence_id]
        occurrences[occurrence_id] += 1
        key = _candidate_key(source.id, candidate.record_type, candidate.evidence, occurrence)
        if candidate.ref in ref_to_key:
            warnings.append(f"模型重复使用候选引用 {candidate.ref}，后一个引用已忽略。")
            continue
        ref_to_key[candidate.ref] = key
        payload = copy.deepcopy(candidate.payload)
        # 候选协议只允许 YYYY-MM-DD，不再持久化旧的精度或分钟时间。
        payload.pop("occurred_at", None)
        payload.pop("time_precision", None)
        occurred_date = payload.get("occurred_date")
        if occurred_date is not None:
            try:
                date.fromisoformat(str(occurred_date))
            except ValueError:
                payload.pop("occurred_date", None)
                warnings.append(f"候选 {candidate.ref} 的发生日期格式无效，已留空待补充。")
        if not payload.get("occurred_date"):
            resolved_date, original_time_text, _inferred_year = resolve_date_text(
                candidate.evidence, reference_date
            )
            if resolved_date is None:
                resolved_date, original_time_text, _inferred_year = source_date
            if resolved_date is not None:
                payload["occurred_date"] = resolved_date.isoformat()
                payload["original_time_text"] = original_time_text
        missing_fields = list(candidate.missing_fields)
        if not payload.get("occurred_date") and "发生日期" not in missing_fields:
            missing_fields.append("发生日期")
        payload["record_type"] = candidate.record_type
        confirmed_record_id = _existing_record_id(
            db, source.id, key, engine, source.revision
        )
        suggestions.append(
            {
                "key": key,
                "record_type": candidate.record_type,
                "type_label": TYPE_LABELS[candidate.record_type],
                "summary": candidate.summary,
                "evidence": candidate.evidence,
                "certainty": candidate.certainty,
                "certainty_label": CERTAINTY_LABELS[candidate.certainty],
                "selected_by_default": candidate.certainty == "explicit",
                "payload": payload,
                "missing_fields": missing_fields,
                "review_state": "confirmed" if confirmed_record_id else "active",
                "deferred_at": None,
                "confirmed_record_id": confirmed_record_id,
            }
        )

    relations: list[dict[str, str]] = []
    for relation in draft.relations:
        from_key = ref_to_key.get(relation.from_ref)
        to_key = ref_to_key.get(relation.to_ref)
        if not from_key or not to_key:
            warnings.append("模型关系引用了不存在的候选，已忽略该关系。")
            continue
        relations.append(
            {
                "from_key": from_key,
                "to_key": to_key,
                "relation_type": relation.relation_type,
            }
        )
    return {
        "suggestions": suggestions,
        "relations": relations,
        "warnings": warnings,
    }


def _new_run(
    *,
    request_id: str,
    source_id: str,
    attempt_no: int,
    requested_engine: str,
    provider: str | None,
    model: str | None,
    engine: str,
    status: str,
    started_at: datetime,
    duration_ms: int,
    prompt_text: str | None = None,
    raw_response: str | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> ExtractionRun:
    return ExtractionRun(
        request_id=request_id,
        source_id=source_id,
        attempt_no=attempt_no,
        requested_engine=requested_engine,
        provider=provider,
        model=model,
        engine=engine,
        status=status,
        prompt_text=prompt_text,
        raw_response=raw_response,
        started_at=started_at,
        finished_at=_now(),
        duration_ms=duration_ms,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        error_code=error_code,
        error_message=error_message,
    )


def _persist_bundle(
    db: Session,
    *,
    source: SourceEntry,
    run: ExtractionRun,
    requested_engine: str,
    content: dict[str, Any],
    fallback_reason: str | None,
) -> CandidateBundle:
    previous = db.execute(
        select(CandidateBundle).where(
            CandidateBundle.source_id == source.id,
            CandidateBundle.status.in_(["pending", "partially_confirmed"]),
        )
    ).scalars()
    for old_bundle in previous:
        old_bundle.status = "superseded"
        old_bundle.updated_at = _now()

    bundle = CandidateBundle(
        source_id=source.id,
        extraction_run_id=run.id,
        engine=run.engine,
        status="pending",
        version=1,
        source_revision=source.revision,
        bundle_json={
            **content,
            "request_id": run.request_id,
            "requested_engine": requested_engine,
            "fallback_reason": fallback_reason,
        },
    )
    db.add(bundle)
    db.flush()
    log_audit(
        db,
        "create",
        "candidate_bundles",
        bundle.id,
        after={"source_id": source.id, "engine": bundle.engine, "status": bundle.status},
    )
    return bundle


@router.post("/sources/{source_id}/extractions", status_code=201)
def create_extraction(
    source_id: str,
    request: Request,
    user: User,
    engine: Literal["auto", "ai", "local"] = Query(default="auto"),
) -> dict[str, Any]:
    db = _db(request)
    try:
        source = db.get(SourceEntry, source_id)
        if source is None or source.project_id != DEFAULT_PROJECT_ID:
            raise HTTPException(status_code=404, detail="来源不存在。")
        if engine == "ai" and not (source.original_text or "").strip():
            raise HTTPException(status_code=422, detail="纯 AI 提取需要非空原始文字。")

        request_id = uuid.uuid4().hex
        config = request.app.state.secrets.get_ai_config()
        deadline = time.monotonic() + config.timeout_seconds
        failures: list[str] = []
        attempt_no = 0
        successful_run: ExtractionRun | None = None
        content: dict[str, Any] | None = None

        if engine != "local" and config.enabled:
            available_providers = [
                provider
                for provider_name in config.provider_order
                if (provider := config.providers.get(provider_name)) is not None
                and provider.api_key
            ]
            for index, provider in enumerate(available_providers):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    failures.append("AI_TOTAL_TIMEOUT")
                    break
                # 把剩余预算分给尚未尝试的供应商，确保主引擎超时后备引擎仍有机会。
                attempt_timeout = remaining / (len(available_providers) - index)
                attempt_no += 1
                started_at = _now()
                adapter = OpenAICompatibleAdapter(
                    provider,
                    temperature=config.temperature,
                    client=request.app.state.ai_http_client,
                )
                try:
                    reference_date = source.captured_at.astimezone(
                        ZoneInfo("Asia/Shanghai")
                    ).date().isoformat()
                    result = adapter.extract_from_text(
                        source.original_text or "",
                        attempt_timeout,
                        reference_date=reference_date,
                        timezone="Asia/Shanghai",
                    )
                    successful_run = _new_run(
                        request_id=request_id,
                        source_id=source.id,
                        attempt_no=attempt_no,
                        requested_engine=engine,
                        provider=provider.name,
                        model=provider.model,
                        engine=provider.model,
                        status="succeeded",
                        started_at=started_at,
                        duration_ms=result.duration_ms,
                        prompt_text=result.prompt_text,
                        raw_response=result.raw_response,
                        prompt_tokens=result.prompt_tokens,
                        completion_tokens=result.completion_tokens,
                        total_tokens=result.total_tokens,
                    )
                    db.add(successful_run)
                    db.flush()
                    content = _ai_bundle_content(db, source, result.draft, provider.model)
                    break
                except AIAdapterFailure as exc:
                    failures.append(f"{provider.name}:{exc.code}")
                    db.add(
                        _new_run(
                            request_id=request_id,
                            source_id=source.id,
                            attempt_no=attempt_no,
                            requested_engine=engine,
                            provider=provider.name,
                            model=provider.model,
                            engine=provider.model,
                            status="failed",
                            started_at=started_at,
                            duration_ms=exc.duration_ms,
                            prompt_text=exc.prompt_text,
                            raw_response=exc.raw_response,
                            error_code=exc.code,
                            error_message=str(exc),
                        )
                    )
                    db.flush()
        elif engine != "local":
            failures.append("AI_NOT_CONFIGURED")

        if successful_run is None:
            if engine == "ai":
                db.commit()
                raise HTTPException(
                    status_code=503,
                    detail="AI 提取失败：" + "；".join(failures or ["没有可用供应商"]),
                )
            attempt_no += 1
            started_at = _now()
            content = _local_bundle_content(db, source)
            successful_run = _new_run(
                request_id=request_id,
                source_id=source.id,
                attempt_no=attempt_no,
                requested_engine=engine,
                provider=None,
                model=None,
                engine="local-rule-v1",
                status="succeeded",
                started_at=started_at,
                duration_ms=0,
            )
            db.add(successful_run)
            db.flush()

        bundle = _persist_bundle(
            db,
            source=source,
            run=successful_run,
            requested_engine=engine,
            content=content
            or {"suggestions": [], "relations": [], "warnings": []},
            fallback_reason="；".join(failures) if failures else None,
        )
        result = _bundle_json(bundle)
        db.commit()
        return result
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="提取结果持久化发生冲突。") from exc
    finally:
        db.close()


@router.get("/candidate-bundles/{bundle_id}")
def get_candidate_bundle(bundle_id: str, request: Request, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        bundle = db.get(CandidateBundle, bundle_id)
        if bundle is None:
            raise HTTPException(status_code=404, detail="候选包不存在。")
        return _bundle_json(bundle)
    finally:
        db.close()


@router.get("/sources/{source_id}/candidate-bundles/latest")
def get_latest_candidate_bundle(
    source_id: str,
    request: Request,
    user: User,
) -> dict[str, Any] | None:
    db = _db(request)
    try:
        source = db.get(SourceEntry, source_id)
        if source is None or source.project_id != DEFAULT_PROJECT_ID:
            raise HTTPException(status_code=404, detail="来源不存在。")
        bundle = db.execute(
            select(CandidateBundle)
            .where(
                CandidateBundle.source_id == source_id,
                CandidateBundle.status != "superseded",
            )
            .order_by(CandidateBundle.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        return _bundle_json(bundle) if bundle else None
    finally:
        db.close()


def _load_current_bundle(db: Session, bundle_id: str, expected_version: int) -> CandidateBundle:
    bundle = db.get(CandidateBundle, bundle_id)
    if bundle is None:
        raise HTTPException(status_code=404, detail="候选包不存在。")
    if bundle.status == "superseded":
        raise HTTPException(status_code=409, detail="候选包已被新版本替代，请重新加载。")
    source = db.get(SourceEntry, bundle.source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="候选对应的来源不存在。")
    if bundle.source_revision != source.revision:
        raise HTTPException(status_code=409, detail="原始数据已修改，请重新分析后确认。")
    if bundle.version != expected_version:
        raise HTTPException(status_code=409, detail="候选包版本已变化，请重新加载。")
    return bundle


@router.post("/candidate-bundles/{bundle_id}/suggestions/{candidate_key}/defer")
def defer_candidate(
    bundle_id: str,
    candidate_key: str,
    request: Request,
    body: CandidateDeferRequest,
    user: User,
) -> dict[str, Any]:
    db = _db(request)
    try:
        bundle = _load_current_bundle(db, bundle_id, body.expected_version)
        content = copy.deepcopy(bundle.bundle_json)
        candidate = next(
            (item for item in content.get("suggestions", []) if item.get("key") == candidate_key),
            None,
        )
        if candidate is None:
            raise HTTPException(status_code=404, detail="候选记录不存在。")
        if candidate.get("confirmed_record_id"):
            raise HTTPException(status_code=409, detail="已确认候选不能移除，请到记录详情中处理。")
        candidate["review_state"] = "deferred"
        candidate["deferred_at"] = _now().isoformat()
        _refresh_bundle_status(bundle, content)
        bundle.bundle_json = content
        bundle.version += 1
        bundle.updated_at = _now()
        flag_modified(bundle, "bundle_json")
        log_audit(
            db,
            "defer",
            "candidate_bundles",
            bundle.id,
            after={"candidate_key": candidate_key, "version": bundle.version},
        )
        result = _bundle_json(bundle)
        db.commit()
        return result
    finally:
        db.close()


def _fill_missing_required(payload: dict[str, Any], candidate: dict[str, Any]) -> None:
    """为 AI 可能漏掉的必填字段补充合理默认值，避免不必要的 422。"""
    record_type = payload.get("record_type")
    summary = candidate.get("summary", "")
    evidence = candidate.get("evidence", "")
    normalize_measurement_role(payload)

    # 公共必填：title
    if not payload.get("title"):
        payload["title"] = summary or evidence[:100] or record_type or "未命名"

    _defaults: dict[str, str] = {
        "event_kind": "其他事件",
        "direction": "expense",
        "payment_kind": "其他款项",
        "phenomenon": "",
        "object_name": "",
        "measurement_role": "site_measurement",
        "topic": "",
        "item_name": "",
        "question": "",
        "action": "",
    }

    for field, default in _defaults.items():
        if field not in payload and _field_required_for(record_type, field):
            payload[field] = default

    # status 按 record_type 提供合法默认值
    if "status" not in payload:
        payload["status"] = STATUS_DEFAULTS.get(record_type, "pending")
    if record_type == "ledger" and not payload.get("ledger_kind"):
        payload["ledger_kind"] = {
            "refund": "refund", "income": "income",
        }.get(str(payload.get("direction")), "payment")
    if record_type == "ledger":
        kind = str(payload.get("ledger_kind") or "payment")
        payload["direction"] = {
            "payment": "expense", "refund": "refund", "income": "income",
        }.get(kind, "expense")
        if payload.get("status") not in {"planned", "voided"}:
            payload["status"] = "paid" if kind == "payment" else "posted"

    # title 兜底：仍然是所有类型的必填
    if not payload.get("title"):
        payload["title"] = summary[:100] or record_type or "未命名"

    # phenomenon / object_name / topic / item_name / question / action 的语义兜底
    _semantic_fallbacks: dict[str, str] = {
        "phenomenon": summary or evidence or "未描述现象",
        "object_name": summary or "未命名对象",
        "topic": summary or evidence or "未命名主题",
        "item_name": summary or "未命名物品",
        "question": summary or evidence or "未命名问题",
        "action": summary or "未指定动作",
    }
    for field, fallback in _semantic_fallbacks.items():
        if _field_required_for(record_type, field) and not payload.get(field):
            payload[field] = fallback

    for field, type_map in VALID_ENUMS.items():
        valid_set = type_map.get(record_type or "")
        if not valid_set:
            continue
        current = payload.get(field)
        if current is not None and current not in valid_set:
            if field == "status":
                payload[field] = STATUS_DEFAULTS.get(record_type or "", list(valid_set)[0])
            else:
                payload[field] = list(valid_set)[0]





def _field_required_for(record_type: str | None, field: str) -> bool:
    if not record_type:
        return False
    return field in FIELDS_BY_TYPE.get(record_type, set())


def _prepare_bundle_selections(
    db: Session,
    bundle: CandidateBundle,
    selections: list[CandidateSelection],
) -> list[tuple[CandidateSelection, Any, str, dict[str, Any]]]:
    content = bundle.bundle_json
    suggestion_map = {item["key"]: item for item in content.get("suggestions", [])}
    keys = [selection.key for selection in selections]
    if len(keys) != len(set(keys)):
        raise HTTPException(status_code=400, detail="不能重复选择同一条候选。")
    if any(key not in suggestion_map for key in keys):
        raise HTTPException(status_code=400, detail="候选已变化，请重新加载。")
    source = db.get(SourceEntry, bundle.source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="候选对应的来源不存在。")

    prepared: list[tuple[CandidateSelection, Any, str, dict[str, Any]]] = []
    for selection in selections:
        candidate = suggestion_map[selection.key]
        if candidate.get("review_state") == "deferred":
            raise HTTPException(status_code=409, detail="候选已移除，请重新加载后确认。")
        payload = copy.deepcopy(selection.payload or candidate["payload"])
        payload["record_type"] = candidate["record_type"]
        payload["source_refs"] = [
            {"source_id": source.id, "evidence_excerpt": candidate["evidence"]}
        ]
        _fill_missing_required(payload, candidate)
        try:
            parsed = RECORD_CREATE_ADAPTER.validate_python(payload)
        except ValidationError as exc:
            raise HTTPException(
                status_code=422, detail=candidate_validation_message(exc)
            ) from exc
        prefix = "local" if bundle.engine == "local-rule-v1" else "candidate"
        prepared.append(
            (
                selection,
                parsed,
                _origin_key(prefix, source.id, selection.key, bundle.source_revision),
                candidate,
            )
        )
    return prepared


def _apply_confirmations(
    db: Session,
    bundles_and_selections: list[tuple[CandidateBundle, list[CandidateSelection]]],
) -> dict[str, Any]:
    prepared_by_bundle: list[
        tuple[CandidateBundle, list[tuple[CandidateSelection, Any, str, dict[str, Any]]]]
    ] = []
    for bundle, selections in bundles_and_selections:
        prepared_by_bundle.append((bundle, _prepare_bundle_selections(db, bundle, selections)))

    record_results: list[dict[str, Any]] = []
    relation_results: list[dict[str, Any]] = []
    for bundle, prepared in prepared_by_bundle:
        key_to_record: dict[str, Record] = {}
        created_keys: set[str] = set()
        for selection, parsed, origin_key, candidate in prepared:
            existing = db.execute(
                select(Record).where(
                    Record.project_id == DEFAULT_PROJECT_ID,
                    Record.origin_key == origin_key,
                )
            ).scalar_one_or_none()
            if existing is None:
                existing = _create_record_in_session(db, parsed, origin_key=origin_key)
                created_keys.add(selection.key)
            key_to_record[selection.key] = existing
            candidate["review_state"] = "confirmed"
            candidate["deferred_at"] = None
            candidate["confirmed_record_id"] = existing.id
            candidate["payload"] = jsonable_encoder(parsed)

        all_candidates = {item["key"]: item for item in bundle.bundle_json.get("suggestions", [])}
        for key, candidate in all_candidates.items():
            record_id = candidate.get("confirmed_record_id")
            if record_id and key not in key_to_record:
                record = db.get(Record, record_id)
                if record is not None:
                    key_to_record[key] = record

        for hint in bundle.bundle_json.get("relations", []):
            if hint.get("relation_type") not in RELATION_TYPES:
                continue
            from_record = key_to_record.get(hint.get("from_key"))
            to_record = key_to_record.get(hint.get("to_key"))
            if from_record is None or to_record is None:
                continue
            relation = db.execute(
                select(RecordRelation).where(
                    RecordRelation.from_record_id == from_record.id,
                    RecordRelation.to_record_id == to_record.id,
                    RecordRelation.relation_type == hint["relation_type"],
                )
            ).scalar_one_or_none()
            if relation is None:
                relation = RecordRelation(
                    project_id=DEFAULT_PROJECT_ID,
                    from_record_id=from_record.id,
                    to_record_id=to_record.id,
                    relation_type=hint["relation_type"],
                )
                db.add(relation)
                db.flush()
                log_audit(
                    db,
                    "create",
                    "record_relations",
                    relation.id,
                    after={
                        "from_record_id": from_record.id,
                        "to_record_id": to_record.id,
                        "relation_type": hint["relation_type"],
                    },
                )
            relation_results.append(
                {
                    "id": relation.id,
                    "from_record_id": relation.from_record_id,
                    "to_record_id": relation.to_record_id,
                    "relation_type": relation.relation_type,
                }
            )

        _refresh_bundle_status(bundle, bundle.bundle_json)
        bundle.version += 1
        bundle.updated_at = _now()
        bundle.bundle_json = copy.deepcopy(bundle.bundle_json)
        # JSON 内部字段由候选引用原地更新，需要显式通知 SQLAlchemy 持久化整个列。
        flag_modified(bundle, "bundle_json")
        log_audit(
            db,
            "confirm",
            "candidate_bundles",
            bundle.id,
            after={"status": bundle.status, "version": bundle.version},
        )
        db.flush()
        for selection, _parsed, _origin_key, _candidate in prepared:
            record_results.append(
                {
                    "bundle_id": bundle.id,
                    "key": selection.key,
                    "created": selection.key in created_keys,
                    "record": _record_json(db, key_to_record[selection.key]),
                }
            )
    return {"records": record_results, "relations": relation_results}


@router.post("/candidate-bundles/{bundle_id}/confirm")
def confirm_candidate_bundle(
    bundle_id: str,
    request: Request,
    body: CandidateConfirmRequest,
    user: User,
) -> dict[str, Any]:
    db = _db(request)
    try:
        bundle = _load_current_bundle(db, bundle_id, body.expected_version)
        selected_keys = {selection.key for selection in body.selections}
        ignored_keys = set(body.ignored_keys)
        if not selected_keys and not ignored_keys:
            raise HTTPException(status_code=400, detail="请至少确认或忽略一条候选。")
        if len(ignored_keys) != len(body.ignored_keys):
            raise HTTPException(status_code=400, detail="不能重复忽略同一条候选。")
        if selected_keys & ignored_keys:
            raise HTTPException(status_code=400, detail="同一条候选不能同时确认和忽略。")
        suggestion_map = {
            item["key"]: item for item in bundle.bundle_json.get("suggestions", [])
        }
        if any(key not in suggestion_map for key in ignored_keys):
            raise HTTPException(status_code=400, detail="候选已变化，请重新加载。")
        for key in ignored_keys:
            candidate = suggestion_map[key]
            if candidate.get("confirmed_record_id") or candidate.get("review_state") == "confirmed":
                raise HTTPException(status_code=409, detail="已确认候选不能忽略。")
            candidate["review_state"] = "deferred"
            candidate["deferred_at"] = _now().isoformat()
        result = _apply_confirmations(db, [(bundle, body.selections)])
        result["bundle"] = _bundle_json(bundle)
        db.commit()
        return result
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="候选确认发生冲突，请重新加载。") from exc
    finally:
        db.close()


@router.get("/extraction-runs")
def list_extraction_runs(
    request: Request,
    user: User,
    source_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict[str, Any]]:
    db = _db(request)
    try:
        stmt = select(ExtractionRun)
        if source_id:
            stmt = stmt.where(ExtractionRun.source_id == source_id)
        rows = db.execute(
            stmt.order_by(ExtractionRun.started_at.desc()).limit(limit)
        ).scalars()
        return [_run_json(row) for row in rows]
    finally:
        db.close()


@router.get("/extraction-runs/{run_id}")
def get_extraction_run(
    run_id: str,
    request: Request,
    user: User,
    include_raw: bool = False,
) -> dict[str, Any]:
    db = _db(request)
    try:
        run = db.get(ExtractionRun, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="提取运行不存在。")
        return _run_json(run, include_raw=include_raw)
    finally:
        db.close()
