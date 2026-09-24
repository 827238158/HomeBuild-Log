# -*- coding: utf-8 -*-
"""Project memory Hooks 的纯逻辑回归测试。"""

from __future__ import annotations

import json
import unittest
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from collections import Counter

from memory_gate import summarize_tool_signals
from memory_router import build_context, load_categories, parse_sections

HOOKS = Path(__file__).resolve().parent
ROOT = HOOKS.parent.parent
CATEGORIES, _ = load_categories(HOOKS / "memory_routes.json")
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
        context = build_context("检查 Ubuntu Docker 容器部署", PITFALLS, LOG, CATEGORIES)

        self.assertIn("## Docker", context)
        self.assertIn("Ubuntu Docker 验证", context)
        self.assertNotIn("## Python 与 Conda", context)
        self.assertNotIn("文档检修", context)

    def test_unmatched_prompt_injects_nothing(self) -> None:
        self.assertEqual(build_context("帮我给这句话换个说法", PITFALLS, LOG, CATEGORIES), "")

    def test_business_record_prompt_injects_search_route(self) -> None:
        context = build_context("AI分析为调研，手动修改成问题后又恢复", PITFALLS, LOG, CATEGORIES)

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


class RegressionTests(unittest.TestCase):
    def test_duplicate_sections_preserve_both_entries(self):
        parsed = parse_sections("## 前端 UI\n- 抽屉遮挡\n## Docker\n- 镜像\n## 前端 UI\n- 图表")
        self.assertIn("抽屉遮挡", parsed["前端 UI"])
        self.assertIn("图表", parsed["前端 UI"])

    def test_memory_prompt_excludes_incidental_deployment_summary(self):
        log = "| 2026-09-01 | 手机修复部署 | 同步项目记忆。 |\n| 2026-09-02 | 记忆系统优化 | 精简文档。 |"
        context = build_context("优化记忆系统", "", log, CATEGORIES)
        self.assertIn("记忆系统优化", context)
        self.assertNotIn("手机修复部署", context)

    def test_real_headings_are_unique_and_routed(self):
        markdown = (ROOT / "memory/PITFALLS.md").read_text(encoding="utf-8")
        headings = [line[3:] for line in markdown.splitlines() if line.startswith("## ")]
        self.assertTrue(all(n == 1 for n in Counter(headings).values()))
        self.assertFalse(set(headings) - {c.section for c in CATEGORIES})
        self.assertIn("详情抽屉", build_context("前端 UI 下拉菜单", markdown, "", CATEGORIES))

    def test_structured_success_with_error_examples_is_ignored(self):
        for response in ({"exit_code": 0, "output": "Traceback ModuleNotFoundError timeout"},
                         {"exitCode": 0, "output": "permission denied"},
                         {"output": "Traceback", "session_id": 123},
                         "Traceback is an example, no status",
                         "Exit code: 0\nOutput:\nExit code: 1\nModuleNotFoundError"):
            with self.subTest(response=response):
                self.assertIsNone(classify_tool_event({"tool_response": response}))

    def test_structured_failure_is_not_hidden_by_success_text(self):
        for response in ({"exit_code": 1, "output": "Exit code: 0\nModuleNotFoundError"},
                         {"isError": True, "output": "ModuleNotFoundError"},
                         json.dumps({"exit_code": 1, "output": "ModuleNotFoundError"})):
            with self.subTest(response=response):
                self.assertTrue(classify_tool_event({"tool_response": response})["strong"])

    def test_router_length_is_bounded_with_visible_notice(self):
        context = build_context("Docker", "## Docker\n" + "经验内容\n" * 3000, "", CATEGORIES)
        self.assertLessEqual(len(context), 5500)
        self.assertIn("片段已截短", context)


class HookLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.env = dict(os.environ, HOMEBUILD_MEMORY_HOOK_STATE_DIR=self.temp.name)
        self.payload = {"cwd": str(ROOT), "session_id": "test", "turn_id": "one"}

    def call(self, script, **extra):
        result = subprocess.run(
            [sys.executable, "-X", "utf8", "-B", str(HOOKS / script)],
            input=json.dumps(dict(self.payload, **extra), ensure_ascii=False),
            encoding="utf-8", capture_output=True, env=self.env, timeout=10, check=True,
            cwd=ROOT / "memory",
        )
        return json.loads(result.stdout)

    def start(self, prompt="解释部署流程"):
        return self.call("memory_router.py", prompt=prompt)

    def collect(self, response):
        return self.call("memory_signal_collector.py", tool_name="exec_command",
                         tool_input={"cmd": "same-operation"}, tool_response=response)

    def test_read_only_deployment_consultation_gets_one_audit_pass(self):
        self.start()
        output = self.call("memory_gate.py", last_assistant_message="已确认部署流程。")
        self.assertEqual(output["decision"], "block")
        self.assertIn("只读咨询", output["reason"])

    def test_successful_document_read_with_errors_never_escalates(self):
        self.start()
        self.collect({"exit_code": 0, "output": "ModuleNotFoundError 迁移失败 timeout"})
        output = self.call("memory_gate.py")
        self.assertEqual(output["decision"], "block")
        self.assertIn("CURRENT", output["reason"])
        self.assertNotIn("失败线索", output["reason"])

    def test_one_transient_failure_does_not_escalate(self):
        self.start()
        self.collect({"exit_code": 1, "output": "timed out"})
        output = self.call("memory_gate.py")
        self.assertEqual(output["decision"], "block")
        self.assertNotIn("失败线索", output["reason"])

    def test_repeated_failure_prompts_one_audit_and_cleans_state(self):
        self.start()
        for _ in range(2):
            self.collect({"exit_code": 1, "output": "timed out"})
        output = self.call("memory_gate.py")
        self.assertEqual(output["decision"], "block")
        self.assertIn("CURRENT", output["reason"])
        self.assertIn("重复失败", output["reason"])
        self.assertEqual(self.call("memory_gate.py", stop_hook_active=True), {"continue": True})
        self.assertEqual(list(Path(self.temp.name).rglob("*.json")), [])

    def test_strong_failure_prompts_audit(self):
        self.start()
        self.collect({"exit_code": 1, "output": "ModuleNotFoundError"})
        output = self.call("memory_gate.py")
        self.assertEqual(output["decision"], "block")
        self.assertIn("依赖或环境", output["reason"])

    def test_missing_state_degrades_visibly(self):
        output = self.call("memory_gate.py")
        self.assertEqual(output["decision"], "block")
        self.assertIn("状态缺失", output["reason"])

    def test_missing_root_degrades_visibly(self):
        output = self.call("memory_router.py", cwd=self.temp.name)
        self.assertTrue(output["continue"])
        self.assertIn("未定位", output["systemMessage"])

    def test_continuation_never_blocks(self):
        self.start()
        self.assertEqual(self.call("memory_gate.py", stop_hook_active=True), {"continue": True})

    @unittest.skipUnless(os.name == "nt", "项目配置为 Windows 命令")
    def test_configured_command_runs_from_subdirectory(self):
        config = json.loads((ROOT / ".codex/hooks.json").read_text(encoding="utf-8"))
        command = config["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"]
        result = subprocess.run(command, input=json.dumps(dict(self.payload, prompt="优化记忆")),
                                capture_output=True, encoding="utf-8", env=self.env,
                                cwd=ROOT / "memory", timeout=10, check=True)
        self.assertIn("hookSpecificOutput", json.loads(result.stdout))

    def test_unreadable_memory_degrades_visibly(self):
        root = Path(self.temp.name) / "project"
        (root / "memory").mkdir(parents=True)
        (root / "AGENTS.md").write_text("test", encoding="utf-8")
        output = self.call("memory_router.py", cwd=str(root), prompt="记忆")
        self.assertTrue(output["continue"])
        self.assertIn("读取失败", output["systemMessage"])

    def test_state_does_not_store_user_prompt_or_workspace(self):
        self.start(prompt="不要存储这个私密提示")
        state = json.loads((Path(self.temp.name) / "test/one.json").read_text(encoding="utf-8"))
        self.assertEqual(state, {"root": str(ROOT)})


if __name__ == "__main__":
    unittest.main()
