from __future__ import annotations

from typing import Any

from pydantic import ValidationError

MEASUREMENT_ROLE_ALIASES = {
    "material_spec": "material_spec",
    "material": "material_spec",
    "spec": "material_spec",
    "材料规格": "material_spec",
    "site_measurement": "site_measurement",
    "site": "site_measurement",
    "measured": "site_measurement",
    "measurement": "site_measurement",
    "现场测量": "site_measurement",
    "实地测量": "site_measurement",
    "design_requirement": "design_requirement",
    "design": "design_requirement",
    "requirement": "design_requirement",
    "设计要求": "design_requirement",
    "设计尺寸": "design_requirement",
    "calculated": "calculated",
    "calculated_value": "calculated",
    "derived": "calculated",
    "计算结果": "calculated",
    "推算结果": "calculated",
}


def normalize_measurement_role(payload: dict[str, Any]) -> None:
    """将 AI 的尺寸用途别名收敛为稳定枚举，未知值按现场测量处理。"""
    if payload.get("record_type") != "measurement":
        return
    raw = str(payload.get("measurement_role") or "").strip().lower()
    key = raw.replace("-", "_").replace(" ", "_")
    payload["measurement_role"] = MEASUREMENT_ROLE_ALIASES.get(key, "site_measurement")


def candidate_validation_message(exc: ValidationError) -> str:
    """把候选校验错误转换为用户可处理的信息，避免暴露模型内部细节。"""
    labels = {
        "title": "标题", "status": "状态", "record_type": "记录类型",
        "phenomenon": "问题描述", "severity": "严重程度",
        "measurement_role": "尺寸用途", "object_name": "测量对象",
        "values": "尺寸", "value": "尺寸数值", "unit": "尺寸单位",
        "amount_minor": "金额", "vendor_id": "交易对象（商家）",
        "payment_kind": "款项性质", "ledger_kind": "账目类型",
        "direction": "收支方向", "currency": "币种",
        "question": "调研问题", "topic": "决策主题", "event_kind": "事件类型",
        "source_refs": "原始来源", "source_id": "来源",
        "occurred_date": "发生日期", "payment_date": "交易日期",
        "completed_at": "完成日期", "discovered_at": "发现时间",
        "started_at": "开始时间", "ended_at": "结束时间",
        "confirmed_at": "确认时间", "measured_at": "测量时间",
    }
    choices = {
        "severity": "请选择低、中或高严重程度。",
        "measurement_role": "尺寸用途不正确，请选择材料规格、现场测量、设计要求或计算结果。",
        "ledger_kind": "请选择付款、退款或收入。",
        "currency": "币种仅支持人民币。",
        "unit": "尺寸单位请选择毫米、厘米或米。",
        "status": "请选择当前记录类型支持的状态。",
        "record_type": "请选择有效的记录类型。",
    }
    messages: list[str] = []
    # 遍历全部错误，避免第一个字段错误掩盖其余需要补齐的内容。
    for error in exc.errors(include_input=False):
        field = next((str(part) for part in reversed(error["loc"]) if str(part) in labels), None)
        label = labels.get(field, "候选字段")
        kind = error["type"]
        if field == "measurement_role":
            message = choices[field]
        elif kind == "missing":
            message = f"{label}未填写，请补齐。"
        elif kind == "literal_error" and field in choices:
            message = choices[field]
        elif kind in {"union_tag_invalid", "union_tag_not_found"}:
            message = choices["record_type"]
        elif kind == "value_error" and error.get("ctx", {}).get("error") is not None:
            # 仅保留已知业务校验文案，不向用户回显模型内部数据。
            reason = str(error["ctx"]["error"])
            allowed = {
                "账目状态与账目类型不一致",
                "资金流水必须填写商家、款项性质和金额",
                "账目子类型与收支方向不一致",
            }
            message = f"{reason}。" if reason in allowed else f"{label}格式不正确，请检查后重试。"
        elif kind.startswith(("date", "datetime")):
            message = f"{label}格式不正确，请填写有效日期或时间。"
        elif kind in {"greater_than", "greater_than_equal"}:
            message = f"{label}必须大于{error.get('ctx', {}).get('gt', 0)}。"
        elif kind in {"string_too_short", "too_short"}:
            message = f"{label}不能为空，请补齐。"
        elif kind == "string_too_long":
            message = f"{label}过长，最多允许{error['ctx']['max_length']}个字符。"
        else:
            message = f"{label}格式不正确，请检查后重试。"
        if message not in messages:
            messages.append(message)
    return "；".join(message.rstrip("。") for message in messages) + "。"
