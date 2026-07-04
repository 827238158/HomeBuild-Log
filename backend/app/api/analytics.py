from __future__ import annotations

import math
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analytics import (
    base_record_analytics,
    distribution,
    type_specific_analytics,
)
from app.auth import CurrentUser, require_user
from app.db import create_session_factory
from app.domain_models import CandidateBundle, ExtractionRun
from app.projections import list_project_records, record_matches, serialize_records

router = APIRouter(tags=["analytics"])
User = Annotated[CurrentUser, Depends(require_user)]
BEIJING = ZoneInfo("Asia/Shanghai")


def _db(request: Request) -> Session:
    return create_session_factory(request.app.state.engine)()


def _today() -> date:
    return datetime.now(BEIJING).date()


@router.get("/overview")
def overview(request: Request, user: User) -> dict[str, Any]:
    db = _db(request)
    try:
        records = list_project_records(db)
        serialized = serialize_records(db, records)
        rows = [serialized[record.id] for record in records]
        today = _today()
        horizon = today + timedelta(days=7)

        open_issues = [
            record
            for record in rows
            if record["record_type"] == "issue" and record["status"] != "done"
        ]
        overdue: list[dict[str, Any]] = []
        upcoming: list[dict[str, Any]] = []
        recent = sorted(
            rows,
            key=lambda item: str(item.get("occurred_date") or item.get("created_at") or ""),
            reverse=True,
        )[:10]
        return {
            "as_of_date": today.isoformat(),
            "horizon_date": horizon.isoformat(),
            "summary": {
                "open_issue_count": len(open_issues),
                "overdue_count": len(overdue),
                "upcoming_count": len(upcoming),
            },
            "open_issues": open_issues,
            "overdue": overdue,
            "upcoming": upcoming,
            "recent_records": recent,
            "stage_distribution": distribution(
                
                    record.get("stage", {}).get("name")
                    if record.get("stage")
                    else None
                    for record in rows
                
            ),
        }
    finally:
        db.close()


@router.get("/records/analytics")
def records_analytics(
    request: Request,
    user: User,
    record_type: str | None = None,
    space_id: str | None = None,
    stage_id: str | None = None,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    db = _db(request)
    try:
        records = list_project_records(db)
        serialized = serialize_records(db, records)
        selected = [
            serialized[record.id]
            for record in records
            if record_matches(
                serialized[record.id],
                record_type=record_type,
                space_id=space_id,
                stage_id=stage_id,
                status=status,
                date_from=date_from,
                date_to=date_to,
            )
        ]
        return {
            "summary": base_record_analytics(selected),
            "specific": type_specific_analytics(record_type, selected, today=_today()),
            "records": selected,
        }
    finally:
        db.close()


def _range_start(value: str) -> datetime | None:
    days = {"7d": 7, "30d": 30, "90d": 90}.get(value)
    if days is None:
        return None
    return datetime.now(UTC) - timedelta(days=days)


def _request_rows(db: Session, range_value: str) -> list[dict[str, Any]]:
    stmt = select(ExtractionRun).order_by(ExtractionRun.started_at.desc(), ExtractionRun.attempt_no)
    start = _range_start(range_value)
    if start is not None:
        stmt = stmt.where(ExtractionRun.started_at >= start)
    attempts = list(db.scalars(stmt).all())
    fallback_by_run = {
        bundle.extraction_run_id: str(bundle.bundle_json.get("fallback_reason") or "")
        for bundle in db.scalars(select(CandidateBundle)).all()
    }
    grouped: dict[str, list[ExtractionRun]] = defaultdict(list)
    for attempt in attempts:
        grouped[attempt.request_id].append(attempt)
    result = []
    for request_id, rows in grouped.items():
        rows.sort(key=lambda item: item.attempt_no)
        succeeded = [row for row in rows if row.status == "succeeded"]
        final = succeeded[-1] if succeeded else rows[-1]
        token_values = [row.total_tokens for row in rows if row.total_tokens is not None]
        fallback_reason = fallback_by_run.get(final.id, "")
        result.append(
            {
                "request_id": request_id,
                "started_at": rows[0].started_at,
                "requested_engine": rows[0].requested_engine,
                "final_engine": final.engine,
                "final_model": final.model,
                "status": "succeeded" if succeeded else "failed",
                "fallback": bool(fallback_reason) and rows[0].requested_engine != "local",
                "fallback_reason": fallback_reason or None,
                "duration_ms": sum(row.duration_ms for row in rows),
                "total_tokens": sum(token_values) if token_values else None,
                "error_code": None if succeeded else final.error_code,
                "error_summary": None if succeeded else final.error_message,
            }
        )
    return sorted(result, key=lambda item: item["started_at"], reverse=True)


@router.get("/ai-analytics/overview")
def ai_overview(
    request: Request,
    user: User,
    range: Literal["7d", "30d", "90d", "all"] = "30d",
) -> dict[str, Any]:
    db = _db(request)
    try:
        rows = _request_rows(db, range)
        request_count = len(rows)
        success_count = sum(row["status"] == "succeeded" for row in rows)
        fallback_count = sum(row["fallback"] for row in rows)
        durations = sorted(row["duration_ms"] for row in rows)
        p95 = durations[max(0, math.ceil(len(durations) * 0.95) - 1)] if durations else 0
        trend_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            local_date = row["started_at"].astimezone(BEIJING).date().isoformat()
            trend_groups[local_date].append(row)
        trend = [
            {
                "key": key,
                "label": f"{key[5:7]}月{key[8:10]}日",
                "requests": len(group),
                "successes": sum(item["status"] == "succeeded" for item in group),
                "fallbacks": sum(item["fallback"] for item in group),
                "average_duration_ms": round(
                    sum(item["duration_ms"] for item in group) / len(group)
                ),
                "total_tokens": sum(item["total_tokens"] or 0 for item in group),
            }
            for key, group in sorted(trend_groups.items())
        ]
        return {
            "range": range,
            "summary": {
                "request_count": request_count,
                "success_rate": success_count / request_count if request_count else 0,
                "fallback_rate": fallback_count / request_count if request_count else 0,
                "average_duration_ms": (
                    round(sum(durations) / request_count) if request_count else 0
                ),
                "p95_duration_ms": p95,
                "total_tokens": sum(row["total_tokens"] or 0 for row in rows),
                "token_request_count": sum(row["total_tokens"] is not None for row in rows),
            },
            "trend": trend,
            "engine_distribution": distribution(row["final_engine"] for row in rows),
            "error_distribution": distribution(
                row["error_code"] for row in rows if row["status"] == "failed"
            ),
        }
    finally:
        db.close()


@router.get("/ai-analytics/runs")
def ai_runs(
    request: Request,
    user: User,
    range: Literal["7d", "30d", "90d", "all"] = "30d",
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    db = _db(request)
    try:
        rows = _request_rows(db, range)
        return {
            "items": rows[offset : offset + limit],
            "total": len(rows),
            "limit": limit,
            "offset": offset,
        }
    finally:
        db.close()
