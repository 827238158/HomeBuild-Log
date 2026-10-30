from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain_models import LedgerDetail, Record


def payment_refund_totals(db: Session, payment_ids: list[str]) -> dict[str, int]:
    """批量汇总已入账退款；作废记录保留归属但不占用可退额度。"""
    totals: dict[str, int] = {}
    if not payment_ids:
        return totals
    for payment_id, amount in db.execute(
        select(LedgerDetail.refund_of_record_id, LedgerDetail.amount_minor)
        .join(Record, Record.id == LedgerDetail.record_id)
        .where(LedgerDetail.refund_of_record_id.in_(payment_ids), Record.status == "posted")
    ):
        totals[payment_id] = totals.get(payment_id, 0) + int(amount or 0)
    return totals


def refund_projection(amount_minor: int | None, refunded_minor: int) -> dict[str, Any]:
    return {
        "refunded_minor": refunded_minor,
        "refundable_minor": max(0, int(amount_minor or 0) - refunded_minor),
        "refund_state": (
            "none" if refunded_minor == 0
            else "full" if refunded_minor >= int(amount_minor or 0) else "partial"
        ),
    }
