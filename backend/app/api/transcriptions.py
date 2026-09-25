from __future__ import annotations

import base64
import io
import time
import wave
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, status

from app.auth import CurrentUser, require_user

router = APIRouter(tags=["transcriptions"])
User = Annotated[CurrentUser, Depends(require_user)]

MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_AUDIO_SECONDS = 180
TRANSCRIPTION_TIMEOUT_SECONDS = 120.0
TRANSCRIPTION_MODEL = "mimo-v2.6-pro"
TRANSCRIPTION_PROMPT = (
    "请忠实转写这段录音，只输出转写文字。不要总结、润色、补全或推断；"
    "金额、尺寸、日期、人名等听不清的地方不要猜测。"
)


def _validate_audio(content: bytes) -> None:
    if not content or len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="录音不能为空，且不能超过 8 MB。")
    try:
        with wave.open(io.BytesIO(content), "rb") as audio:
            # 浏览器录音统一编码为单声道 16 kHz、16 位 PCM WAV。
            if (
                audio.getnchannels() != 1
                or audio.getsampwidth() != 2
                or audio.getframerate() != 16_000
                or audio.getcomptype() != "NONE"
            ):
                raise ValueError("不支持的 WAV 参数")
            frames = audio.getnframes()
            if frames == 0:
                raise ValueError("空音频")
            if frames > MAX_AUDIO_SECONDS * audio.getframerate():
                raise HTTPException(status_code=413, detail="录音不能超过 3 分钟。")
            if len(audio.readframes(frames)) != frames * audio.getsampwidth():
                raise ValueError("音频数据不完整")
    except (wave.Error, EOFError, ValueError) as exc:
        raise HTTPException(status_code=415, detail="录音格式无效，请重新录制。") from exc


@router.post("/transcriptions")
def transcribe_audio(request: Request, file: UploadFile, user: User) -> dict[str, str | int]:
    if file.content_type not in {"audio/wav", "audio/wave", "audio/x-wav"}:
        raise HTTPException(status_code=415, detail="仅支持 WAV 录音。")

    # 限量读取，避免不受控的上传占用内存；不将音频写入持久化目录。
    content = file.file.read(MAX_AUDIO_BYTES + 1)
    _validate_audio(content)

    config = request.app.state.secrets.get_ai_config()
    provider = config.providers.get("mimo")
    if (
        not config.enabled
        or provider is None
        or not provider.api_key
        or provider.model != TRANSCRIPTION_MODEL
    ):
        raise HTTPException(status_code=503, detail="小米 MiMo V2.6 Pro 转写尚未配置。")

    started = time.monotonic()
    headers = (
        {"api-key": provider.api_key}
        if provider.auth_style == "api-key"
        else {"Authorization": f"Bearer {provider.api_key}"}
    )
    payload = {
        "model": TRANSCRIPTION_MODEL,
        "messages": [
            {"role": "system", "content": TRANSCRIPTION_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": (
                                "data:audio/wav;base64,"
                                + base64.b64encode(content).decode("ascii")
                            )
                        },
                    },
                    {"type": "text", "text": TRANSCRIPTION_PROMPT},
                ],
            },
        ],
        "stream": False,
        # 转写不需要推理过程；避免默认深度思考耗尽输出预算后返回空正文。
        "thinking": {"type": "disabled"},
        "max_completion_tokens": 2048,
    }
    try:
        response = request.app.state.ai_http_client.post(
            f"{provider.base_url}/chat/completions",
            headers=headers,
            json=payload,
            timeout=httpx.Timeout(TRANSCRIPTION_TIMEOUT_SECONDS, connect=5.0, pool=5.0),
        )
        response.raise_for_status()
        text = response.json()["choices"][0]["message"]["content"]
        if not isinstance(text, str) or not text.strip():
            raise ValueError("empty transcription")
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="语音转写超时，请重试。") from exc
    except httpx.HTTPStatusError as exc:
        code = status.HTTP_503_SERVICE_UNAVAILABLE if exc.response.status_code == 429 else 502
        raise HTTPException(status_code=code, detail="小米语音转写暂不可用，请稍后重试。") from exc
    except (httpx.RequestError, ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="语音转写没有返回有效文字，请重试。") from exc

    return {"text": text.strip(), "duration_ms": round((time.monotonic() - started) * 1000)}
