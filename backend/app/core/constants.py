"""跨模块共享领域常量，减少提取、记录和投影模块之间的重复。"""

from __future__ import annotations

from app.domain_models import (
    DecisionDetail,
    EventDetail,
    IssueDetail,
    LedgerDetail,
    MeasurementDetail,
    ProcurementDetail,
    ResearchDetail,
)

TYPE_LABELS: dict[str, str] = {
    "event": "事件",
    "ledger": "账目",
    "issue": "问题",
    "measurement": "尺寸",
    "decision": "决策",
    "procurement": "采购",
    "research": "调研",
}

CERTAINTY_LABELS: dict[str, str] = {
    "explicit": "原文明确信息",
    "inferred": "AI 推断，需要确认",
    "calculated": "计算结果，需要确认",
    "uncertain": "信息不确定",
    "missing": "关键信息缺失",
}

RELATION_TYPES: set[str] = {
    "derived_from",
    "relates_to",
    "implements",
    "resolves",
    "pays_for",
    "tracks_delivery",
    "supersedes",
    "blocks",
    "produces",
}

DETAIL_MODELS: dict[str, type] = {
    "event": EventDetail,
    "ledger": LedgerDetail,
    "issue": IssueDetail,
    "measurement": MeasurementDetail,
    "decision": DecisionDetail,
    "procurement": ProcurementDetail,
    "research": ResearchDetail,
}

# JSON 字段 -> DB 列名（写入方向，api/domain.py 使用）
DETAIL_RENAMES_TO_DB: dict[str, dict[str, str]] = {
    "decision": {"options": "options_json"},
    "research": {
        "options": "options_json",
        "dimensions": "dimensions_json",
        "evidence_sources": "sources_json",
    },
}

# DB 列名 -> JSON 字段（读取方向，projections.py 使用）
DETAIL_RENAMES_TO_JSON: dict[str, dict[str, str]] = {
    "decision": {"options_json": "options"},
    "research": {
        "options_json": "options",
        "dimensions_json": "dimensions",
        "sources_json": "evidence_sources",
    },
}

# AI 状态默认值（api/extractions.py 使用）
STATUS_DEFAULTS: dict[str, str] = {
    "event": "planned",
    "ledger": "planned",
    "issue": "pending",
    "measurement": "active",
    "decision": "pending",
    "procurement": "planned",
    "research": "collecting",
}

# 记录类型必填字段集合（api/extractions.py 使用）
FIELDS_BY_TYPE: dict[str, set[str]] = {
    "event": {"status", "event_kind"},
    "ledger": {"status", "direction", "payment_kind", "amount_minor"},
    "issue": {"status", "phenomenon", "severity"},
    "measurement": {"status", "object_name", "measurement_role", "values"},
    "decision": {"status", "topic"},
    "procurement": {"status", "item_name"},
    "research": {"status", "question"},
}

# 枚举字段合法值集合，用于校验已存在值是否合法（api/extractions.py _fill_missing_required 使用）
VALID_ENUMS: dict[str, dict[str, set[str]]] = {
    "status": {
        "event":       {"planned", "occurred", "completed", "cancelled"},
        "ledger":      {"planned", "posted", "voided"},
        "issue":       {"pending", "in_progress", "done"},
        "measurement": {"active", "superseded", "cancelled"},
        "decision":    {"pending", "confirmed", "cancelled"},
        "procurement": {"planned", "ordered", "partially_paid", "paid", "delivery_pending",
                        "delivered", "returned", "completed", "cancelled"},
        "research":    {"collecting", "comparing", "concluded", "archived"},
    },
    "direction": {
        "ledger": {"expense", "refund", "income"},
    },
}
