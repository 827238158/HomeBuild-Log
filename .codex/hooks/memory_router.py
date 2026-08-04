# -*- coding: utf-8 -*-
"""UserPromptSubmit Hook：只向 Codex 注入与当前任务相关的坑位和历史。"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass

from memory_hook_common import (
    find_project_root,
    memory_hashes,
    read_payload,
    read_utf8_checked,
    workspace_digest,
    write_state,
)


MAX_SECTIONS = 3
MAX_LOG_ROWS = 3
MAX_CONTEXT_CHARS = 5500


@dataclass(frozen=True)
class Category:
    section: str
    keywords: tuple[str, ...]
    log_keywords: tuple[str, ...]
    route_hint: str = ""


CATEGORIES = (
    Category(
        "文档与记忆",
        ("文档", "记忆", "memory", "agents.md", "pitfall", "log", "hook", "codex"),
        ("文档", "记忆", "agent", "hook"),
    ),
    Category(
        "编码与中文",
        ("乱码", "编码", "utf-8", "utf8", "csv", "markdown", "中文"),
        ("编码", "乱码", "utf"),
    ),
    Category(
        "Windows 与 PowerShell",
        ("windows", "powershell", "cmd", "路径", "空格", "进程", "process"),
        ("windows", "powershell", "cmd"),
    ),
    Category(
        "Python 与 Conda",
        ("python", "conda", "pip", "pytest", "fastapi", "ruff", "缺包", "module"),
        ("python", "conda", "pip", "pytest", "fastapi"),
    ),
    Category(
        "数据库迁移",
        ("迁移", "migration", "alembic", "sqlite", "database", "schema", "revision"),
        ("迁移", "alembic", "sqlite", "schema", "revision"),
    ),
    Category(
        "业务记录与 AI 分析",
        (
            "调研", "正式记录", "候选记录", "记录分类", "分类覆盖", "人工修改",
            "手动修改", "ai分析", "ai 分析", "抽取", "extraction", "record kind",
            "record_type", "suggestion",
        ),
        ("正式记录", "候选", "分类", "抽取", "调研"),
        "优先查找 PITFALLS 中可能存在的同名章节及相关 LOG；实现定位需继续搜索候选确认、"
        "正式记录写入、分类字段转换和对应测试，避免只检查表单显示状态。",
    ),
    Category(
        "前端 UI",
        ("前端", "ui", "react", "typescript", "vite", "css", "样式", "图表", "echarts", "响应式"),
        ("前端", "ui", "react", "vite", "可视化"),
    ),
    Category(
        "Docker",
        ("docker", "ubuntu", "compose", "容器", "镜像", "部署", "mihomo", "代理", "buildx"),
        ("docker", "ubuntu", "容器", "镜像", "部署", "mihomo"),
    ),
)


def _normalized(text: str) -> str:
    return text.casefold()


def match_categories(prompt: str) -> list[Category]:
    normalized = _normalized(prompt)
    scored: list[tuple[int, int, Category]] = []
    for index, category in enumerate(CATEGORIES):
        score = sum(1 for keyword in category.keywords if keyword.casefold() in normalized)
        if score:
            scored.append((score, -index, category))
    scored.sort(reverse=True, key=lambda item: (item[0], item[1]))
    return [category for _, _, category in scored[:MAX_SECTIONS]]


def parse_sections(markdown: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in markdown.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = [line]
        elif current is not None:
            sections[current].append(line)
    return {name: "\n".join(lines).strip() for name, lines in sections.items()}


def matching_log_rows(markdown: str, categories: Iterable[Category]) -> list[str]:
    keywords = {
        keyword.casefold()
        for category in categories
        for keyword in category.log_keywords
    }
    rows = []
    for line in markdown.splitlines():
        normalized = line.casefold()
        if line.startswith("| 20") and any(keyword in normalized for keyword in keywords):
            rows.append(line)
    return rows[-MAX_LOG_ROWS:]


def build_context(prompt: str, pitfalls_markdown: str, log_markdown: str) -> str:
    categories = match_categories(prompt)
    if not categories:
        return ""

    sections = parse_sections(pitfalls_markdown)
    blocks = [sections[category.section] for category in categories if category.section in sections]
    route_hints = [
        f"- **{category.section}**：{category.route_hint}"
        for category in categories
        if category.route_hint
    ]
    if route_hints:
        blocks.append("## 本轮检索提示\n" + "\n".join(route_hints))
    log_rows = matching_log_rows(log_markdown, categories)
    if log_rows:
        blocks.append("## 相关重要历史\n" + "\n".join(log_rows))
    if not blocks:
        return ""

    context = (
        "【项目记忆定向检索】\n"
        "以下内容是按当前提示词命中的历史线索，不代替当前代码与环境验证；"
        "当前用户指令优先。\n\n"
        + "\n\n".join(blocks)
    )
    return context[:MAX_CONTEXT_CHARS]


def main() -> None:
    payload = read_payload()
    root = find_project_root(payload.get("cwd"))
    prompt = str(payload.get("prompt") or "")
    if root is None:
        print(json.dumps({
            "continue": True,
            "systemMessage": "项目记忆 Hook 未定位到项目根目录；本轮请由 AI 手工执行记忆检索与结束审计。",
        }, ensure_ascii=False))
        return

    # 关键步骤：在任务开始时记录工作区与记忆文件基线，供 Stop Hook 对比。
    baseline_digest = workspace_digest(root)
    state_ok = write_state(payload, {
        "root": str(root),
        "prompt": prompt,
        "workspace_digest": baseline_digest,
        "memory_hashes": memory_hashes(root),
    })

    pitfalls, pitfalls_ok = read_utf8_checked(root / "memory" / "PITFALLS.md")
    log, log_ok = read_utf8_checked(root / "memory" / "LOG.md")
    warnings = []
    if baseline_digest is None:
        warnings.append("无法建立 Git 工作区基线")
    if not state_ok:
        warnings.append("无法保存本轮记忆审计状态")
    if not pitfalls_ok or not log_ok:
        warnings.append("PITFALLS 或 LOG 读取失败")

    context = build_context(
        prompt,
        pitfalls,
        log,
    )
    output: dict[str, object] = {"continue": True}
    if warnings:
        output["systemMessage"] = (
            "项目记忆 Hook 本轮降级：" + "；".join(warnings) + "。请由 AI 手工补做相关检查。"
        )
    if context:
        output["hookSpecificOutput"] = {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    print(json.dumps(output, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
