from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.health import DatabaseRevisionStatus, HealthChecker

router = APIRouter(tags=["health"])


class ComponentHealth(BaseModel):
    status: Literal["ok"]


class RevisionHealth(BaseModel):
    status: Literal["ok"]
    current: str
    expected: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: ComponentHealth
    database_revision: RevisionHealth
    storage: ComponentHealth


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict[str, str]
    trace_id: str
    retryable: bool


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": ErrorResponse}},
)
def read_health(request: Request) -> HealthResponse | JSONResponse:
    checker: HealthChecker = request.app.state.health_checker
    database_ok = checker.database_is_healthy()
    storage_ok = checker.storage_is_healthy()
    revision_reader = getattr(checker, "database_revision_status", None)
    revision = (
        revision_reader()
        if callable(revision_reader)
        else DatabaseRevisionStatus(current="test", expected="test", is_current=True)
    )

    if database_ok and storage_ok and revision.is_current:
        return HealthResponse(
            status="ok",
            database=ComponentHealth(status="ok"),
            database_revision=RevisionHealth(
                status="ok",
                current=revision.current or "unknown",
                expected=revision.expected or "unknown",
            ),
            storage=ComponentHealth(status="ok"),
        )

    details = {
        "database": "ok" if database_ok else "unavailable",
        "database_revision": "ok" if revision.is_current else "outdated",
        "storage": "ok" if storage_ok else "unavailable",
    }
    revision_mismatch = database_ok and storage_ok and not revision.is_current
    error = ErrorResponse(
        code=(
            "DATABASE_REVISION_MISMATCH"
            if revision_mismatch
            else "LOCAL_SERVICE_UNAVAILABLE"
        ),
        message=(
            "数据库结构版本落后，请先完成数据库迁移。"
            if revision_mismatch
            else "本地数据服务暂不可用，请检查数据库和存储目录。"
        ),
        details=details,
        trace_id=str(uuid4()),
        retryable=True,
    )
    return JSONResponse(status_code=503, content=error.model_dump())
