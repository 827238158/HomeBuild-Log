from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.health import HealthChecker

router = APIRouter(tags=["health"])


class ComponentHealth(BaseModel):
    status: Literal["ok"]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: ComponentHealth
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

    if database_ok and storage_ok:
        return HealthResponse(
            status="ok",
            database=ComponentHealth(status="ok"),
            storage=ComponentHealth(status="ok"),
        )

    details = {
        "database": "ok" if database_ok else "unavailable",
        "storage": "ok" if storage_ok else "unavailable",
    }
    error = ErrorResponse(
        code="LOCAL_SERVICE_UNAVAILABLE",
        message="本地数据服务暂不可用，请检查数据库和存储目录。",
        details=details,
        trace_id=str(uuid4()),
        retryable=True,
    )
    return JSONResponse(status_code=503, content=error.model_dump())
