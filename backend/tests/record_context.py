from __future__ import annotations

from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.domain_models import (
    DEFAULT_PROJECT_ID,
    Project,
    ProjectStage,
    Record,
    Space,
    record_spaces,
)


def record_context(client: Any) -> dict[str, Any]:
    """成功创建用例显式选择真实归属，不修改通用 HTTP 客户端。"""
    cached = getattr(client, "_test_record_context", None)
    if cached is None:
        # 只建立测试实体，不制造来源或审计，避免干扰事务残留断言。
        with Session(client.app.state.engine) as db:
            if db.get(Project, DEFAULT_PROJECT_ID) is None:
                db.add(Project(id=DEFAULT_PROJECT_ID, name="测试装修", is_active=True))
                db.flush()
            space = Space(project_id=DEFAULT_PROJECT_ID, name="测试记录空间", kind="room")
            stage = ProjectStage(project_id=DEFAULT_PROJECT_ID, name="测试记录阶段")
            db.add_all([space, stage])
            db.flush()
            cached = {"space_ids": [space.id], "stage_id": stage.id}
            db.commit()
        client._test_record_context = cached
    return {"space_ids": list(cached["space_ids"]), "stage_id": cached["stage_id"]}


def creation_payload(client: Any, payload: dict[str, Any]) -> dict[str, Any]:
    """为既有成功用例补齐基线，显式空值和无效引用仍保留以便测试拒绝。"""
    return {**record_context(client), **payload}


def clear_historical_context(client: Any, record_id: str) -> None:
    """明确构造升级前旧数据；新建 API 始终遵守必填约束。"""
    with Session(client.app.state.engine) as db:
        row = db.get(Record, record_id)
        assert row is not None
        row.stage_id = None
        db.execute(delete(record_spaces).where(record_spaces.c.record_id == record_id))
        db.commit()


def confirmation_payload(
    client: Any, endpoint: str, body: dict[str, Any]
) -> dict[str, Any]:
    """候选成功用例明确选择归属，候选原文与业务字段保持原值。"""
    current_endpoint = endpoint.removesuffix("/confirm")
    current = client.get(current_endpoint)
    assert current.status_code == 200, current.text
    candidates = {row["key"]: row for row in current.json().get("suggestions", [])}
    selections = []
    for selection in body.get("selections", []):
        candidate_payload = candidates.get(selection["key"], {}).get("payload", {})
        payload = dict(selection.get("payload") or candidate_payload)
        context = record_context(client)
        # 自动提取本来没有归属；测试在确认动作中显式选择，不反写候选包。
        for field in ("space_ids", "stage_id"):
            if not payload.get(field):
                payload[field] = context[field]
        selections.append({**selection, "payload": payload})
    return {**body, "selections": selections}
