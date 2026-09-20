# -*- coding: utf-8 -*-
"""Stop Hook：在任务结束前非阻断提醒审计已确认的失败信号。"""

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
    remove_state(payload)
    output: dict[str, Any] = {"continue": True}
    # 只给非阻断提醒，归档价值由 Agent 判断，不以文件是否改动代替判断。
    if state is None or root is None or state.get("root") != str(root):
        output["systemMessage"] = "项目记忆审计状态缺失或不匹配；请手工判断是否有值得保留的经验，本轮正常结束。"
    elif summaries:
        output["systemMessage"] = (
            "项目记忆审计提示：" + "；".join(summaries)
            + "。仅在确认存在可复用经验时更新 PITFALLS；已记录、模拟或无复用价值的信号无需归档，也无需为此续跑。"
        )
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
