from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEntry


def log_audit(
    db: Session,
    action: str,
    target_table: str,
    target_id: str,
    actor: str = "admin",
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    """在同一个数据库事务中记录审计条目。"""
    entry = AuditEntry(
        action=action,
        target_table=target_table,
        target_id=target_id,
        actor=actor,
        before_json=before,
        after_json=after,
    )
    db.add(entry)
