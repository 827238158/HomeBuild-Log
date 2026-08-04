# -*- coding: utf-8 -*-
"""PostToolUse Hook：只保存可用于结束审计的匿名高信号失败摘要。"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from memory_hook_common import read_payload, write_signal


FAILURE_PATTERNS = (
    re.compile(r"exit code:\s*[1-9]\d*", re.IGNORECASE),
    re.compile(r"exit_?code\s*[\n:= ]+\s*[1-9]\d*", re.IGNORECASE),
    re.compile(r"\"(?:isError|is_error)\"\s*:\s*true", re.IGNORECASE),
    re.compile(r"script failed|traceback|timed? out|permission denied|access is denied", re.IGNORECASE),
)
SUCCESS_PATTERN = re.compile(r"exit code:\s*0", re.IGNORECASE)
MARKER_PATTERNS = {
    "依赖或环境": (
        "modulenotfounderror", "no module named", "dependency conflict", "环境冲突",
    ),
    "编码": (
        "unicodedecodeerror", "unicodeencodeerror", "codec can't decode", "乱码",
    ),
    "数据库迁移": (
        "alembic", "migration failed", "schema migration failed", "迁移失败",
    ),
    "数据完整性": (
        "database disk image is malformed", "checksum mismatch", "disk full", "数据损坏",
    ),
    "权限": ("permission denied", "access is denied", "沙箱拦截"),
    "超时": ("timeout", "timed out", "超时"),
}
STRONG_MARKERS = {"依赖或环境", "编码", "数据库迁移", "数据完整性"}


def compact_text(value: Any, *, limit: int = 12_000) -> str:
    """有界提取工具响应文本，避免复制或持久化完整日志。"""
    parts: list[str] = []
    size = 0

    def visit(item: Any) -> None:
        nonlocal size
        if size >= limit:
            return
        if isinstance(item, str):
            chunk = item[: limit - size]
            parts.append(chunk)
            size += len(chunk)
        elif isinstance(item, dict):
            for key, child in item.items():
                visit(str(key))
                visit(child)
                if size >= limit:
                    break
        elif isinstance(item, (list, tuple)):
            for child in item:
                visit(child)
                if size >= limit:
                    break
        elif item is not None:
            visit(str(item))

    visit(value)
    return "\n".join(parts)


def classify_tool_event(payload: dict[str, Any]) -> dict[str, Any] | None:
    response_text = compact_text(payload.get("tool_response"))
    if (
        not response_text
        or SUCCESS_PATTERN.search(response_text)
        or not any(pattern.search(response_text) for pattern in FAILURE_PATTERNS)
    ):
        return None

    normalized = response_text.casefold()
    markers = [
        name
        for name, patterns in MARKER_PATTERNS.items()
        if any(pattern.casefold() in normalized for pattern in patterns)
    ]
    # 指纹只用于识别同一操作是否重复失败，不保存命令、参数或错误原文。
    fingerprint_source = "\n".join((
        str(payload.get("tool_name") or ""),
        compact_text(payload.get("tool_input"), limit=4_000),
    ))
    fingerprint = hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()[:20]
    return {
        "kind": "tool_failure",
        "fingerprint": fingerprint,
        "markers": markers,
        "strong": any(marker in STRONG_MARKERS for marker in markers),
    }


def main() -> None:
    payload = read_payload()
    signal = classify_tool_event(payload)
    if signal is None:
        print("{}")
        return
    if write_signal(payload, signal):
        print("{}")
        return
    print(json.dumps({
        "systemMessage": "项目记忆 Hook 无法保存高信号失败摘要；结束前请由 AI 手工审计本轮踩坑。",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
