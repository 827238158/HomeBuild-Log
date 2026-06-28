from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    pass


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _new_id() -> str:
    return uuid.uuid4().hex


class SourceEntry(Base):
    __tablename__ = "source_entries"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    input_type: Mapped[str] = mapped_column(String(16), nullable=False, default="text")
    original_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    reported_time_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    attachments: Mapped[list[Attachment]] = relationship(
        "Attachment", back_populates="source", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<SourceEntry id={self.id} type={self.input_type}>"


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    source_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("source_entries.id"), nullable=True
    )
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    media_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256_hex: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    source: Mapped[SourceEntry | None] = relationship(
        "SourceEntry", back_populates="attachments"
    )

    def __repr__(self) -> str:
        return f"<Attachment id={self.id} file={self.original_filename}>"


class AuditEntry(Base):
    __tablename__ = "audit_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    actor: Mapped[str] = mapped_column(String(128), nullable=False, default="admin")
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    target_table: Mapped[str] = mapped_column(String(128), nullable=False)
    target_id: Mapped[str] = mapped_column(String(32), nullable=False)
    before_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    def __repr__(self) -> str:
        return f"<AuditEntry id={self.id} action={self.action} table={self.target_table}>"
