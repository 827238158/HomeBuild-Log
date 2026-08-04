# -*- coding: utf-8 -*-
"""Project memory Hooks 的纯逻辑回归测试。"""

from __future__ import annotations

import json
import unittest

from memory_gate import evaluate_gate, summarize_tool_signals
from memory_router import build_context
from memory_signal_collector import classify_tool_event


PITFALLS = """# Pitfalls

## Python 与 Conda

- 触发：pip 和 Python 混用。
  原因：环境不一致。
  处理：使用同一解释器。

## Docker

- 触发：Docker 构建超时。
  原因：Buildx 未使用代理。
  处理：同时配置客户端和构建步骤代理。
"""

LOG = """# 操作日志

| 日期 | 事项 | 摘要 |
| --- | --- | --- |
| 2026-08-03 | Ubuntu Docker 验证 | 空数据容器通过。 |
| 2026-08-04 | 文档检修 | 修正记忆路由。 |
"""


class MemoryRouterTests(unittest.TestCase):
    def test_only_injects_matching_sections_and_log_rows(self) -> None:
        context = build_context("检查 Ubuntu Docker 容器部署", PITFALLS, LOG)

        self.assertIn("## Docker", context)
        self.assertIn("Ubuntu Docker 验证", context)
        self.assertNotIn("## Python 与 Conda", context)
        self.assertNotIn("文档检修", context)

    def test_unmatched_prompt_injects_nothing(self) -> None:
        self.assertEqual(build_context("帮我给这句话换个说法", PITFALLS, LOG), "")

    def test_business_record_prompt_injects_search_route(self) -> None:
        context = build_context("AI分析为调研，手动修改成问题后又恢复", PITFALLS, LOG)

        self.assertIn("业务记录与 AI 分析", context)
        self.assertIn("候选确认", context)
        self.assertNotIn("## Docker", context)


class MemorySignalCollectorTests(unittest.TestCase):
    def test_successful_tool_output_is_ignored(self) -> None:
        signal = classify_tool_event({
            "tool_name": "Bash",
            "tool_input": {"command": "pytest"},
            "tool_response": "Exit code: 0\n12 passed",
        })

        self.assertIsNone(signal)

    def test_successful_search_for_error_text_is_ignored(self) -> None:
        signal = classify_tool_event({
            "tool_name": "Bash",
            "tool_input": {"command": "rg traceback"},
            "tool_response": "Exit code: 0\nsource.py: contains traceback example",
        })

        self.assertIsNone(signal)

    def test_dependency_failure_is_anonymized_and_high_signal(self) -> None:
        signal = classify_tool_event({
            "tool_name": "Bash",
            "tool_input": {"command": "python app.py --token secret-value"},
            "tool_response": "Exit code: 1\nModuleNotFoundError: No module named demo",
        })

        self.assertIsNotNone(signal)
        self.assertTrue(signal["strong"])
        self.assertIn("依赖或环境", signal["markers"])
        self.assertNotIn("secret-value", json.dumps(signal, ensure_ascii=False))

    def test_repeated_transient_failure_becomes_high_signal(self) -> None:
        signal = {"fingerprint": "same", "markers": ["超时"], "strong": False}

        self.assertEqual(summarize_tool_signals([signal]), [])
        self.assertIn("同一工具操作重复失败", summarize_tool_signals([signal, signal]))


class MemoryGateTests(unittest.TestCase):
    def test_workspace_change_requires_current_update(self) -> None:
        missing = evaluate_gate(
            baseline_digest="before",
            current_digest="after",
            before_memory={"current": "1", "log": "1", "pitfalls": "1"},
            after_memory={"current": "1", "log": "1", "pitfalls": "1"},
            prompt="修改普通页面文案",
            last_message="已完成。",
        )

        self.assertTrue(any("CURRENT.md" in item for item in missing))

    def test_failure_signal_requires_pitfall_review(self) -> None:
        missing = evaluate_gate(
            baseline_digest="before",
            current_digest="after",
            before_memory={"current": "1", "log": "1", "pitfalls": "1"},
            after_memory={"current": "2", "log": "1", "pitfalls": "1"},
            prompt="Docker 构建反复失败并超时",
            last_message="已修复并验证通过。",
        )

        self.assertTrue(any("PITFALLS.md" in item for item in missing))

    def test_hook_change_requires_log_review(self) -> None:
        missing = evaluate_gate(
            baseline_digest="before",
            current_digest="after",
            before_memory={"current": "1", "log": "1", "pitfalls": "1"},
            after_memory={"current": "2", "log": "1", "pitfalls": "1"},
            prompt="为项目实现记忆 hooks",
            last_message="Hook 已完成。",
        )

        self.assertTrue(any("LOG.md" in item for item in missing))

    def test_completed_memory_updates_pass_gate(self) -> None:
        missing = evaluate_gate(
            baseline_digest="before",
            current_digest="after",
            before_memory={"current": "1", "log": "1", "pitfalls": "1"},
            after_memory={"current": "2", "log": "2", "pitfalls": "2"},
            prompt="修复 Docker 部署超时并更新 Hook",
            last_message="已修复并完成验收。",
        )

        self.assertEqual(missing, [])

    def test_high_signal_tool_failure_requires_pitfall_review(self) -> None:
        missing = evaluate_gate(
            baseline_digest="before",
            current_digest="after",
            before_memory={"current": "1", "log": "1", "pitfalls": "1"},
            after_memory={"current": "2", "log": "1", "pitfalls": "1"},
            prompt="修复启动异常",
            last_message="已修复并通过测试。",
            tool_signals=[{
                "fingerprint": "dependency-error",
                "markers": ["依赖或环境"],
                "strong": True,
            }],
        )

        self.assertTrue(any("PITFALLS.md" in item for item in missing))


if __name__ == "__main__":
    unittest.main()
