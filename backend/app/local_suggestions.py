from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta
from typing import Any

from app.core.constants import TYPE_LABELS

AMOUNT_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*元")
DIMENSION_PATTERN = re.compile(
    r"(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米|m|米)",
    re.IGNORECASE,
)
QUANTITY_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(片|块|个|件|套|米)")
DATE_TEXT_PATTERN = re.compile(
    r"(?:\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d{1,2}\.\d{1,2}日?|今天|昨天|前天|上周[一二三四五六日天])"
)


def _clauses(text: str) -> list[str]:
    return [
        part.strip("。；;，,（）() ")
        for part in re.split(r"[。；;，,（）()]", text)
        if part.strip()
    ]


def _evidence_clause(text: str, marker: str) -> str:
    return next((clause for clause in _clauses(text) if marker in clause), text[:120])


def _money_minor(value: str) -> int:
    return round(float(value) * 100)


def _unit(unit: str) -> str:
    return {"厘米": "cm", "毫米": "mm", "米": "m"}.get(unit.lower(), unit.lower())


def _item_name(text: str) -> str:
    names = (
        "HDMI光纤线",
        "智能开关",
        "铝合金腰线",
        "普通纯色砖",
        "普通砖",
        "柔光砖",
        "亮面砖",
        "花砖",
        "瓷砖",
        "门套",
    )
    return next((name for name in names if name.lower() in text.lower()), "装修材料")


def _short_title(text: str, fallback: str) -> str:
    cleaned = re.sub(r"^\s*\d+[.、]\s*", "", text).strip()
    return (cleaned[:36] or fallback).rstrip("，。；")


def _base_payload(
    source_id: str,
    evidence: str,
    record_type: str,
    title: str,
    status: str,
) -> dict[str, Any]:
    return {
        "record_type": record_type,
        "title": title,
        "status": status,
        "source_refs": [{"source_id": source_id, "evidence_excerpt": evidence}],
        "space_ids": [],
        "material_ids": [],
        "participant_ids": [],
        "attachment_ids": [],
        "occurred_date": None,
        "original_time_text": None,
        "timezone": "Asia/Shanghai",
        "stage_id": None,
        "description": None,
    }


def _suggestion_key(record_type: str, evidence: str, occurrence: int) -> str:
    digest = hashlib.sha256(
        f"local-rule-v1|{record_type}|{occurrence}|{evidence}".encode()
    ).hexdigest()[:20]
    return f"{record_type}-{digest}"


def resolve_date_text(text: str, reference: date) -> tuple[date | None, str | None, bool]:
    match = DATE_TEXT_PATTERN.search(text)
    if not match:
        return None, None, False
    raw = match.group(0)
    if raw in {"今天", "昨天", "前天"}:
        return reference - timedelta(days={"今天": 0, "昨天": 1, "前天": 2}[raw]), raw, False
    if raw.startswith("上周"):
        weekday = "一二三四五六日天".index(raw[-1])
        if raw[-1] == "天":
            weekday = 6
        start_this_week = reference - timedelta(days=reference.weekday())
        return start_this_week - timedelta(days=7) + timedelta(days=weekday), raw, False
    normalized = raw.replace("年", "-").replace("月", "-").replace("日", "").replace(".", "-")
    parts = normalized.split("-")
    try:
        if len(parts[0]) == 4:
            return date(int(parts[0]), int(parts[1]), int(parts[2])), raw, False
        candidate = date(reference.year, int(parts[0]), int(parts[1]))
        # 无年份月日优先解释为近期已发生事实，明显落在未来时回退一年。
        if candidate > reference + timedelta(days=31):
            candidate = candidate.replace(year=reference.year - 1)
        return candidate, raw, True
    except (ValueError, IndexError):
        return None, raw, False


def unique_resolved_date(
    text: str, reference: date
) -> tuple[date | None, str | None, bool]:
    """仅在整段原文能唯一解析为同一日期时提供安全回退。"""
    resolved = [
        result
        for match in DATE_TEXT_PATTERN.finditer(text)
        if (result := resolve_date_text(match.group(0), reference))[0] is not None
    ]
    if len({result[0] for result in resolved}) != 1:
        return None, None, False
    return resolved[0]


def suggest_from_text(
    source_id: str,
    original_text: str | None,
    captured_at: datetime | date | None = None,
) -> dict[str, Any]:
    text = (original_text or "").strip()
    if not text:
        return {
            "source_id": source_id,
            "engine": "local-rule-v1",
            "suggestions": [],
            "relations": [],
        }

    reference_date = captured_at.date() if isinstance(captured_at, datetime) else captured_at
    reference_date = reference_date or date.today()
    suggestions: list[dict[str, Any]] = []
    occurrences: dict[str, int] = {}

    def add(
        record_type: str,
        summary: str,
        evidence: str,
        certainty: str,
        payload: dict[str, Any],
        missing_fields: list[str] | None = None,
    ) -> str:
        resolved_date, original_time_text, inferred_year = resolve_date_text(
            evidence, reference_date
        )
        used_source_fallback = False
        if resolved_date is None:
            resolved_date, original_time_text, inferred_year = unique_resolved_date(
                text, reference_date
            )
            used_source_fallback = resolved_date is not None
        if resolved_date is not None:
            payload["occurred_date"] = resolved_date.isoformat()
            payload["original_time_text"] = original_time_text
            if inferred_year and not used_source_fallback and certainty == "explicit":
                certainty = "likely"
        elif "发生日期" not in (missing_fields or []):
            missing_fields = [*(missing_fields or []), "发生日期"]
        occurrence = occurrences.get(record_type, 0)
        occurrences[record_type] = occurrence + 1
        key = _suggestion_key(record_type, evidence, occurrence)
        suggestions.append(
            {
                "key": key,
                "record_type": record_type,
                "type_label": TYPE_LABELS[record_type],
                "summary": summary,
                "evidence": evidence,
                "certainty": certainty,
                "certainty_label": {
                    "explicit": "原文明确信息",
                    "likely": "较可能",
                    "uncertain": "需要确认",
                }[certainty],
                "selected_by_default": certainty == "explicit",
                "payload": payload,
                "missing_fields": missing_fields or [],
            }
        )
        return key

    # 账目只采集明确的实际资金流，订单总额不会被当作付款。
    payment_matches = list(
        re.finditer(r"(?:已交|已付|支付|付款|付了|交了)\s*(\d+(?:\.\d+)?)\s*元", text)
    )
    refund_matches = list(re.finditer(r"(?:已退款|退款|退回)\s*(\d+(?:\.\d+)?)\s*元", text))
    income_matches = list(re.finditer(
        r"(?:到账|报销|回收款|转入|收到)\s*(\d+(?:\.\d+)?)\s*元", text
    ))
    for match, direction, kind, verb in [
        *((item, "expense", "其他款项", "已支付") for item in payment_matches),
        *((item, "refund", "退款", "已退款") for item in refund_matches),
        *((item, "income", "收入", "已收入") for item in income_matches),
    ]:
        amount = match.group(1)
        evidence = _evidence_clause(text, match.group(0))
        status = "paid" if direction == "expense" else "posted"
        payload = _base_payload(source_id, evidence, "ledger", f"{verb}{amount}元", status)
        payload.update(
            ledger_kind={"expense": "payment", "refund": "refund", "income": "income"}[direction],
            direction=direction,
            payment_kind=kind,
            amount_minor=_money_minor(amount),
            currency="CNY",
            payment_date=None,
            payment_method=None,
            vendor_id=None,
        )
        add("ledger", f"{verb} {amount} 元", evidence, "explicit", payload)

    # 多维规格和单值近似尺寸分别保留语义角色。
    for match in DIMENSION_PATTERN.finditer(text):
        evidence = _evidence_clause(text, match.group(0))
        object_name = _item_name(evidence)
        payload = _base_payload(
            source_id, evidence, "measurement", f"{object_name}{match.group(0)}", "active"
        )
        payload.update(
            object_name=object_name,
            measurement_role="material_spec",
            approximate=False,
            tolerance_text=None,
            measured_at=None,
            method=None,
            values=[
                {"axis": "width", "value": float(match.group(1)), "unit": _unit(match.group(3))},
                {"axis": "height", "value": float(match.group(2)), "unit": _unit(match.group(3))},
            ],
        )
        add("measurement", f"{object_name}规格 {match.group(0)}", evidence, "explicit", payload)

    approx_match = re.search(
        r"(?P<object>厨房门|门洞|宽度|长度|高度)[^，。]{0,12}(?:约|大约|需要约)\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>cm|厘米|mm|毫米|m|米)",
        text,
        re.IGNORECASE,
    )
    if approx_match:
        evidence = _evidence_clause(text, approx_match.group(0))
        payload = _base_payload(source_id, evidence, "measurement", "近似设计尺寸", "active")
        payload.update(
            object_name=approx_match.group("object"),
            measurement_role="design_requirement",
            approximate=True,
            tolerance_text=None,
            measured_at=None,
            method=None,
            values=[
                {
                    "axis": "width",
                    "value": float(approx_match.group("value")),
                    "unit": _unit(approx_match.group("unit")),
                }
            ],
        )
        summary = (
            f"{approx_match.group('object')}约 {approx_match.group('value')}"
            f"{_unit(approx_match.group('unit'))}"
        )
        add(
            "measurement",
            summary,
            evidence,
            "explicit",
            payload,
        )

    issue_key: str | None = None
    issue_marker = re.search(r"破裂|开裂|渗水|漏水|空鼓|位置错误|损坏|返工|缺陷|争议", text)
    if issue_marker and not (
        "打压" in text
        and "通过" in text
        and issue_marker.group(0) not in _evidence_clause(text, issue_marker.group(0))
    ):
        evidence = _evidence_clause(text, issue_marker.group(0))
        payload = _base_payload(
            source_id, evidence, "issue", _short_title(evidence, "问题"), "pending"
        )
        payload.update(
            discovered_at=None,
            phenomenon=evidence,
            severity=None,
            responsible_party=None,
            handling_plan=None,
            actual_result=None,
            resolution_kind=None,
        )
        issue_key = add("issue", evidence, evidence, "explicit", payload, ["严重程度"])

    decision_keys: list[str] = []
    for clause in _clauses(text):
        marker = re.search(r"已确认|确认|决定|选定|采用", clause)
        if not marker:
            continue
        topic = re.sub(r"^(?:\d+[.、]\s*)?(?:已确认|确认|决定|最终选定|选定)", "", clause).strip()
        if not topic:
            continue
        payload = _base_payload(
            source_id, clause, "decision", _short_title(topic, "装修决策"), "confirmed"
        )
        payload.update(
            topic=_short_title(topic, "装修决策"),
            options=[],
            selected_option=topic,
            rationale=None,
            confirmed_at=None,
        )
        decision_keys.append(add("decision", topic, clause, "explicit", payload))

    pending_decision_key: str | None = None
    if re.search(r"如何|还是|是否", text) and not decision_keys:
        evidence = _evidence_clause(text, "如何" if "如何" in text else "还是")
        options = []
        if "还是" in evidence:
            options = [item.strip() for item in evidence.split("还是") if item.strip()]
        payload = _base_payload(source_id, evidence, "decision", "待确认装修方案", "pending")
        payload.update(
            topic=evidence,
            options=options,
            selected_option=None,
            rationale=None,
            confirmed_at=None,
        )
        pending_decision_key = add(
            "decision", "待决定：" + evidence, evidence, "uncertain", payload, ["最终选择"]
        )

    todo_keys: list[str] = []
    for clause in _clauses(text):
        marker = re.search(r"^待|后续|后期|计划|承诺.*送货|需要.*补充|会补充|只等|等待", clause)
        if not marker:
            continue
        if "已完成" in clause or "完成拆打" in clause:
            continue
        action = clause
        payload = _base_payload(source_id, clause, "issue", _short_title(action, "问题"), "pending")
        payload.update(
            discovered_at=None,
            phenomenon=action,
            severity=None,
            responsible_party=None,
            handling_plan=None,
            completed_at=None,
            actual_result=None,
            resolution_kind=None,
        )
        todo_keys.append(add("issue", action, clause, "explicit", payload, ["严重程度"]))

    research_key: str | None = None
    if re.search(r"如何|还是|比较|调研|现场规划", text):
        evidence = next(
            (clause for clause in _clauses(text) if re.search(r"如何|还是|比较|调研|规划", clause)),
            text[:120],
        )
        payload = _base_payload(source_id, evidence, "research", "装修方案调研", "collecting")
        payload.update(
            question=evidence,
            options=[item.strip() for item in evidence.split("还是") if item.strip()]
            if "还是" in evidence
            else [],
            dimensions=[],
            evidence_sources=[],
            conclusion=None,
            limitations=None,
        )
        research_key = add(
            "research", evidence, evidence, "uncertain", payload, ["比较依据", "结论"]
        )

    event_keys: list[str] = []
    acceptance_match = re.search(r"[^。；，]{0,20}(?:测试|验收)[^。；，]{0,20}通过", text)
    if acceptance_match:
        evidence = acceptance_match.group(0).strip()
        payload = _base_payload(source_id, evidence, "event", "验收测试通过", "completed")
        payload.update(
            event_kind="验收测试通过",
            started_at=None,
            ended_at=None,
            process=None,
            result=evidence,
        )
        event_keys.append(add("event", evidence, evidence, "explicit", payload))

    occurred_clauses = [
        clause
        for clause in _clauses(text)
        if re.search(r"开始|完成|已经|去现场|选购|进行|发现|铺贴完毕|结束", clause)
        and not re.search(r"^待|计划|后续|承诺", clause)
        and clause != (acceptance_match.group(0).strip() if acceptance_match else "")
    ]
    if occurred_clauses:
        evidence = "；".join(occurred_clauses[:3])
        payload = _base_payload(
            source_id,
            evidence,
            "event",
            _short_title(occurred_clauses[0], "装修事件"),
            "completed" if re.search(r"完成|完毕|结束", evidence) else "occurred",
        )
        date_match = DATE_TEXT_PATTERN.search(evidence)
        payload.update(
            event_kind="施工"
            if re.search(r"施工|铺贴|开槽|布线|拆打|水电", evidence)
            else "现场查看",
            started_at=None,
            ended_at=None,
            process=evidence,
            result=None,
            original_time_text=date_match.group(0) if date_match else None,
        )
        event_keys.append(add("event", evidence, evidence, "explicit", payload))

    relations: list[dict[str, str]] = []
    if issue_key:
        relations.extend(
            {"from_key": key, "to_key": issue_key, "relation_type": "resolves"}
            for key in decision_keys[:1]
        )
        relations.extend(
            {"from_key": key, "to_key": issue_key, "relation_type": "implements"}
            for key in todo_keys[:1]
        )
    if pending_decision_key and research_key:
        relations.append(
            {
                "from_key": research_key,
                "to_key": pending_decision_key,
                "relation_type": "relates_to",
            }
        )

    return {
        "source_id": source_id,
        "engine": "local-rule-v1",
        "suggestions": suggestions,
        "relations": relations,
    }
