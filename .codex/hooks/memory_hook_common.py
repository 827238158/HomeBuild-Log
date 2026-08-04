# -*- coding: utf-8 -*-
"""HomeBuild Log 项目记忆 Hook 的共用工具。"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any


MEMORY_FILES = {
    "current": "memory/CURRENT.md",
    "log": "memory/LOG.md",
    "pitfalls": "memory/PITFALLS.md",
    "runbook": "memory/RUNBOOK.md",
    "design": "DESIGN.md",
}


def read_payload() -> dict[str, Any]:
    """读取 Codex Hook 的 stdin JSON；格式异常时不阻断主流程。"""
    raw_bytes = sys.stdin.buffer.read()
    if not raw_bytes.strip():
        return {}
    # 关键步骤：协议优先按 UTF-8 解码，同时兼容 Windows 本地手工管道测试的 GB18030。
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            payload = json.loads(raw_bytes.decode(encoding))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        return payload if isinstance(payload, dict) else {}
    return {}


def find_project_root(cwd: object) -> Path | None:
    """从 Hook 传入的 cwd 向上定位轻量记忆项目根目录。"""
    if not cwd:
        return None
    candidate = Path(str(cwd)).expanduser()
    if candidate.is_file():
        candidate = candidate.parent
    try:
        current = candidate.resolve()
    except OSError:
        return None
    while True:
        if (current / "AGENTS.md").is_file() and (current / "memory").is_dir():
            return current
        if current.parent == current:
            return None
        current = current.parent


def read_utf8(path: Path, *, limit: int | None = None) -> str:
    text, _ = read_utf8_checked(path, limit=limit)
    return text


def read_utf8_checked(path: Path, *, limit: int | None = None) -> tuple[str, bool]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return "", False
    return (text if limit is None else text[-limit:]), True


def hash_file(path: Path) -> str | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    return hashlib.sha256(data).hexdigest()


def memory_hashes(root: Path) -> dict[str, str | None]:
    return {name: hash_file(root / relative) for name, relative in MEMORY_FILES.items()}


def _run_git(root: Path, *args: str) -> bytes | None:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=root,
            capture_output=True,
            check=False,
            timeout=8,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return completed.stdout if completed.returncode == 0 else None


def workspace_digest(root: Path) -> str | None:
    """同时覆盖已跟踪差异和未跟踪文件，用于识别本轮是否真正改动工作区。"""
    diff = _run_git(root, "diff", "--binary", "HEAD", "--")
    untracked = _run_git(root, "ls-files", "--others", "--exclude-standard", "-z")
    if diff is None or untracked is None:
        return None

    digest = hashlib.sha256()
    digest.update(diff)
    for raw_name in sorted(name for name in untracked.split(b"\0") if name):
        try:
            relative = raw_name.decode("utf-8", errors="surrogateescape")
            path = root / relative
            data = path.read_bytes() if path.is_file() else b""
        except OSError:
            data = b""
        digest.update(raw_name)
        digest.update(b"\0")
        digest.update(hashlib.sha256(data).digest())
    return digest.hexdigest()


def _safe_identifier(value: object, fallback: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "")).strip("._")
    return normalized[:120] or fallback


def state_path(payload: dict[str, Any]) -> Path:
    """状态写入系统临时目录，避免污染 Git 工作区。"""
    configured = os.environ.get("HOMEBUILD_MEMORY_HOOK_STATE_DIR")
    base = Path(configured) if configured else Path(tempfile.gettempdir()) / "homebuild-log-memory-hooks"
    session_id = _safe_identifier(payload.get("session_id"), "session")
    turn_id = _safe_identifier(payload.get("turn_id"), "turn")
    return base / session_id / f"{turn_id}.json"


def signal_dir(payload: dict[str, Any]) -> Path:
    path = state_path(payload)
    return path.parent / f"{path.stem}.signals"


def write_state(payload: dict[str, Any], state: dict[str, Any]) -> bool:
    path = state_path(payload)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return False
    return True


def load_state(payload: dict[str, Any]) -> dict[str, Any] | None:
    path = state_path(payload)
    try:
        state = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    return state if isinstance(state, dict) else None


def write_signal(payload: dict[str, Any], signal: dict[str, Any]) -> bool:
    """每个工具事件独立落一个小文件，避免并行 Hook 相互覆盖。"""
    directory = signal_dir(payload)
    path = directory / f"{uuid.uuid4().hex}.json"
    try:
        directory.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(signal, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return False
    return True


def load_signals(payload: dict[str, Any]) -> list[dict[str, Any]]:
    directory = signal_dir(payload)
    try:
        paths = tuple(directory.glob("*.json"))
    except OSError:
        return []
    signals: list[dict[str, Any]] = []
    for path in paths:
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            signals.append(value)
    return signals


def remove_state(payload: dict[str, Any]) -> None:
    try:
        state_path(payload).unlink(missing_ok=True)
    except OSError:
        pass
    directory = signal_dir(payload)
    try:
        for path in directory.glob("*.json"):
            path.unlink(missing_ok=True)
        directory.rmdir()
    except OSError:
        pass
