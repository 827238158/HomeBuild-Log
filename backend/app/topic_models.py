from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.db_types import UTCDateTime
from app.domain_models import _new_id, _utcnow


class Topic(Base):
    __tablename__ = "topics"
    __table_args__ = (
        UniqueConstraint("project_id", "name"),
        CheckConstraint("status IN ('active', 'archived')", name="ck_topic_status"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    goal: Mapped[str | None] = mapped_column(Text)
    current_situation: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="active")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)


class RecordTopic(Base):
    __tablename__ = "record_topics"
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id", ondelete="CASCADE"), primary_key=True,
    )
    topic_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True, index=True,
    )


class PitfallTopic(Base):
    __tablename__ = "pitfall_topics"
    pitfall_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("pitfalls.id", ondelete="CASCADE"), primary_key=True,
    )
    topic_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("topics.id", ondelete="CASCADE"), primary_key=True, index=True,
    )


class IssueActivity(Base):
    __tablename__ = "issue_activities"
    __table_args__ = (
        CheckConstraint("kind IN ('status', 'note')", name="ck_issue_activity_kind"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id", ondelete="CASCADE"), index=True,
    )
    kind: Mapped[str] = mapped_column(String(16))
    previous_status: Mapped[str | None] = mapped_column(String(32))
    next_status: Mapped[str | None] = mapped_column(String(32))
    content: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
