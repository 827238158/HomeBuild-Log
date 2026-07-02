from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import AIProviderConfig

PROMPT_VERSION = "text-extraction-v1"

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "extraction.txt"
SYSTEM_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")


class AICandidate(BaseModel):
    ref: str = Field(min_length=1, max_length=80)
    record_type: Literal[
        "event",
        "ledger",
        "issue",
        "measurement",
        "decision",
        "procurement",
        "research",
    ]
    summary: str = Field(min_length=1, max_length=500)
    evidence: str = Field(min_length=1)
    certainty: Literal["explicit", "inferred", "calculated", "uncertain", "missing"]
    payload: dict[str, Any]
    missing_fields: list[str] = []


class AIRelation(BaseModel):
    from_ref: str
    to_ref: str
    relation_type: Literal[
        "derived_from",
        "relates_to",
        "implements",
        "resolves",
        "pays_for",
        "tracks_delivery",
        "supersedes",
        "blocks",
        "produces",
    ]


class AIExtractionDraft(BaseModel):
    suggestions: list[AICandidate] = []
    relations: list[AIRelation] = []
    warnings: list[str] = []


@dataclass(frozen=True)
class AIAdapterResult:
    draft: AIExtractionDraft
    prompt_text: str
    raw_response: str
    duration_ms: int
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None


class AIAdapterFailure(Exception):
    """携带可安全落库的供应商失败上下文，不包含 API Key。"""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        prompt_text: str,
        raw_response: str | None = None,
        duration_ms: int = 0,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.prompt_text = prompt_text
        self.raw_response = raw_response
        self.duration_ms = duration_ms


class AIAdapter(ABC):
    @abstractmethod
    def extract_from_text(self, text: str, timeout_seconds: float) -> AIAdapterResult:
        """从单条原始文字生成统一候选草稿。"""


class OpenAICompatibleAdapter(AIAdapter):
    def __init__(
        self,
        provider: AIProviderConfig,
        *,
        temperature: float,
        client: httpx.Client,
    ) -> None:
        self.provider = provider
        self.temperature = temperature
        self.client = client

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.provider.auth_style == "api-key":
            headers["api-key"] = self.provider.api_key
        else:
            headers["Authorization"] = f"Bearer {self.provider.api_key}"
        return headers

    def extract_from_text(self, text: str, timeout_seconds: float) -> AIAdapterResult:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ]
        prompt_text = json.dumps(
            {"prompt_version": PROMPT_VERSION, "messages": messages},
            ensure_ascii=False,
        )
        payload: dict[str, Any] = {
            "model": self.provider.model,
            "messages": messages,
            "temperature": self.temperature,
            "stream": False,
            "response_format": {"type": "json_object"},
        }
        if self.provider.name == "deepseek":
            # 结构化提取不需要思考链，关闭后可减少延迟和不必要输出。
            payload["thinking"] = {"type": "disabled"}

        started = time.monotonic()
        raw_response: str | None = None
        try:
            remaining = max(0.1, timeout_seconds)
            timeout = httpx.Timeout(
                remaining,
                connect=min(5.0, remaining),
                pool=min(5.0, remaining),
            )
            response = self.client.post(
                f"{self.provider.base_url}/chat/completions",
                headers=self._headers(),
                json=payload,
                timeout=timeout,
            )
            raw_response = response.text
            response.raise_for_status()
            response_json = response.json()
            content = response_json["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("供应商响应缺少文本 content。")
            cleaned = content.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.removeprefix("```json").removeprefix("```")
                cleaned = cleaned.removesuffix("```").strip()
            draft = AIExtractionDraft.model_validate_json(cleaned)
            usage = response_json.get("usage") or {}
            duration_ms = round((time.monotonic() - started) * 1000)
            return AIAdapterResult(
                draft=draft,
                prompt_text=prompt_text,
                raw_response=raw_response,
                duration_ms=duration_ms,
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                total_tokens=usage.get("total_tokens"),
            )
        except httpx.TimeoutException as exc:
            raise AIAdapterFailure(
                "AI_TIMEOUT",
                "供应商响应超时。",
                prompt_text=prompt_text,
                raw_response=raw_response,
                duration_ms=round((time.monotonic() - started) * 1000),
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise AIAdapterFailure(
                f"AI_HTTP_{exc.response.status_code}",
                f"供应商返回 HTTP {exc.response.status_code}。",
                prompt_text=prompt_text,
                raw_response=raw_response,
                duration_ms=round((time.monotonic() - started) * 1000),
            ) from exc
        except (
            json.JSONDecodeError,
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            ValidationError,
        ) as exc:
            raise AIAdapterFailure(
                "AI_INVALID_RESPONSE",
                "供应商返回内容无法解析为候选结构。",
                prompt_text=prompt_text,
                raw_response=raw_response,
                duration_ms=round((time.monotonic() - started) * 1000),
            ) from exc
