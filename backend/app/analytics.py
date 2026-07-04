from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import date
from typing import Any

from app.ledger_rules import is_effective_ledger
from app.projections import effective_date

TYPE_LABELS = {
    "event": "事件",
    "ledger": "账目",
    "issue": "问题",
    "measurement": "尺寸",
    "decision": "决策",
    "research": "调研",
}

STATUS_LABELS = {
    "planned": "计划中",
    "occurred": "已发生",
    "completed": "已完成",
    "cancelled": "已取消",
    "posted": "已入账",
    "voided": "已作废",
    "open": "待处理",
    "in_progress": "处理中",
    "waiting": "等待中",
    "resolved": "已解决",
    "closed": "已关闭",
    "active": "有效",
    "superseded": "已替代",
    "pending": "待处理",
    "confirmed": "已确认",
    "paid": "已出账",
    "collecting": "收集中",
    "comparing": "比较中",
    "concluded": "已有结论",
    "archived": "已归档",
    "done": "已完成",
}


def distribution(
    values: Iterable[str | None], labels: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    counts = Counter(value or "unknown" for value in values)
    label_map = labels or {}
    return [
        {
            "key": key,
            "label": label_map.get(key, "待补充" if key == "unknown" else key),
            "value": value,
        }
        for key, value in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def time_trend(records: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    counts: Counter[str] = Counter()
    unknown = 0
    for record in records:
        item_date = effective_date(record)
        if item_date is None:
            unknown += 1
        else:
            counts[item_date.strftime("%Y-%m")] += 1
    return (
        [
            {"key": key, "label": f"{key[:4]}年{int(key[5:])}月", "value": counts[key]}
            for key in sorted(counts)
        ],
        unknown,
    )


def base_record_analytics(records: list[dict[str, Any]]) -> dict[str, Any]:
    trend, unknown = time_trend(records)
    return {
        "total": len(records),
        "unknown_date_count": unknown,
        "status_distribution": distribution(
            (record.get("status") for record in records), STATUS_LABELS
        ),
        "type_distribution": distribution(
            (record.get("record_type") for record in records), TYPE_LABELS
        ),
        "time_trend": trend,
    }


def type_specific_analytics(
    record_type: str | None, records: list[dict[str, Any]], *, today: date
) -> dict[str, Any]:
    if not record_type:
        return {}
    field_by_type = {
        "event": ("event_kind", {}),
        "ledger": (
            "ledger_kind",
            {"payment": "付款", "refund": "退款", "income": "收入"},
        ),
        "issue": (
            "severity",
            {"low": "轻微", "medium": "一般", "high": "严重", "critical": "紧急"},
        ),
        "measurement": (
            "measurement_role",
            {
                "material_spec": "材料规格",
                "site_measurement": "现场测量",
                "design_requirement": "设计要求",
                "calculated": "计算值",
            },
        ),
        "decision": ("status", STATUS_LABELS),
        "research": ("status", STATUS_LABELS),
    }
    field, labels = field_by_type[record_type]
    result: dict[str, Any] = {
        "dimension": field,
        "distribution": distribution((record.get(field) for record in records), labels),
    }
    if record_type == "measurement":
        result["unit_distribution"] = distribution(
            
                value.get("unit")
                for record in records
                for value in record.get("values", [])
            
        )
    return result


def money_trend(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, int]] = {}
    for record in records:
        if not is_effective_ledger(record):
            continue
        item_date = effective_date(record)
        if item_date is None:
            continue
        key = item_date.strftime("%Y-%m")
        bucket = buckets.setdefault(
            key, {"expense_minor": 0, "refund_minor": 0, "income_minor": 0}
        )
        direction = record.get("direction")
        if direction in {"expense", "refund", "income"}:
            bucket[f"{direction}_minor"] += int(record.get("amount_minor") or 0)
    return [
        {"key": key, "label": f"{key[:4]}年{int(key[5:])}月", **buckets[key]}
        for key in sorted(buckets)
    ]
