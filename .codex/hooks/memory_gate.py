# -*- coding: utf-8 -*-
"""Stop Hook：在任务结束前检查是否遗漏必要的项目记忆更新。"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from memory_hook_common import (
    find_project_root,
    load_signals,
    load_state,
    memory_hashes,
    read_payload,
    remove_state,
    workspace_digest,
)


PITFALL_SIGNALS = (
    "踩坑", "反复失败", "失败恢复", "乱码", "超时", "权限", "沙箱拦截",
    "依赖混用", "环境冲突", "无法启动", "module not found", "traceback",
    "permission denied", "timeout", "timed out", "failed to", "exit code: 1",
)
LOG_SIGNALS = (
    "部署", "上线", "发布", "数据迁移", "基线迁移", "回滚", "回退", "灾难恢复",
    "整机恢复", "架构决策", "长期决策", "重大重构", "实机验收", "初始化",
    "hook", "hooks", "deploy", "rollback", "disaster recovery", "schema migration",
)
COMPLETION_SIGNALS = (
    "已完成", "已修复", "已解决", "已定位", "已确认", "原因已查明", "已部署",
    "已迁移", "已验收", "成功", "全部通过", "completed", "fixed", "resolved",
    "identified", "confirmed", "deployed", "migrated", "verified", "passed",
)


def _contains_any(text: str, signals: tuple[str, ...]) -> bool:
    normalized = text.casefold()
    return any(signal.casefold() in normalized for signal in signals)


def changed_keys(before: dict[str, Any], after: dict[str, Any]) -> set[str]:
    return {key for key in set(before) | set(after) if before.get(key) != after.get(key)}


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


def evaluate_gate(
    *,
    baseline_digest: str | None,
    current_digest: str | None,
    before_memory: dict[str, Any],
    after_memory: dict[str, Any],
    prompt: str,
    last_message: str,
    tool_signals: list[dict[str, Any]] | None = None,
) -> list[str]:
    workspace_changed = (
        baseline_digest is not None
        and current_digest is not None
        and baseline_digest != current_digest
    )
    memory_changed = changed_keys(before_memory, after_memory)
    # 只判断本轮提示与最终答复，避免旧 transcript 中的历史报错造成永久误拦截。
    combined = "\n".join((prompt, last_message))
    completed = _contains_any(last_message, COMPLETION_SIGNALS)
    pitfall_detected = _contains_any(combined, PITFALL_SIGNALS)
    log_detected = _contains_any(combined, LOG_SIGNALS)
    tool_signal_summaries = summarize_tool_signals(tool_signals or [])

    missing: list[str] = []
    if workspace_changed and "current" not in memory_changed:
        missing.append("`memory/CURRENT.md` 未反映本轮工作区改动")
    if (pitfall_detected or tool_signal_summaries) and (workspace_changed or completed) and "pitfalls" not in memory_changed:
        detail = "；".join(tool_signal_summaries)
        suffix = f"（{detail}）" if detail else ""
        missing.append(f"检测到值得审计的失败/环境信号{suffix}，但 `memory/PITFALLS.md` 未更新")
    if log_detected and (workspace_changed or completed) and "log" not in memory_changed:
        missing.append("检测到部署/迁移/Hook/长期决策，但 `memory/LOG.md` 未更新")
    return missing


def main() -> None:
    payload = read_payload()
    # 关键步骤：Stop Hook 自动续跑后不再二次拦截，防止无限循环。
    if payload.get("stop_hook_active") is True:
        remove_state(payload)
        print(json.dumps({"continue": True}, ensure_ascii=False))
        return

    state = load_state(payload)
    root = find_project_root(payload.get("cwd"))
    if state is None or root is None:
        remove_state(payload)
        print(json.dumps({
            "continue": True,
            "systemMessage": "项目记忆结束门禁缺少基线状态或项目根目录；本轮请由 AI 手工判断是否需要归档。",
        }, ensure_ascii=False))
        return

    current_digest = workspace_digest(root)
    tool_signals = load_signals(payload)
    missing = evaluate_gate(
        baseline_digest=state.get("workspace_digest"),
        current_digest=current_digest,
        before_memory=state.get("memory_hashes") if isinstance(state.get("memory_hashes"), dict) else {},
        after_memory=memory_hashes(root),
        prompt=str(state.get("prompt") or ""),
        last_message=str(payload.get("last_assistant_message") or ""),
        tool_signals=tool_signals,
    )
    remove_state(payload)
    if not missing:
        output: dict[str, object] = {"continue": True}
        if current_digest is None:
            output["systemMessage"] = (
                "项目记忆结束门禁无法读取当前 Git 基线；本轮已降级为提示词与工具信号审计。"
            )
        print(json.dumps(output, ensure_ascii=False))
        return

    reason = (
        "结束前记忆门禁发现未完成项：\n- "
        + "\n- ".join(missing)
        + "\n请先做一次最小记忆审计：只写入未来仍有价值的事实、命令或陷阱，"
        "不要写普通进度。如果某个信号经核对属于误报，不得为凑数写文档，"
        "但需在最终答复说明已审计且无需归档。"
    )
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
