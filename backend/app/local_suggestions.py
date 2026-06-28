from __future__ import annotations

import hashlib
import re
from typing import Any

TYPE_LABELS = {
    "event": "事件",
    "ledger": "账目",
    "issue": "施工问题",
    "measurement": "尺寸",
    "decision": "决策",
    "procurement": "采购",
    "research": "调研",
    "todo": "待办",
}

AMOUNT_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*元")
DIMENSION_PATTERN = re.compile(
    r"(\d+(?:\.\d+)?)\s*[*xX×]\s*(\d+(?:\.\d+)?)\s*(cm|厘米|mm|毫米|m|米)",
    re.IGNORECASE,
)
QUANTITY_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*(片|块|个|件|套|米)")
DATE_TEXT_PATTERN = re.compile(r"(?:\d{1,2}月(?:\d{1,2}日)?|\d{1,2}\.\d{1,2}日?)")


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
        "time_precision": "unknown",
        "original_time_text": None,
        "timezone": "Asia/Shanghai",
        "stage_id": None,
        "description": None,
        "occurred_at": None,
    }


def _suggestion_key(record_type: str, evidence: str, occurrence: int) -> str:
    digest = hashlib.sha256(
        f"local-rule-v1|{record_type}|{occurrence}|{evidence}".encode()
    ).hexdigest()[:20]
    return f"{record_type}-{digest}"


def suggest_from_text(source_id: str, original_text: str | None) -> dict[str, Any]:
    text = (original_text or "").strip()
    if not text:
        return {
            "source_id": source_id,
            "engine": "local-rule-v1",
            "suggestions": [],
            "relations": [],
        }

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
    ledger_keys: list[str] = []
    for match, direction, kind, verb in [
        *((item, "expense", "other", "已支付") for item in payment_matches),
        *((item, "refund", "refund", "已退款") for item in refund_matches),
    ]:
        amount = match.group(1)
        evidence = _evidence_clause(text, match.group(0))
        payload = _base_payload(source_id, evidence, "ledger", f"{verb}{amount}元", "posted")
        payload.update(
            direction=direction,
            payment_kind=kind,
            amount_minor=_money_minor(amount),
            currency="CNY",
            payment_date=None,
            payment_method=None,
            vendor_id=None,
        )
        ledger_keys.append(add("ledger", f"{verb} {amount} 元", evidence, "explicit", payload))

    total_match = re.search(r"(?:共计|合计|总价|总额)\s*(\d+(?:\.\d+)?)\s*元", text)
    quantity_match = QUANTITY_PATTERN.search(text)
    procurement_trigger = re.search(r"选购|购买|采购|下单|订单|多退少补|老板承诺送货", text)
    procurement_key: str | None = None
    if procurement_trigger or total_match:
        evidence = _evidence_clause(
            text, procurement_trigger.group(0) if procurement_trigger else total_match.group(0)
        )
        item_name = _item_name(text)
        quantity = float(quantity_match.group(1)) if quantity_match else None
        quantity_unit = quantity_match.group(2) if quantity_match else None
        total_minor = _money_minor(total_match.group(1)) if total_match else None
        explicit = bool(total_match or (quantity_match and item_name != "装修材料"))
        payload = _base_payload(
            source_id,
            evidence,
            "procurement",
            f"采购{item_name}",
            "ordered" if re.search(r"选定|下单|已购", text) else "planned",
        )
        payload.update(
            item_name=item_name,
            specification=None,
            quantity=quantity,
            quantity_unit=quantity_unit,
            vendor_id=None,
            order_number=None,
            order_total_minor=total_minor,
            currency="CNY",
            promised_date=None,
            delivery_address=None,
            return_terms="多退少补" if "多退少补" in text else None,
            acceptance_result=None,
        )
        parts = [item_name]
        if quantity_match:
            parts.append(f"{quantity_match.group(1)}{quantity_unit}")
        if total_match:
            parts.append(f"总价 {total_match.group(1)} 元")
        procurement_key = add(
            "procurement",
            "，".join(parts),
            evidence,
            "explicit" if explicit else "uncertain",
            payload,
            [] if explicit else ["商品或订单状态"],
        )

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
            source_id, evidence, "issue", _short_title(evidence, "施工问题"), "open"
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
        payload = _base_payload(
            source_id, clause, "todo", _short_title(action, "后续待办"), "pending"
        )
        payload.update(
            action=action,
            planned_at=None,
            due_at=None,
            trigger_condition="条件触发" if re.search(r"后期|到货|做门套时", clause) else None,
            priority=None,
            completed_at=None,
            completion_evidence=None,
        )
        todo_keys.append(add("todo", action, clause, "explicit", payload))

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
            event_kind="acceptance_test",
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
            event_kind="construction"
            if re.search(r"施工|铺贴|开槽|布线|拆打|水电", evidence)
            else "site_visit",
            started_at=None,
            ended_at=None,
            process=evidence,
            result=None,
            original_time_text=date_match.group(0) if date_match else None,
        )
        event_keys.append(add("event", evidence, evidence, "explicit", payload))

    relations: list[dict[str, str]] = []
    if procurement_key:
        relations.extend(
            {"from_key": key, "to_key": procurement_key, "relation_type": "pays_for"}
            for key in ledger_keys
        )
        relations.extend(
            {"from_key": key, "to_key": procurement_key, "relation_type": "tracks_delivery"}
            for key in todo_keys
            if re.search(
                r"送货|到货|验收",
                next(item["summary"] for item in suggestions if item["key"] == key),
            )
        )
        relations.extend(
            {"from_key": key, "to_key": procurement_key, "relation_type": "produces"}
            for key in decision_keys[:1]
        )
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
