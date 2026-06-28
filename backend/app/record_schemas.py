from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class SourceRef(BaseModel):
    source_id: str
    evidence_excerpt: str | None = None


class RecordCommonCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    occurred_at: datetime | None = None
    time_precision: Literal[
        "exact",
        "date",
        "early_month",
        "mid_month",
        "late_month",
        "month",
        "approximate",
        "range",
        "unknown",
    ] = "unknown"
    original_time_text: str | None = None
    timezone: str = "Asia/Shanghai"
    stage_id: str | None = None
    source_refs: list[SourceRef] = Field(min_length=1)
    space_ids: list[str] = []
    material_ids: list[str] = []
    participant_ids: list[str] = []
    attachment_ids: list[str] = []


class RecordCommonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    occurred_at: datetime | None = None
    time_precision: (
        Literal[
            "exact",
            "date",
            "early_month",
            "mid_month",
            "late_month",
            "month",
            "approximate",
            "range",
            "unknown",
        ]
        | None
    ) = None
    original_time_text: str | None = None
    timezone: str | None = None
    stage_id: str | None = None
    source_refs: list[SourceRef] | None = Field(default=None, min_length=1)
    space_ids: list[str] | None = None
    material_ids: list[str] | None = None
    participant_ids: list[str] | None = None
    attachment_ids: list[str] | None = None


class EventCreate(RecordCommonCreate):
    record_type: Literal["event"]
    status: Literal["planned", "occurred", "completed", "cancelled"]
    event_kind: str
    started_at: datetime | None = None
    ended_at: datetime | None = None
    process: str | None = None
    result: str | None = None


class EventUpdate(RecordCommonUpdate):
    record_type: Literal["event"]
    status: Literal["planned", "occurred", "completed", "cancelled"] | None = None
    event_kind: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    process: str | None = None
    result: str | None = None


class LedgerCreate(RecordCommonCreate):
    record_type: Literal["ledger"]
    status: Literal["planned", "posted", "voided"]
    direction: Literal["expense", "refund"]
    payment_kind: str
    amount_minor: int = Field(gt=0)
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    payment_date: date | None = None
    payment_method: str | None = None
    vendor_id: str | None = None


class LedgerUpdate(RecordCommonUpdate):
    record_type: Literal["ledger"]
    status: Literal["planned", "posted", "voided"] | None = None
    direction: Literal["expense", "refund"] | None = None
    payment_kind: str | None = None
    amount_minor: int | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    payment_date: date | None = None
    payment_method: str | None = None
    vendor_id: str | None = None


class IssueCreate(RecordCommonCreate):
    record_type: Literal["issue"]
    status: Literal["open", "in_progress", "waiting", "resolved", "closed"]
    discovered_at: datetime | None = None
    phenomenon: str
    severity: str | None = None
    responsible_party: str | None = None
    handling_plan: str | None = None
    actual_result: str | None = None
    resolution_kind: str | None = None


class IssueUpdate(RecordCommonUpdate):
    record_type: Literal["issue"]
    status: Literal["open", "in_progress", "waiting", "resolved", "closed"] | None = None
    discovered_at: datetime | None = None
    phenomenon: str | None = None
    severity: str | None = None
    responsible_party: str | None = None
    handling_plan: str | None = None
    actual_result: str | None = None
    resolution_kind: str | None = None


class MeasurementValueInput(BaseModel):
    axis: str | None = None
    value: Decimal = Field(gt=0)
    unit: str


class MeasurementCreate(RecordCommonCreate):
    record_type: Literal["measurement"]
    status: Literal["active", "superseded", "cancelled"] = "active"
    object_name: str
    measurement_role: Literal[
        "material_spec", "site_measurement", "design_requirement", "calculated"
    ]
    approximate: bool = False
    tolerance_text: str | None = None
    measured_at: datetime | None = None
    method: str | None = None
    values: list[MeasurementValueInput] = Field(min_length=1)


class MeasurementUpdate(RecordCommonUpdate):
    record_type: Literal["measurement"]
    status: Literal["active", "superseded", "cancelled"] | None = None
    object_name: str | None = None
    measurement_role: (
        Literal["material_spec", "site_measurement", "design_requirement", "calculated"] | None
    ) = None
    approximate: bool | None = None
    tolerance_text: str | None = None
    measured_at: datetime | None = None
    method: str | None = None
    values: list[MeasurementValueInput] | None = Field(default=None, min_length=1)


class DecisionCreate(RecordCommonCreate):
    record_type: Literal["decision"]
    status: Literal["pending", "confirmed", "superseded", "cancelled"]
    topic: str
    options: list[str] = []
    selected_option: str | None = None
    rationale: str | None = None
    confirmed_at: datetime | None = None


class DecisionUpdate(RecordCommonUpdate):
    record_type: Literal["decision"]
    status: Literal["pending", "confirmed", "superseded", "cancelled"] | None = None
    topic: str | None = None
    options: list[str] | None = None
    selected_option: str | None = None
    rationale: str | None = None
    confirmed_at: datetime | None = None


class ProcurementCreate(RecordCommonCreate):
    record_type: Literal["procurement"]
    status: Literal[
        "planned",
        "ordered",
        "partially_paid",
        "paid",
        "delivery_pending",
        "delivered",
        "returned",
        "completed",
        "cancelled",
    ]
    item_name: str
    specification: str | None = None
    quantity: Decimal | None = Field(default=None, gt=0)
    quantity_unit: str | None = None
    vendor_id: str | None = None
    order_number: str | None = None
    order_total_minor: int | None = Field(default=None, ge=0)
    currency: str = Field(default="CNY", min_length=3, max_length=3)
    promised_date: date | None = None
    delivery_address: str | None = None
    return_terms: str | None = None
    acceptance_result: str | None = None


class ProcurementUpdate(RecordCommonUpdate):
    record_type: Literal["procurement"]
    status: (
        Literal[
            "planned",
            "ordered",
            "partially_paid",
            "paid",
            "delivery_pending",
            "delivered",
            "returned",
            "completed",
            "cancelled",
        ]
        | None
    ) = None
    item_name: str | None = None
    specification: str | None = None
    quantity: Decimal | None = Field(default=None, gt=0)
    quantity_unit: str | None = None
    vendor_id: str | None = None
    order_number: str | None = None
    order_total_minor: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    promised_date: date | None = None
    delivery_address: str | None = None
    return_terms: str | None = None
    acceptance_result: str | None = None


class ResearchCreate(RecordCommonCreate):
    record_type: Literal["research"]
    status: Literal["collecting", "comparing", "concluded", "archived"]
    question: str
    options: list[str] = []
    dimensions: list[str] = []
    evidence_sources: list[str] = []
    conclusion: str | None = None
    limitations: str | None = None


class ResearchUpdate(RecordCommonUpdate):
    record_type: Literal["research"]
    status: Literal["collecting", "comparing", "concluded", "archived"] | None = None
    question: str | None = None
    options: list[str] | None = None
    dimensions: list[str] | None = None
    evidence_sources: list[str] | None = None
    conclusion: str | None = None
    limitations: str | None = None


class TodoCreate(RecordCommonCreate):
    record_type: Literal["todo"]
    status: Literal["pending", "in_progress", "waiting", "done", "cancelled"]
    action: str
    planned_at: datetime | None = None
    due_at: datetime | None = None
    trigger_condition: str | None = None
    priority: str | None = None
    completed_at: datetime | None = None
    completion_evidence: str | None = None


class TodoUpdate(RecordCommonUpdate):
    record_type: Literal["todo"]
    status: Literal["pending", "in_progress", "waiting", "done", "cancelled"] | None = None
    action: str | None = None
    planned_at: datetime | None = None
    due_at: datetime | None = None
    trigger_condition: str | None = None
    priority: str | None = None
    completed_at: datetime | None = None
    completion_evidence: str | None = None


RecordCreate = Annotated[
    EventCreate
    | LedgerCreate
    | IssueCreate
    | MeasurementCreate
    | DecisionCreate
    | ProcurementCreate
    | ResearchCreate
    | TodoCreate,
    Field(discriminator="record_type"),
]
RecordUpdate = Annotated[
    EventUpdate
    | LedgerUpdate
    | IssueUpdate
    | MeasurementUpdate
    | DecisionUpdate
    | ProcurementUpdate
    | ResearchUpdate
    | TodoUpdate,
    Field(discriminator="record_type"),
]
