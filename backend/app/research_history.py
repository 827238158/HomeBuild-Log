from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain_models import Record, ResearchConclusion, ResearchDetail, ResearchEntry


def normalize_conclusion(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


def append_conclusion(
    db: Session, record: Record, value: str | None, reason: str | None,
    entry_id: str | None = None,
) -> None:
    detail = db.get(ResearchDetail, record.id)
    next_value = normalize_conclusion(value)
    if next_value == normalize_conclusion(detail.conclusion):
        return
    if not reason or not reason.strip():
        raise HTTPException(status_code=422, detail="修改结论时必须填写修正原因或判断依据。")
    if entry_id is not None:
        entry = db.get(ResearchEntry, entry_id)
        if entry is None or entry.record_id != record.id:
            raise HTTPException(status_code=422, detail="关联调研条目不属于当前主题。")
    # 旧记录首次修正时先保存原判断，避免历史数据在新功能中丢失。
    existing = db.scalar(select(ResearchConclusion.id).where(
        ResearchConclusion.record_id == record.id
    ).limit(1))
    if existing is None and normalize_conclusion(detail.conclusion) is not None:
        db.add(ResearchConclusion(
            record_id=record.id, conclusion=detail.conclusion,
            reason="启用结论历史时保留的已有结论（原形成时间未知）",
        ))
        db.flush()
    db.add(ResearchConclusion(
        record_id=record.id, conclusion=next_value, reason=reason.strip(), entry_id=entry_id,
    ))
    detail.conclusion = next_value
