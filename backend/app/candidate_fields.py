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
    if any(
        any(str(part) == "measurement_role" for part in error["loc"])
        for error in exc.errors()
    ):
        return "尺寸用途不正确，请选择材料规格、现场测量、设计要求或计算结果。"
    return "候选内容有必填项缺失或格式不正确，请检查候选字段后重试。"
