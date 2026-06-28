from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser, require_user
from app.db import create_session_factory
from app.models import AuditEntry

router = APIRouter(tags=["audit"])


class AuditEntryResponse(BaseModel):
    id: int
    timestamp: datetime
    actor: str
    action: str
    target_table: str
    target_id: str
    before_json: dict | None
    after_json: dict | None

    model_config = {"from_attributes": True}


def _get_db(request: Request) -> Session:
    engine = request.app.state.engine
    factory = create_session_factory(engine)
    return factory()


@router.get("/audit", response_model=list[AuditEntryResponse])
def list_audit_entries(
    request: Request,
    target_table: str | None = Query(default=None),
    action: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: CurrentUser = Depends(require_user),
) -> list[AuditEntryResponse]:
    db = _get_db(request)
    try:
        stmt = select(AuditEntry).order_by(AuditEntry.timestamp.desc())
        if target_table:
            stmt = stmt.where(AuditEntry.target_table == target_table)
        if action:
            stmt = stmt.where(AuditEntry.action == action)
        stmt = stmt.limit(limit)
        rows = db.execute(stmt).scalars().all()
        return [AuditEntryResponse.model_validate(r) for r in rows]
    finally:
        db.close()
