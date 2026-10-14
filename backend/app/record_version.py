from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.domain_models import Record
from app.projections import serialize_records


def bump_record_version(db: Session, record: Record, expected_version: int | None = None) -> None:
    """在业务事务中原子抢占版本；失败时不允许继续写入详情或关联。"""
    statement = update(Record).where(Record.id == record.id)
    if expected_version is not None:
        statement = statement.where(Record.version == expected_version)
    result = db.execute(statement.values(
        version=Record.version + 1, updated_at=datetime.now(UTC),
    ).execution_options(synchronize_session=False))
    if result.rowcount != 1:
        record_id = record.id
        db.rollback()
        latest_record = db.scalar(select(Record).where(Record.id == record_id)
                                  .execution_options(populate_existing=True))
        if latest_record is None:
            raise HTTPException(status_code=404, detail="记录已被其他操作删除，请刷新。")
        latest = serialize_records(db, [latest_record])[record_id]
        raise HTTPException(status_code=409, detail=jsonable_encoder({
            "code": "record_version_conflict",
            "message": "记录已被其他操作修改，请核对最新内容后重试。",
            "expected_version": expected_version, "current_version": latest_record.version,
            "latest_record": latest,
        }))
    # 避免 ORM 的旧快照覆盖数据库刚递增的版本。
    db.refresh(record, attribute_names=["version", "updated_at"])
