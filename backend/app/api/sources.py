from __future__ import annotations

import hashlib
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_audit
from app.auth import CurrentUser, require_user
from app.core.paths import StoragePaths
from app.db import create_session_factory
from app.domain_models import DEFAULT_PROJECT_ID, Project
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


def _get_db(request: Request) -> Session:
    engine = request.app.state.engine
    factory = create_session_factory(engine)
    return factory()


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
