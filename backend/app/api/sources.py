from __future__ import annotations

import hashlib
import mimetypes
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import log_audit
from app.auth import CurrentUser, require_user
from app.core.paths import StoragePaths
from app.db import create_session_factory
from app.domain_models import (
    DEFAULT_PROJECT_ID,
    CandidateBundle,
    ExtractionRun,
    Project,
    Record,
    RecordRelation,
    record_attachments,
    record_sources,
)
from app.models import Attachment as AttachmentModel
from app.models import SourceEntry as SourceEntryModel

_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"}
_MAX_SIZE_BYTES = 50 * 1024 * 1024

router = APIRouter(tags=["sources"])


class SourceResponse(BaseModel):
    id: str
    project_id: str
    input_type: str
    original_text: str | None
    captured_at: datetime
    reported_time_text: str | None
    updated_at: datetime
    revision: int

    model_config = {"from_attributes": True}


class AttachmentResponse(BaseModel):
    id: str
    source_id: str | None
    original_filename: str
    media_type: str
    size_bytes: int
    sha256_hex: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SourceDetailResponse(SourceResponse):
    attachments: list[AttachmentResponse] = Field(default_factory=list)


class SourceCreate(BaseModel):
    input_type: str = "text"
    original_text: str | None = None
    reported_time_text: str | None = None


class SourceUpdate(BaseModel):
    original_text: str | None = None
    reported_time_text: str | None = None


class SourceDeletionImpact(BaseModel):
    source_id: str
    attachments: int
    candidate_bundles: int
    extraction_runs: int
    exclusive_records: int
    shared_records: int
    affected_relations: int


class SourceDeletionResult(SourceDeletionImpact):
    deleted_physical_files: int
    file_cleanup_warnings: list[str] = Field(default_factory=list)


def _get_db(request: Request) -> Session:
    engine = request.app.state.engine
    factory = create_session_factory(engine)
    return factory()


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _source_or_404(db: Session, source_id: str) -> SourceEntryModel:
    source = db.get(SourceEntryModel, source_id)
    if source is None or source.project_id != DEFAULT_PROJECT_ID:
        raise HTTPException(status_code=404, detail="来源不存在。")
    return source


def _deletion_context(db: Session, source_id: str) -> dict[str, Any]:
    record_ids = list(
        db.scalars(
            select(record_sources.c.record_id).where(
                record_sources.c.source_id == source_id
            )
        ).all()
    )
    source_counts: dict[str, int] = {}
    if record_ids:
        source_counts = dict(
            db.execute(
                select(record_sources.c.record_id, func.count())
                .where(record_sources.c.record_id.in_(record_ids))
                .group_by(record_sources.c.record_id)
            ).all()
        )
    exclusive_ids = [record_id for record_id in record_ids if source_counts[record_id] == 1]
    shared_ids = [record_id for record_id in record_ids if source_counts[record_id] > 1]
    relation_count = 0
    if exclusive_ids:
        relation_count = db.scalar(
            select(func.count())
            .select_from(RecordRelation)
            .where(
                or_(
                    RecordRelation.from_record_id.in_(exclusive_ids),
                    RecordRelation.to_record_id.in_(exclusive_ids),
                )
            )
        ) or 0
    return {
        "source_id": source_id,
        "attachments": db.scalar(
            select(func.count())
            .select_from(AttachmentModel)
            .where(AttachmentModel.source_id == source_id)
        )
        or 0,
        "candidate_bundles": db.scalar(
            select(func.count())
            .select_from(CandidateBundle)
            .where(CandidateBundle.source_id == source_id)
        )
        or 0,
        "extraction_runs": db.scalar(
            select(func.count())
            .select_from(ExtractionRun)
            .where(ExtractionRun.source_id == source_id)
        )
        or 0,
        "exclusive_records": len(exclusive_ids),
        "shared_records": len(shared_ids),
        "affected_relations": relation_count,
        "exclusive_ids": exclusive_ids,
        "shared_ids": shared_ids,
    }


@router.post("/sources", response_model=SourceResponse, status_code=201)
def create_source(
    request: Request,
    body: SourceCreate,
    user: Annotated[CurrentUser, Depends(require_user)],
) -> SourceResponse:
    db = _get_db(request)
    try:
        if db.get(Project, DEFAULT_PROJECT_ID) is None:
            db.add(Project(id=DEFAULT_PROJECT_ID, name="我的装修", is_active=True))
            db.flush()
        entry = SourceEntryModel(
            project_id=DEFAULT_PROJECT_ID,
            input_type=body.input_type,
            original_text=body.original_text,
            reported_time_text=body.reported_time_text,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        log_audit(
            db,
            "create",
            "source_entries",
            entry.id,
            after={
                "original_text": entry.original_text,
                "input_type": entry.input_type,
            },
        )
        db.commit()
        return SourceResponse.model_validate(entry)
    finally:
        db.close()


@router.get("/sources", response_model=list[SourceResponse])
def list_sources(
    request: Request,
    user: Annotated[CurrentUser, Depends(require_user)],
    limit: int = 100,
    offset: int = 0,
) -> list[SourceResponse]:
    db = _get_db(request)
    try:
        rows = db.execute(
            select(SourceEntryModel)
            .where(SourceEntryModel.project_id == DEFAULT_PROJECT_ID)
            .order_by(SourceEntryModel.captured_at.desc())
            .limit(min(max(limit, 1), 500))
            .offset(max(offset, 0))
        ).scalars()
        return [SourceResponse.model_validate(row) for row in rows]
    finally:
        db.close()


@router.get("/sources/{source_id}", response_model=SourceDetailResponse)
def read_source(
    source_id: str,
    request: Request,
    user: Annotated[CurrentUser, Depends(require_user)],
) -> SourceDetailResponse:
    db = _get_db(request)
    try:
        entry = db.get(SourceEntryModel, source_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="来源不存在。")
        return SourceDetailResponse.model_validate(entry, from_attributes=True)
    finally:
        db.close()


@router.patch("/sources/{source_id}", response_model=SourceResponse)
def update_source(
    source_id: str,
    request: Request,
    body: SourceUpdate,
    user: Annotated[CurrentUser, Depends(require_user)],
) -> SourceResponse:
    db = _get_db(request)
    try:
        source = _source_or_404(db, source_id)
        fields = body.model_dump(exclude_unset=True)
        if not fields:
            raise HTTPException(status_code=400, detail="请至少提交一个需要修改的字段。")
        changed = {
            key: value for key, value in fields.items() if getattr(source, key) != value
        }
        if not changed:
            return SourceResponse.model_validate(source)
        before = {
            "original_text": source.original_text,
            "reported_time_text": source.reported_time_text,
            "revision": source.revision,
        }
        for key, value in changed.items():
            setattr(source, key, value)
        source.revision += 1
        source.updated_at = _now()
        bundles = db.scalars(
            select(CandidateBundle).where(CandidateBundle.source_id == source.id)
        ).all()
        for bundle in bundles:
            bundle.status = "superseded"
            bundle.updated_at = source.updated_at
        log_audit(
            db,
            "update",
            "source_entries",
            source.id,
            before=before,
            after={
                "original_text": source.original_text,
                "reported_time_text": source.reported_time_text,
                "revision": source.revision,
                "superseded_candidate_bundles": len(bundles),
            },
        )
        db.commit()
        db.refresh(source)
        return SourceResponse.model_validate(source)
    finally:
        db.close()


@router.get(
    "/sources/{source_id}/deletion-impact",
    response_model=SourceDeletionImpact,
)
def get_source_deletion_impact(
    source_id: str,
    request: Request,
    user: Annotated[CurrentUser, Depends(require_user)],
) -> SourceDeletionImpact:
    db = _get_db(request)
    try:
        _source_or_404(db, source_id)
        context = _deletion_context(db, source_id)
        return SourceDeletionImpact.model_validate(context)
    finally:
        db.close()


@router.delete("/sources/{source_id}", response_model=SourceDeletionResult)
def delete_source(
    source_id: str,
    request: Request,
    user: Annotated[CurrentUser, Depends(require_user)],
) -> SourceDeletionResult:
    db = _get_db(request)
    cleanup_paths: set[str] = set()
    try:
        source = _source_or_404(db, source_id)
        context = _deletion_context(db, source_id)
        attachments = db.scalars(
            select(AttachmentModel).where(AttachmentModel.source_id == source_id)
        ).all()
        attachment_ids = [attachment.id for attachment in attachments]
        for storage_path in {attachment.storage_path for attachment in attachments}:
            remaining = db.scalar(
                select(func.count())
                .select_from(AttachmentModel)
                .where(
                    AttachmentModel.storage_path == storage_path,
                    AttachmentModel.source_id != source_id,
                )
            ) or 0
            if remaining == 0:
                cleanup_paths.add(storage_path)

        exclusive_ids: list[str] = context["exclusive_ids"]
        shared_ids: list[str] = context["shared_ids"]
        if exclusive_ids:
            relations = db.scalars(
                select(RecordRelation).where(
                    or_(
                        RecordRelation.from_record_id.in_(exclusive_ids),
                        RecordRelation.to_record_id.in_(exclusive_ids),
                    )
                )
            ).all()
            for relation in relations:
                log_audit(
                    db,
                    "delete",
                    "record_relations",
                    relation.id,
                    before={
                        "from_record_id": relation.from_record_id,
                        "to_record_id": relation.to_record_id,
                        "relation_type": relation.relation_type,
                    },
                )
            db.execute(
                delete(RecordRelation).where(
                    or_(
                        RecordRelation.from_record_id.in_(exclusive_ids),
                        RecordRelation.to_record_id.in_(exclusive_ids),
                    )
                )
            )
            records = db.scalars(select(Record).where(Record.id.in_(exclusive_ids))).all()
            for record in records:
                log_audit(
                    db,
                    "delete",
                    "records",
                    record.id,
                    before={"record_type": record.record_type, "title": record.title},
                )
            db.execute(delete(Record).where(Record.id.in_(exclusive_ids)))

        if shared_ids:
            if attachment_ids:
                db.execute(
                    delete(record_attachments).where(
                        record_attachments.c.record_id.in_(shared_ids),
                        record_attachments.c.attachment_id.in_(attachment_ids),
                    )
                )
            db.execute(
                delete(record_sources).where(
                    record_sources.c.record_id.in_(shared_ids),
                    record_sources.c.source_id == source_id,
                )
            )

        db.execute(delete(CandidateBundle).where(CandidateBundle.source_id == source_id))
        db.execute(delete(ExtractionRun).where(ExtractionRun.source_id == source_id))
        db.execute(delete(AttachmentModel).where(AttachmentModel.source_id == source_id))
        log_audit(
            db,
            "delete",
            "source_entries",
            source.id,
            before={
                "original_text": source.original_text,
                "reported_time_text": source.reported_time_text,
                "revision": source.revision,
                **{
                    key: context[key]
                    for key in (
                        "attachments",
                        "candidate_bundles",
                        "extraction_runs",
                        "exclusive_records",
                        "shared_records",
                        "affected_relations",
                    )
                },
            },
        )
        db.delete(source)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="来源仍被其他数据引用，删除已回滚。") from exc
    finally:
        db.close()

    paths: StoragePaths = request.app.state.storage_paths
    warnings: list[str] = []
    deleted_files = 0
    allowed_root = paths.attachment_originals.resolve()
    for storage_path in cleanup_paths:
        target = (paths.root / storage_path).resolve()
        if not target.is_relative_to(allowed_root):
            warnings.append("有附件路径超出原件目录，已跳过物理文件清理。")
            continue
        try:
            if target.exists():
                target.unlink()
                deleted_files += 1
        except OSError:
            warnings.append(f"附件文件 {target.name} 暂时无法删除，请关闭占用程序后清理。")

    return SourceDeletionResult.model_validate(
        {
            **{
                key: context[key]
                for key in (
                    "source_id",
                    "attachments",
                    "candidate_bundles",
                    "extraction_runs",
                    "exclusive_records",
                    "shared_records",
                    "affected_relations",
                )
            },
            "deleted_physical_files": deleted_files,
            "file_cleanup_warnings": warnings,
        }
    )


@router.post("/attachments", response_model=AttachmentResponse, status_code=201)
async def upload_attachment(
    request: Request,
    file: UploadFile,
    user: Annotated[CurrentUser, Depends(require_user)],
    source_id: str | None = None,
) -> AttachmentResponse:
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件类型：{file.content_type}。支持 JPG、PNG、WebP、HEIC、PDF。",
        )

    content = await file.read()
    if len(content) > _MAX_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="文件大小超过 50 MB 上限。",
        )

    sha256_hex = hashlib.sha256(content).hexdigest()
    filename = file.filename or "untitled"
    media_type = (
        file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    )

    paths: StoragePaths = request.app.state.storage_paths
    ext = Path(filename).suffix or ".bin"
    stored_name = f"{sha256_hex}{ext}"
    target = paths.attachment_originals / stored_name

    # 去重：相同 hash 的文件不重复写入
    if not target.exists():
        target.write_bytes(content)

    db = _get_db(request)
    try:
        attachment = AttachmentModel(
            source_id=source_id,
            original_filename=filename,
            media_type=media_type,
            size_bytes=len(content),
            sha256_hex=sha256_hex,
            storage_path=str(target.relative_to(paths.root)),
        )
        db.add(attachment)
        db.commit()
        db.refresh(attachment)
        log_audit(
            db,
            "create",
            "attachments",
            attachment.id,
            after={
                "original_filename": attachment.original_filename,
                "media_type": attachment.media_type,
                "size_bytes": attachment.size_bytes,
            },
        )
        db.commit()
        return AttachmentResponse.model_validate(attachment)
    finally:
        db.close()
