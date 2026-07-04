from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.db_types import UTCDateTime

DEFAULT_PROJECT_ID = "00000000000000000000000000000001"
DEFAULT_ROOT_SPACE_ID = "00000000000000000000000000000002"


def _new_id() -> str:
    return uuid.uuid4().hex


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _association_table(name: str, target: str, target_column: str) -> Table:
    return Table(
        name,
        Base.metadata,
        Column(
            "record_id",
            String(32),
            ForeignKey("records.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        Column(target_column, String(32), ForeignKey(f"{target}.id"), primary_key=True),
    )


record_sources = Table(
    "record_sources",
    Base.metadata,
    Column(
        "record_id",
        String(32),
        ForeignKey("records.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("source_id", String(32), ForeignKey("source_entries.id"), primary_key=True),
    Column("evidence_excerpt", Text, nullable=True),
    Column("source_revision", Integer, nullable=False, default=1, server_default="1"),
)
record_spaces = _association_table("record_spaces", "spaces", "space_id")
record_materials = _association_table("record_materials", "materials", "material_id")
record_participants = _association_table("record_participants", "participants", "participant_id")
record_attachments = _association_table("record_attachments", "attachments", "attachment_id")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)


class Space(Base):
    __tablename__ = "spaces"
    __table_args__ = (UniqueConstraint("project_id", "parent_id", "name"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("spaces.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)


class NamedEntityMixin:
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)


class Material(NamedEntityMixin, Base):
    __tablename__ = "materials"
    brand: Mapped[str | None] = mapped_column(String(200), nullable=True)
    model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    color: Mapped[str | None] = mapped_column(String(200), nullable=True)
    finish: Mapped[str | None] = mapped_column(String(200), nullable=True)


class Vendor(NamedEntityMixin, Base):
    __tablename__ = "vendors"
    contact: Mapped[str | None] = mapped_column(String(500), nullable=True)


class Participant(NamedEntityMixin, Base):
    __tablename__ = "participants"
    role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    contact: Mapped[str | None] = mapped_column(String(500), nullable=True)


class ProjectStage(NamedEntityMixin, Base):
    __tablename__ = "project_stages"
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Record(Base):
    __tablename__ = "records"
    __table_args__ = (UniqueConstraint("project_id", "origin_key"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), nullable=False)
    record_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    origin_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    original_time_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Shanghai")
    stage_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("project_stages.id"))
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    sources = relationship("SourceEntry", secondary=record_sources)
    spaces = relationship("Space", secondary=record_spaces)
    materials = relationship("Material", secondary=record_materials)
    participants = relationship("Participant", secondary=record_participants)
    attachments = relationship("Attachment", secondary=record_attachments)


class ExtractionRun(Base):
    """一次提取请求中的单个引擎尝试，失败尝试同样保留。"""

    __tablename__ = "extraction_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    request_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("source_entries.id"), nullable=False, index=True
    )
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    requested_engine: Mapped[str] = mapped_column(String(16), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    engine: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    prompt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    finished_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class CandidateBundle(Base):
    """一次成功提取产生的可版本化候选包。"""

    __tablename__ = "candidate_bundles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    source_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("source_entries.id"), nullable=False, index=True
    )
    extraction_run_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("extraction_runs.id"), nullable=False, unique=True
    )
    engine: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    source_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    bundle_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)


class EventDetail(Base):
    __tablename__ = "event_details"
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
    event_kind: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    process: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str | None] = mapped_column(Text)


class LedgerDetail(Base):
    __tablename__ = "ledger_details"
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
    ledger_kind: Mapped[str] = mapped_column(String(24), nullable=False, default="payment")
    direction: Mapped[str | None] = mapped_column(String(16))
    payment_kind: Mapped[str | None] = mapped_column(String(32))
    amount_minor: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="CNY")
    payment_date: Mapped[date | None] = mapped_column(Date)
    payment_method: Mapped[str | None] = mapped_column(String(100))
    vendor_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("vendors.id"))


class IssueDetail(Base):
    __tablename__ = "issue_details"
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
    discovered_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    phenomenon: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str | None] = mapped_column(String(32))
    responsible_party: Mapped[str | None] = mapped_column(String(200))
    handling_plan: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[date | None] = mapped_column(Date)
    actual_result: Mapped[str | None] = mapped_column(Text)
    resolution_kind: Mapped[str | None] = mapped_column(String(32))


class MeasurementDetail(Base):
    __tablename__ = "measurement_details"
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
    object_name: Mapped[str] = mapped_column(String(300), nullable=False)
    measurement_role: Mapped[str] = mapped_column(String(32), nullable=False)
    approximate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    tolerance_text: Mapped[str | None] = mapped_column(String(200))
    measured_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    method: Mapped[str | None] = mapped_column(String(200))


class MeasurementValue(Base):
    __tablename__ = "measurement_values"
    __table_args__ = (UniqueConstraint("record_id", "ordinal"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("measurement_details.record_id", ondelete="CASCADE"), nullable=False
    )
    axis: Mapped[str | None] = mapped_column(String(50))
    value: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)


class DecisionDetail(Base):
    __tablename__ = "decision_details"
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
    topic: Mapped[str] = mapped_column(String(300), nullable=False)
    options_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    selected_option: Mapped[str | None] = mapped_column(Text)
    rationale: Mapped[str | None] = mapped_column(Text)
    confirmed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class ResearchDetail(Base):
    __tablename__ = "research_details"
    record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id", ondelete="CASCADE"), primary_key=True
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    options_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    dimensions_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    sources_json: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    conclusion: Mapped[str | None] = mapped_column(Text)
    limitations: Mapped[str | None] = mapped_column(Text)


class RecordRelation(Base):
    __tablename__ = "record_relations"
    __table_args__ = (
        UniqueConstraint("from_record_id", "to_record_id", "relation_type"),
        CheckConstraint("from_record_id <> to_record_id", name="ck_record_relation_not_self"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    project_id: Mapped[str] = mapped_column(String(32), ForeignKey("projects.id"), nullable=False)
    from_record_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("records.id"), nullable=False
    )
    to_record_id: Mapped[str] = mapped_column(String(32), ForeignKey("records.id"), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=_utcnow)
