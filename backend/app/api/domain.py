from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from sqlalchemy import delete, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import log_audit as _write_audit
from app.auth import CurrentUser, require_user
from app.db import create_session_factory
from app.domain_models import (
    DEFAULT_PROJECT_ID,
    DEFAULT_ROOT_SPACE_ID,
    DecisionDetail,
    EventDetail,
    IssueDetail,
    LedgerDetail,
    Material,
    MeasurementDetail,
    MeasurementValue,
    Participant,
    ProcurementDetail,
    Project,
    ProjectStage,
    Record,
    RecordRelation,
    ResearchDetail,
    Space,
    TodoDetail,
    Vendor,
    record_attachments,
    record_materials,
    record_participants,
    record_sources,
    record_spaces,
)
from app.core.constants import DETAIL_MODELS, DETAIL_RENAMES_TO_DB, RELATION_TYPES
from app.local_suggestions import suggest_from_text
from app.models import Attachment, SourceEntry
from app.projections import serialize_records
from app.record_schemas import RecordCreate, RecordUpdate

router = APIRouter(tags=["domain"])
User = Annotated[CurrentUser, Depends(require_user)]
RECORD_CREATE_ADAPTER = TypeAdapter(RecordCreate)

COMMON_FIELDS = {
    "title",
    "description",
    "occurred_at",
    "time_precision",
    "original_time_text",
    "timezone",
    "stage_id",
    "status",
}
ASSOCIATION_FIELDS = {
    "source_refs",
    "space_ids",
    "material_ids",
    "participant_ids",
    "attachment_ids",
}


def _db(request: Request) -> Session:
    return create_session_factory(request.app.state.engine)()


def _now() -> datetime:
    return datetime.now(tz=UTC)


def log_audit(
    db: Session,
    action: str,
    target_table: str,
    target_id: str,
    *,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    # 审计 JSON 必须先规范化日期和 Decimal，避免业务写入在提交阶段失败。
    _write_audit(
        db,
        action,
        target_table,
        target_id,
        before=jsonable_encoder(before) if before is not None else None,
        after=jsonable_encoder(after) if after is not None else None,
    )


def _not_found(label: str = "资源") -> HTTPException:
    return HTTPException(status_code=404, detail=f"{label}不存在。")


def _current_project(db: Session) -> Project:
    project = db.get(Project, DEFAULT_PROJECT_ID)
    if project is None:
        # 迁移会创建默认项目；测试或首次空库建表时在首次访问中兜底创建。
        project = Project(id=DEFAULT_PROJECT_ID, name="我的装修", is_active=True)
        db.add(project)
        db.flush()
    return project


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class SpaceInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["house", "room", "component", "surface"]
    parent_id: str | None = None


class SpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: Literal["house", "room", "component", "surface"] | None = None
    parent_id: str | None = None


class NamedEntityInput(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    notes: str | None = None
    brand: str | None = None
    model: str | None = None
    color: str | None = None
    finish: str | None = None
    contact: str | None = None
    role: str | None = None
    sort_order: int = 0


class NamedEntityUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    brand: str | None = None
    model: str | None = None
    color: str | None = None
    finish: str | None = None
    contact: str | None = None
    role: str | None = None
    sort_order: int | None = None


class RelationInput(BaseModel):
    from_record_id: str
    to_record_id: str
    relation_type: Literal[
        "derived_from",
        "relates_to",
        "implements",
        "resolves",
        "pays_for",
        "tracks_delivery",
        "supersedes",
        "blocks",
        "produces",
    ]


class SuggestionSelection(BaseModel):
    key: str
    payload: dict[str, Any]


class SuggestionConfirmRequest(BaseModel):
    selections: list[SuggestionSelection] = Field(min_length=1)


@router.get("/projects/current")
def get_current_project(request: Request, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        project = _current_project(db)
        return {"id": project.id, "name": project.name, "is_active": project.is_active}
    finally:
        db.close()


@router.patch("/projects/current")
def update_current_project(request: Request, body: ProjectUpdate, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        project = _current_project(db)
        before = {"name": project.name}
        project.name = body.name
        project.updated_at = _now()
        log_audit(db, "update", "projects", project.id, before=before, after={"name": project.name})
        db.commit()
        return {"id": project.id, "name": project.name, "is_active": project.is_active}
    finally:
        db.close()


def _space_json(space: Space) -> dict[str, Any]:
    return {
        "id": space.id,
        "project_id": space.project_id,
        "parent_id": space.parent_id,
        "name": space.name,
        "kind": space.kind,
        "archived_at": space.archived_at,
    }


@router.get("/spaces")
def list_spaces(request: Request, user: User) -> list[dict[str, Any]]:
    db = _db(request)
    try:
        rows = db.execute(
            select(Space).where(Space.project_id == DEFAULT_PROJECT_ID).order_by(Space.name)
        ).scalars()
        return [_space_json(row) for row in rows]
    finally:
        db.close()


def _validate_parent(db: Session, parent_id: str | None, current_id: str | None = None) -> None:
    if parent_id is None:
        return
    if parent_id == current_id:
        raise HTTPException(status_code=400, detail="空间不能以自身作为父级。")
    parent = db.get(Space, parent_id)
    if parent is None or parent.project_id != DEFAULT_PROJECT_ID:
        raise HTTPException(status_code=400, detail="父级空间无效。")
    ancestor = parent
    while ancestor.parent_id is not None:
        if ancestor.parent_id == current_id:
            raise HTTPException(status_code=400, detail="空间层级不能形成循环。")
        ancestor = db.get(Space, ancestor.parent_id)
        if ancestor is None or ancestor.project_id != DEFAULT_PROJECT_ID:
            raise HTTPException(status_code=400, detail="空间父级链无效。")


@router.post("/spaces", status_code=201)
def create_space(request: Request, body: SpaceInput, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        _current_project(db)
        _validate_parent(db, body.parent_id)
        space = Space(project_id=DEFAULT_PROJECT_ID, **body.model_dump())
        db.add(space)
        db.flush()
        result = _space_json(space)
        log_audit(db, "create", "spaces", space.id, after=result)
        db.commit()
        return result
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="同一父级下已存在同名空间。") from exc
    finally:
        db.close()


@router.patch("/spaces/{space_id}")
def update_space(space_id: str, request: Request, body: SpaceUpdate, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        space = db.get(Space, space_id)
        if space is None or space.project_id != DEFAULT_PROJECT_ID:
            raise _not_found("空间")
        changes = body.model_dump(exclude_unset=True)
        _validate_parent(db, changes.get("parent_id"), space.id)
        before = _space_json(space)
        for key, value in changes.items():
            setattr(space, key, value)
        space.updated_at = _now()
        after = _space_json(space)
        log_audit(db, "update", "spaces", space.id, before=before, after=after)
        db.commit()
        return after
    finally:
        db.close()


@router.delete("/spaces/{space_id}", status_code=204)
def delete_space(space_id: str, request: Request, user: User) -> None:
    db = _db(request)
    try:
        space = db.get(Space, space_id)
        if space is None or space.project_id != DEFAULT_PROJECT_ID:
            raise _not_found("空间")

        # 空间层级和历史记录必须先由用户显式调整，删除不能静默断开引用。
        child = db.execute(select(Space.id).where(Space.parent_id == space.id).limit(1)).first()
        if child is not None:
            raise HTTPException(
                status_code=409,
                detail="该空间仍包含下级空间，请先调整或删除下级空间。",
            )
        record_ref = db.execute(
            select(record_spaces.c.record_id)
            .where(record_spaces.c.space_id == space.id)
            .limit(1)
        ).first()
        if record_ref is not None:
            raise HTTPException(
                status_code=409,
                detail="该空间已被正式记录使用，请先解除记录关联。",
            )
        if space.kind == "house" and space.parent_id is None:
            another_root = db.execute(
                select(Space.id)
                .where(
                    Space.project_id == DEFAULT_PROJECT_ID,
                    Space.kind == "house",
                    Space.parent_id.is_(None),
                    Space.id != space.id,
                )
                .limit(1)
            ).first()
            if another_root is None:
                label = (
                    "系统默认的整套房屋"
                    if space.id == DEFAULT_ROOT_SPACE_ID
                    else "最后一个根房屋"
                )
                raise HTTPException(
                    status_code=409,
                    detail=f"{label}不能删除，请先建立另一个根房屋。",
                )

        before = _space_json(space)
        db.delete(space)
        log_audit(db, "delete", "spaces", space.id, before=before)
        db.commit()
    finally:
        db.close()


ENTITY_MODELS = {
    "materials": Material,
    "vendors": Vendor,
    "participants": Participant,
    "stages": ProjectStage,
}
ENTITY_LABELS = {
    "materials": "材料",
    "vendors": "商家",
    "participants": "参与者",
    "stages": "装修阶段",
}
ENTITY_FIELDS = {
    "materials": {"name", "notes", "brand", "model", "color", "finish"},
    "vendors": {"name", "notes", "contact"},
    "participants": {"name", "notes", "role", "contact"},
    "stages": {"name", "notes", "sort_order"},
}


def _entity_json(entity: Any, entity_type: str) -> dict[str, Any]:
    keys = {"id", "project_id"} | ENTITY_FIELDS[entity_type]
    return {key: getattr(entity, key) for key in keys}


def _list_entities(entity_type: str, request: Request) -> list[dict[str, Any]]:
    db = _db(request)
    try:
        model = ENTITY_MODELS[entity_type]
        rows = db.execute(
            select(model).where(model.project_id == DEFAULT_PROJECT_ID).order_by(model.name)
        ).scalars()
        return [_entity_json(row, entity_type) for row in rows]
    finally:
        db.close()


def _create_entity(entity_type: str, request: Request, body: NamedEntityInput) -> dict[str, Any]:
    db = _db(request)
    try:
        _current_project(db)
        model = ENTITY_MODELS[entity_type]
        values = body.model_dump(include=ENTITY_FIELDS[entity_type])
        entity = model(project_id=DEFAULT_PROJECT_ID, **values)
        db.add(entity)
        db.flush()
        result = _entity_json(entity, entity_type)
        log_audit(db, "create", model.__tablename__, entity.id, after=result)
        db.commit()
        return result
    finally:
        db.close()


def _update_entity(
    entity_type: str, entity_id: str, request: Request, body: NamedEntityUpdate
) -> dict[str, Any]:
    db = _db(request)
    try:
        model = ENTITY_MODELS[entity_type]
        entity = db.get(model, entity_id)
        if entity is None or entity.project_id != DEFAULT_PROJECT_ID:
            raise _not_found("共享实体")
        before = _entity_json(entity, entity_type)
        values = body.model_dump(exclude_unset=True, include=ENTITY_FIELDS[entity_type])
        for key, value in values.items():
            setattr(entity, key, value)
        entity.updated_at = _now()
        after = _entity_json(entity, entity_type)
        log_audit(db, "update", model.__tablename__, entity.id, before=before, after=after)
        db.commit()
        return after
    finally:
        db.close()


def _entity_reference_exists(db: Session, entity_type: str, entity_id: str) -> bool:
    if entity_type == "materials":
        stmt = select(record_materials.c.record_id).where(
            record_materials.c.material_id == entity_id
        )
        return db.execute(stmt.limit(1)).first() is not None
    if entity_type == "participants":
        stmt = select(record_participants.c.record_id).where(
            record_participants.c.participant_id == entity_id
        )
        return db.execute(stmt.limit(1)).first() is not None
    if entity_type == "stages":
        stage_ref = db.execute(
            select(Record.id).where(Record.stage_id == entity_id).limit(1)
        ).first()
        return stage_ref is not None
    if entity_type == "vendors":
        ledger_ref = db.execute(
            select(LedgerDetail.record_id).where(LedgerDetail.vendor_id == entity_id).limit(1)
        ).first()
        procurement_ref = db.execute(
            select(ProcurementDetail.record_id)
            .where(ProcurementDetail.vendor_id == entity_id)
            .limit(1)
        ).first()
        return ledger_ref is not None or procurement_ref is not None
    return False


def _delete_entity(entity_type: str, entity_id: str, request: Request) -> None:
    db = _db(request)
    try:
        model = ENTITY_MODELS[entity_type]
        entity = db.get(model, entity_id)
        label = ENTITY_LABELS[entity_type]
        if entity is None or entity.project_id != DEFAULT_PROJECT_ID:
            raise _not_found(label)
        if _entity_reference_exists(db, entity_type, entity.id):
            raise HTTPException(
                status_code=409,
                detail=f"该{label}已被正式记录使用，请先解除记录关联。",
            )

        before = _entity_json(entity, entity_type)
        db.delete(entity)
        log_audit(db, "delete", model.__tablename__, entity.id, before=before)
        db.commit()
    finally:
        db.close()


def _entity_list_endpoint(entity_type: str):
    def endpoint(request: Request, user: User) -> list[dict[str, Any]]:
        return _list_entities(entity_type, request)

    return endpoint


def _entity_create_endpoint(entity_type: str):
    def endpoint(request: Request, body: NamedEntityInput, user: User) -> dict[str, Any]:
        return _create_entity(entity_type, request, body)

    return endpoint


def _entity_update_endpoint(entity_type: str):
    def endpoint(
        entity_id: str, request: Request, body: NamedEntityUpdate, user: User
    ) -> dict[str, Any]:
        return _update_entity(entity_type, entity_id, request, body)

    return endpoint


def _entity_delete_endpoint(entity_type: str):
    def endpoint(entity_id: str, request: Request, user: User) -> None:
        return _delete_entity(entity_type, entity_id, request)

    return endpoint


for _entity_type in ENTITY_MODELS:
    router.add_api_route(
        f"/{_entity_type}",
        _entity_list_endpoint(_entity_type),
        methods=["GET"],
    )
    router.add_api_route(
        f"/{_entity_type}",
        _entity_create_endpoint(_entity_type),
        methods=["POST"],
        status_code=201,
    )
    router.add_api_route(
        f"/{_entity_type}/{{entity_id}}",
        _entity_update_endpoint(_entity_type),
        methods=["PATCH"],
    )
    router.add_api_route(
        f"/{_entity_type}/{{entity_id}}",
        _entity_delete_endpoint(_entity_type),
        methods=["DELETE"],
        status_code=204,
    )


def _ensure_ids(db: Session, model: Any, ids: list[str], label: str) -> list[Any]:
    if not ids:
        return []
    rows = db.execute(select(model).where(model.id.in_(set(ids)))).scalars().all()
    if len(rows) != len(set(ids)) or any(row.project_id != DEFAULT_PROJECT_ID for row in rows):
        raise HTTPException(status_code=400, detail=f"{label}包含无效或跨项目引用。")
    return rows


def _validate_record_refs(db: Session, payload: dict[str, Any]) -> None:
    source_ids = [item["source_id"] for item in payload.get("source_refs", [])]
    sources = (
        db.execute(select(SourceEntry).where(SourceEntry.id.in_(set(source_ids)))).scalars().all()
    )
    if not source_ids or len(sources) != len(set(source_ids)):
        raise HTTPException(status_code=400, detail="每条记录必须关联有效的原始来源。")
    if any(source.project_id != DEFAULT_PROJECT_ID for source in sources):
        raise HTTPException(status_code=400, detail="来源不能跨项目关联。")
    _ensure_ids(db, Space, payload.get("space_ids", []), "空间")
    _ensure_ids(db, Material, payload.get("material_ids", []), "材料")
    _ensure_ids(db, Participant, payload.get("participant_ids", []), "参与者")
    if payload.get("stage_id"):
        _ensure_ids(db, ProjectStage, [payload["stage_id"]], "装修阶段")
    attachment_ids = payload.get("attachment_ids", [])
    if attachment_ids:
        attachments = (
            db.execute(select(Attachment).where(Attachment.id.in_(set(attachment_ids))))
            .scalars()
            .all()
        )
        if len(attachments) != len(set(attachment_ids)):
            raise HTTPException(status_code=400, detail="附件包含无效引用。")
        linked_sources = {item["source_id"] for item in payload["source_refs"]}
        if any(item.source_id not in linked_sources for item in attachments):
            raise HTTPException(status_code=400, detail="附件必须属于当前记录关联的来源。")
    vendor_id = payload.get("vendor_id")
    if vendor_id:
        _ensure_ids(db, Vendor, [vendor_id], "商家")


def _detail_values(record_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    excluded = COMMON_FIELDS | ASSOCIATION_FIELDS | {"record_type", "values"}
    values = {key: value for key, value in payload.items() if key not in excluded}
    renames = DETAIL_RENAMES_TO_DB.get(record_type, {})
    return {renames.get(key, key): value for key, value in values.items()}


def _replace_associations(db: Session, record_id: str, payload: dict[str, Any]) -> None:
    mappings = (
        ("space_ids", record_spaces, "space_id"),
        ("material_ids", record_materials, "material_id"),
        ("participant_ids", record_participants, "participant_id"),
        ("attachment_ids", record_attachments, "attachment_id"),
    )
    if "source_refs" in payload:
        db.execute(delete(record_sources).where(record_sources.c.record_id == record_id))
        db.execute(
            insert(record_sources),
            [{"record_id": record_id, **source_ref} for source_ref in payload["source_refs"]],
        )
    for field, table, column in mappings:
        if field not in payload:
            continue
        db.execute(delete(table).where(table.c.record_id == record_id))
        if payload[field]:
            db.execute(
                insert(table),
                [{"record_id": record_id, column: value} for value in payload[field]],
            )


def _replace_measurements(db: Session, record_id: str, values: list[dict[str, Any]]) -> None:
    db.execute(delete(MeasurementValue).where(MeasurementValue.record_id == record_id))
    for ordinal, value in enumerate(values):
        db.add(MeasurementValue(record_id=record_id, ordinal=ordinal, **value))


def _source_refs(db: Session, record_id: str) -> list[dict[str, Any]]:
    rows = db.execute(
        select(record_sources.c.source_id, record_sources.c.evidence_excerpt).where(
            record_sources.c.record_id == record_id
        )
    ).all()
    return [{"source_id": row.source_id, "evidence_excerpt": row.evidence_excerpt} for row in rows]


def _association_ids(db: Session, table: Any, column: str, record_id: str) -> list[str]:
    return list(
        db.execute(select(getattr(table.c, column)).where(table.c.record_id == record_id)).scalars()
    )


def _record_json(db: Session, record: Record) -> dict[str, Any]:
    detail_model = DETAIL_MODELS[record.record_type]
    detail = db.get(detail_model, record.id)
    detail_values = {
        column.name: getattr(detail, column.name)
        for column in detail_model.__table__.columns
        if column.name != "record_id"
    }
    reverse = {value: key for key, value in DETAIL_RENAMES_TO_DB.get(record.record_type, {}).items()}
    detail_values = {reverse.get(key, key): value for key, value in detail_values.items()}
    if record.record_type == "measurement":
        values = db.execute(
            select(MeasurementValue)
            .where(MeasurementValue.record_id == record.id)
            .order_by(MeasurementValue.ordinal)
        ).scalars()
        detail_values["values"] = [
            {"axis": item.axis, "value": float(item.value), "unit": item.unit} for item in values
        ]
    return {
        "id": record.id,
        "project_id": record.project_id,
        "record_type": record.record_type,
        "title": record.title,
        "description": record.description,
        "occurred_at": record.occurred_at,
        "time_precision": record.time_precision,
        "original_time_text": record.original_time_text,
        "timezone": record.timezone,
        "stage_id": record.stage_id,
        "status": record.status,
        "archived_at": record.archived_at,
        "source_refs": _source_refs(db, record.id),
        "space_ids": _association_ids(db, record_spaces, "space_id", record.id),
        "material_ids": _association_ids(db, record_materials, "material_id", record.id),
        "participant_ids": _association_ids(db, record_participants, "participant_id", record.id),
        "attachment_ids": _association_ids(db, record_attachments, "attachment_id", record.id),
        **detail_values,
    }


def _create_record_in_session(
    db: Session,
    body: Any,
    *,
    origin_key: str | None = None,
) -> Record:
    payload = body.model_dump()
    _validate_record_refs(db, payload)
    record = Record(
        project_id=DEFAULT_PROJECT_ID,
        record_type=payload["record_type"],
        origin_key=origin_key,
        **{key: payload[key] for key in COMMON_FIELDS},
    )
    db.add(record)
    db.flush()
    detail_model = DETAIL_MODELS[record.record_type]
    db.add(detail_model(record_id=record.id, **_detail_values(record.record_type, payload)))
    _replace_associations(db, record.id, payload)
    if record.record_type == "measurement":
        _replace_measurements(db, record.id, payload["values"])
    db.flush()
    log_audit(db, "create", "records", record.id, after=body.model_dump(mode="json"))
    return record


@router.post("/records", status_code=status.HTTP_201_CREATED)
def create_record(request: Request, body: RecordCreate, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        _current_project(db)
        record = _create_record_in_session(db, body)
        result = _record_json(db, record)
        db.commit()
        return result
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="记录或关联发生冲突。") from exc
    finally:
        db.close()


@router.get("/sources/{source_id}/suggestions")
def get_local_suggestions(source_id: str, request: Request, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        source = db.get(SourceEntry, source_id)
        if source is None or source.project_id != DEFAULT_PROJECT_ID:
            raise _not_found("来源")
        bundle = suggest_from_text(source.id, source.original_text)
        for suggestion in bundle["suggestions"]:
            origin_key = f"local:{source.id}:{suggestion['key']}"
            record = db.execute(
                select(Record).where(
                    Record.project_id == DEFAULT_PROJECT_ID,
                    Record.origin_key == origin_key,
                )
            ).scalar_one_or_none()
            suggestion["confirmed_record_id"] = record.id if record else None
        return bundle
    finally:
        db.close()


@router.post("/sources/{source_id}/suggestions/confirm")
def confirm_local_suggestions(
    source_id: str,
    request: Request,
    body: SuggestionConfirmRequest,
    user: User,
) -> dict[str, Any]:
    db = _db(request)
    try:
        source = db.get(SourceEntry, source_id)
        if source is None or source.project_id != DEFAULT_PROJECT_ID:
            raise _not_found("来源")
        bundle = suggest_from_text(source.id, source.original_text)
        suggestion_map = {item["key"]: item for item in bundle["suggestions"]}
        selected_keys = [item.key for item in body.selections]
        if len(selected_keys) != len(set(selected_keys)):
            raise HTTPException(status_code=400, detail="不能重复选择同一条建议。")
        unknown = set(selected_keys) - suggestion_map.keys()
        if unknown:
            raise HTTPException(status_code=400, detail="建议已变化，请重新加载后确认。")

        # 先完成全部请求验证，再开始写入，确保字段错误不会留下半套记录。
        validated: list[tuple[SuggestionSelection, Any, str]] = []
        for selection in body.selections:
            canonical = suggestion_map[selection.key]
            payload = {**selection.payload}
            payload["record_type"] = canonical["record_type"]
            payload["source_refs"] = [
                {
                    "source_id": source.id,
                    "evidence_excerpt": canonical["evidence"],
                }
            ]
            try:
                parsed = RECORD_CREATE_ADAPTER.validate_python(payload)
            except ValidationError as exc:
                messages = []
                for err in exc.errors():
                    loc = " → ".join(str(p) for p in err["loc"])
                    messages.append(f"{loc}: {err['msg']}")
                detail = "候选字段校验失败：" + "；".join(messages)
                raise HTTPException(
                    status_code=422,
                    detail=detail,
                ) from exc
            validated.append((selection, parsed, f"local:{source.id}:{selection.key}"))

        key_to_record: dict[str, Record] = {}
        created_keys: set[str] = set()
        for selection, parsed, origin_key in validated:
            existing = db.execute(
                select(Record).where(
                    Record.project_id == DEFAULT_PROJECT_ID,
                    Record.origin_key == origin_key,
                )
            ).scalar_one_or_none()
            if existing is not None:
                key_to_record[selection.key] = existing
                continue
            record = _create_record_in_session(db, parsed, origin_key=origin_key)
            key_to_record[selection.key] = record
            created_keys.add(selection.key)

        relation_results: list[dict[str, Any]] = []
        selected_set = set(selected_keys)
        for hint in bundle["relations"]:
            if hint["from_key"] not in selected_set or hint["to_key"] not in selected_set:
                continue
            from_record = key_to_record[hint["from_key"]]
            to_record = key_to_record[hint["to_key"]]
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

        db.flush()
        records_result = [
            {
                "key": key,
                "created": key in created_keys,
                "record": _record_json(db, key_to_record[key]),
            }
            for key in selected_keys
        ]
        db.commit()
        return {"source_id": source.id, "records": records_result, "relations": relation_results}
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="建议确认发生冲突，请重新加载。") from exc
    finally:
        db.close()


@router.get("/records")
def list_records(
    request: Request,
    user: User,
    record_type: str | None = None,
    source_id: str | None = None,
    include_archived: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    db = _db(request)
    try:
        stmt = select(Record).where(Record.project_id == DEFAULT_PROJECT_ID)
        if record_type:
            stmt = stmt.where(Record.record_type == record_type)
        if not include_archived:
            stmt = stmt.where(Record.archived_at.is_(None))
        if source_id:
            stmt = stmt.join(record_sources).where(record_sources.c.source_id == source_id)
        rows = db.execute(
            stmt.order_by(Record.created_at.desc()).limit(limit).offset(offset)
        ).scalars()
        return [_record_json(db, row) for row in rows]
    finally:
        db.close()


def _get_record(db: Session, record_id: str) -> Record:
    record = db.get(Record, record_id)
    if record is None or record.project_id != DEFAULT_PROJECT_ID:
        raise _not_found("正式记录")
    return record


@router.get("/records/{record_id}")
def get_record(record_id: str, request: Request, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        record = _get_record(db, record_id)
        # 详情与核心视图复用同一投影，避免空间、材料名称只在部分页面可见。
        return serialize_records(db, [record])[record.id]
    finally:
        db.close()


@router.patch("/records/{record_id}")
def update_record(
    record_id: str, request: Request, body: RecordUpdate, user: User
) -> dict[str, Any]:
    db = _db(request)
    try:
        record = _get_record(db, record_id)
        if body.record_type != record.record_type:
            raise HTTPException(status_code=409, detail="记录类型创建后不可修改。")
        before = _record_json(db, record)
        payload = body.model_dump(exclude_unset=True)
        validation_payload = {**before, **payload}
        _validate_record_refs(db, validation_payload)
        for key in COMMON_FIELDS & payload.keys():
            setattr(record, key, payload[key])
        record.updated_at = _now()
        detail = db.get(DETAIL_MODELS[record.record_type], record.id)
        for key, value in _detail_values(record.record_type, payload).items():
            setattr(detail, key, value)
        _replace_associations(db, record.id, payload)
        if record.record_type == "measurement" and "values" in payload:
            _replace_measurements(db, record.id, payload["values"])
        db.flush()
        after = _record_json(db, record)
        log_audit(db, "update", "records", record.id, before=before, after=after)
        db.commit()
        return after
    finally:
        db.close()


def _set_archived(record_id: str, request: Request, archived: bool) -> dict[str, Any]:
    db = _db(request)
    try:
        record = _get_record(db, record_id)
        before = _record_json(db, record)
        record.archived_at = _now() if archived else None
        record.updated_at = _now()
        after = _record_json(db, record)
        action = "archive" if archived else "restore"
        log_audit(db, action, "records", record.id, before=before, after=after)
        db.commit()
        return after
    finally:
        db.close()


@router.post("/records/{record_id}/archive")
def archive_record(record_id: str, request: Request, user: User) -> dict[str, Any]:
    return _set_archived(record_id, request, True)


@router.post("/records/{record_id}/restore")
def restore_record(record_id: str, request: Request, user: User) -> dict[str, Any]:
    return _set_archived(record_id, request, False)


@router.get("/record-relations")
def list_relations(
    request: Request, user: User, record_id: str | None = None
) -> list[dict[str, Any]]:
    db = _db(request)
    try:
        stmt = select(RecordRelation).where(RecordRelation.project_id == DEFAULT_PROJECT_ID)
        if record_id:
            stmt = stmt.where(
                (RecordRelation.from_record_id == record_id)
                | (RecordRelation.to_record_id == record_id)
            )
        rows = db.execute(stmt.order_by(RecordRelation.created_at)).scalars()
        return [
            {
                "id": row.id,
                "from_record_id": row.from_record_id,
                "to_record_id": row.to_record_id,
                "relation_type": row.relation_type,
            }
            for row in rows
        ]
    finally:
        db.close()


@router.post("/record-relations", status_code=201)
def create_relation(request: Request, body: RelationInput, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        if body.relation_type not in RELATION_TYPES:
            raise HTTPException(status_code=400, detail="关系类型无效。")
        from_record = _get_record(db, body.from_record_id)
        to_record = _get_record(db, body.to_record_id)
        if from_record.project_id != to_record.project_id:
            raise HTTPException(status_code=400, detail="记录关系不能跨项目。")
        relation = RecordRelation(project_id=DEFAULT_PROJECT_ID, **body.model_dump())
        db.add(relation)
        db.flush()
        result = {"id": relation.id, **body.model_dump()}
        log_audit(db, "create", "record_relations", relation.id, after=result)
        db.commit()
        return result
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="关系重复或不能关联自身。") from exc
    finally:
        db.close()


@router.delete("/record-relations/{relation_id}", status_code=204)
def delete_relation(relation_id: str, request: Request, user: User) -> None:
    db = _db(request)
    try:
        relation = db.get(RecordRelation, relation_id)
        if relation is None or relation.project_id != DEFAULT_PROJECT_ID:
            raise _not_found("记录关系")
        before = {
            "from_record_id": relation.from_record_id,
            "to_record_id": relation.to_record_id,
            "relation_type": relation.relation_type,
        }
        db.delete(relation)
        log_audit(db, "delete", "record_relations", relation.id, before=before)
        db.commit()
    finally:
        db.close()
