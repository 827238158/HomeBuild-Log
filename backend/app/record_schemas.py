from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from app.ledger_rules import LEDGER_DIRECTION_BY_KIND, valid_statuses_for_ledger_kind


def normalize_ledger_currency(data: object) -> object:
    """仅归一化明确的人民币别名，外币仍交由枚举校验拒绝。"""
    if isinstance(data, dict) and isinstance(data.get("currency"), str):
        currency = data["currency"].strip()
        if currency.upper() in {"CNY", "RMB", "人民币"}:
            return {**data, "currency": "CNY"}
    return data


class SourceRef(BaseModel):
    source_id: str
    evidence_excerpt: str | None = None


class RecordCommonCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    occurred_date: date | None = None
    original_time_text: str | None = None
    timezone: str = "Asia/Shanghai"
    stage_id: str | None = None
    source_refs: list[SourceRef] = Field(min_length=1)
    space_ids: list[str] = []
    material_ids: list[str] = []
    participant_ids: list[str] = []
    attachment_ids: list[str] = []
    related_record_ids: list[str] = []


class RecordCommonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    occurred_date: date | None = None
    original_time_text: str | None = None
    timezone: str | None = None
    stage_id: str | None = None
    source_refs: list[SourceRef] | None = Field(default=None, min_length=1)
    space_ids: list[str] | None = None
    material_ids: list[str] | None = None
    participant_ids: list[str] | None = None
    attachment_ids: list[str] | None = None
    related_record_ids: list[str] | None = None


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
    ledger_kind: Literal["payment", "refund", "income"] = "payment"
    status: Literal[
        "planned", "posted", "paid", "voided",
    ]
    direction: Literal["expense", "refund", "income"] | None = None
    payment_kind: str | None = None
    amount_minor: int | None = Field(default=None, gt=0)
    currency: Literal["CNY"] = "CNY"
    payment_date: date | None = None
    payment_method: str | None = None
    vendor_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def infer_legacy_ledger_kind(cls, data: object) -> object:
        data = normalize_ledger_currency(data)
        if isinstance(data, dict) and not data.get("ledger_kind"):
            data = dict(data)
            data["ledger_kind"] = {
                "refund": "refund", "income": "income",
            }.get(str(data.get("direction")), "payment")
        return data

    @model_validator(mode="after")
    def validate_ledger_kind(self) -> LedgerCreate:
        if self.status not in valid_statuses_for_ledger_kind(self.ledger_kind):
            raise ValueError("账目状态与账目类型不一致")
        if not self.vendor_id or not self.payment_kind or self.amount_minor is None:
            raise ValueError("资金流水必须填写商家、款项性质和金额")
        if self.direction != LEDGER_DIRECTION_BY_KIND[self.ledger_kind]:
            raise ValueError("账目子类型与收支方向不一致")
        return self


class LedgerUpdate(RecordCommonUpdate):
    record_type: Literal["ledger"]
    ledger_kind: Literal["payment", "refund", "income"] | None = None
    status: Literal[
        "planned", "posted", "paid", "voided",
    ] | None = None
    direction: Literal["expense", "refund", "income"] | None = None
    payment_kind: str | None = None
    amount_minor: int | None = Field(default=None, gt=0)
    currency: Literal["CNY"] | None = None
    payment_date: date | None = None
    payment_method: str | None = None
    vendor_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_currency(cls, data: object) -> object:
        return normalize_ledger_currency(data)


class IssueCreate(RecordCommonCreate):
    record_type: Literal["issue"]
    status: Literal["pending", "in_progress", "done"]
    discovered_at: datetime | None = None
    phenomenon: str
    severity: Literal["low", "medium", "high"]
    responsible_party: str | None = None
    handling_plan: str | None = None
    completed_at: date | None = None
    actual_result: str | None = None
    resolution_kind: str | None = None


class IssueUpdate(RecordCommonUpdate):
    record_type: Literal["issue"]
    status: Literal["pending", "in_progress", "done"] | None = None
    discovered_at: datetime | None = None
    phenomenon: str | None = None
    severity: Literal["low", "medium", "high"] | None = None
    responsible_party: str | None = None
    handling_plan: str | None = None
    completed_at: date | None = None
    actual_result: str | None = None
    resolution_kind: str | None = None


class MeasurementValueInput(BaseModel):
    axis: str | None = None
    value: Decimal = Field(gt=0)
    unit: Literal["mm"] = "mm"

    @model_validator(mode="before")
    @classmethod
    def convert_to_millimetres(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data
        unit = str(data.get("unit") or "mm").lower()
        value = Decimal(str(data.get("value")))
        if unit == "cm":
            value *= Decimal("10")
        elif unit == "m":
            value *= Decimal("1000")
        elif unit != "mm":
            return data
        return {**data, "value": value, "unit": "mm"}


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
    values: list[MeasurementValueInput] = []


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
    values: list[MeasurementValueInput] | None = None


class DecisionCreate(RecordCommonCreate):
    record_type: Literal["decision"]
    status: Literal["pending", "confirmed", "cancelled"]
    topic: str
    options: list[str] = []
    selected_option: str | None = None
    rationale: str | None = None
    confirmed_at: datetime | None = None


class DecisionUpdate(RecordCommonUpdate):
    record_type: Literal["decision"]
    status: Literal["pending", "confirmed", "cancelled"] | None = None
    topic: str | None = None
    options: list[str] | None = None
    selected_option: str | None = None
    rationale: str | None = None
    confirmed_at: datetime | None = None


def reject_conclusion_writes(data: object) -> object:
    """空旧字段只用于兼容，不得覆盖已保留的结论。"""
    if isinstance(data, dict):
        conclusion = data.get("conclusion")
        if (conclusion is not None and
                (not isinstance(conclusion, str) or conclusion.strip())) or any(
            key in data for key in ("conclusion_reason", "conclusion_entry_id")
        ):
            raise ValueError("结论功能已停用，请将内容追加为调研。")
        return {key: value for key, value in data.items() if key != "conclusion"}
    return data


class ResearchCreate(RecordCommonCreate):
    _reject_conclusion = model_validator(mode="before")(reject_conclusion_writes)

    record_type: Literal["research"]
    status: Literal["collecting", "comparing", "archived"]
    question: str
    options: list[str] = []
    dimensions: list[str] = []
    evidence_sources: list[str] = []
    conclusion: str | None = None
    limitations: str | None = None


class ResearchUpdate(RecordCommonUpdate):
    _reject_conclusion = model_validator(mode="before")(reject_conclusion_writes)

    record_type: Literal["research"]
    status: Literal["collecting", "comparing", "archived"] | None = None
    question: str | None = None
    options: list[str] | None = None
    dimensions: list[str] | None = None
    evidence_sources: list[str] | None = None
    conclusion: str | None = None
    limitations: str | None = None
    conclusion_reason: str | None = Field(default=None, max_length=10000)
    conclusion_entry_id: str | None = None


RecordCreate = Annotated[
    EventCreate
    | LedgerCreate
    | IssueCreate
    | MeasurementCreate
    | DecisionCreate
    | ResearchCreate,
    Field(discriminator="record_type"),
]
RecordUpdate = Annotated[
    EventUpdate
    | LedgerUpdate
    | IssueUpdate
    | MeasurementUpdate
    | DecisionUpdate
    | ResearchUpdate,
    Field(discriminator="record_type"),
]
