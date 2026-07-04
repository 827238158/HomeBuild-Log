from __future__ import annotations

LEDGER_DIRECTION_BY_KIND = {
    "payment": "expense",
    "refund": "refund",
    "income": "income",
}

LEDGER_COMPLETED_STATUS_BY_KIND = {
    "payment": "paid",
    "refund": "posted",
    "income": "posted",
}


def valid_statuses_for_ledger_kind(ledger_kind: str) -> set[str]:
    completed = LEDGER_COMPLETED_STATUS_BY_KIND.get(ledger_kind)
    return {"planned", "voided", completed} if completed else set()


def is_effective_ledger(record: dict[str, object]) -> bool:
    """只有类型、方向、完成状态相互一致的真实流水才参与金额计算。"""
    kind = str(record.get("ledger_kind") or "")
    return (
        record.get("record_type") == "ledger"
        and record.get("direction") == LEDGER_DIRECTION_BY_KIND.get(kind)
        and record.get("status") == LEDGER_COMPLETED_STATUS_BY_KIND.get(kind)
    )
