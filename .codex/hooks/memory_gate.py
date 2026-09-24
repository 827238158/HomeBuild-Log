# -*- coding: utf-8 -*-
"""Stop Hook：结束前强制一次最小记忆核对，并提示高价值失败。"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from memory_hook_common import (
    find_project_root,
    load_signals,
    load_state,
    read_payload,
    remove_state,
)


def summarize_tool_signals(signals: list[dict[str, Any]]) -> list[str]:
    """只把重复失败或明确的高价值失败提升为归档提醒。"""
    fingerprints = Counter(
        str(signal.get("fingerprint"))
        for signal in signals
        if signal.get("fingerprint")
    )
    summaries: list[str] = []
    if any(count >= 2 for count in fingerprints.values()):
        summaries.append("同一工具操作重复失败")
    strong_markers = sorted({
        str(marker)
        for signal in signals
        if signal.get("strong") is True
        for marker in signal.get("markers", [])
        if marker
    })
    if strong_markers:
        summaries.append("高价值失败类型：" + "、".join(strong_markers))
    return summaries


def main() -> None:
    payload = read_payload()
    if payload.get("stop_hook_active") is True:
        remove_state(payload)
        print(json.dumps({"continue": True}))
        return

    state = load_state(payload)
    root = find_project_root(payload.get("cwd"))
    summaries = summarize_tool_signals(load_signals(payload))
    # 首次 Stop 只续行一次；第二次由 stop_hook_active 放行，避免循环。
    output: dict[str, Any] = {"decision": "block"}
    audit_hint = (
        "结束前执行一次项目记忆审计，再给最终答复。核对本轮已验证结果与 memory/CURRENT.md："
        "运行状态、验收结果、阻塞、下一步或需后续接手的未完成工作变化时，更新 CURRENT（只保留快照）。"
        "重要部署、迁移、长期决策归 LOG；可复用故障原因及处理归 PITFALLS；"
        "已验证步骤归 RUNBOOK；稳定事实与检索路由变化归 MEMORY。"
        "只读咨询、普通进度、误报和无持久价值的小改动无需写入。"
        "完成必要更新后，在最终答复说明更新了哪些记忆文件，或说明无需更新的原因。"
    )
    if state is None or root is None or state.get("root") != str(root):
        output["reason"] = "项目记忆审计状态缺失或不匹配；请手工核对。" + audit_hint
    elif summaries:
        output["reason"] = (
            audit_hint + " 失败线索：" + "；".join(summaries)
            + "。仅在确认具有复用价值时补充 PITFALLS。"
        )
    else:
        output["reason"] = audit_hint
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
