from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import SecretsConfig

_AUTH_SCHEME = HTTPBearer(auto_error=False)
_TOKEN_EXPIRE_DAYS = 30


class CurrentUser:
    """单用户系统的当前用户信息。"""

    subject: str = "admin"
    authenticated_at: datetime

    def __init__(self, authenticated_at: datetime) -> None:
        self.authenticated_at = authenticated_at


class TokenExpiredError(Exception):
    pass


class InvalidTokenError(Exception):
    pass


def create_access_token(secrets: SecretsConfig) -> str:
    """签发新的访问令牌，有效期 30 天。"""
    now = datetime.now(tz=UTC)
    payload = {
        "sub": "admin",
        "iat": now,
        "exp": now + timedelta(days=_TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, secrets.get_jwt_secret(), algorithm="HS256")


def decode_token(token: str, secrets: SecretsConfig) -> CurrentUser:
    """解码并验证 JWT 令牌，失败时抛出 TokenExpiredError 或 InvalidTokenError。"""
    try:
        payload = jwt.decode(token, secrets.get_jwt_secret(), algorithms=["HS256"])
        iat = payload.get("iat")
        authenticated_at = (
            datetime.fromtimestamp(iat, tz=UTC)
            if iat
            else datetime.now(tz=UTC)
        )
        return CurrentUser(authenticated_at=authenticated_at)
    except jwt.ExpiredSignatureError as err:
        raise TokenExpiredError("登录已过期，请重新登录。") from err
    except jwt.InvalidTokenError as err:
        raise InvalidTokenError("无效的访问令牌，请重新登录。") from err


def require_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_AUTH_SCHEME)],
) -> CurrentUser:
    """FastAPI 路由依赖：验证请求中的 Bearer Token 并返回当前用户。"""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请先登录。",
        )

    secrets: SecretsConfig = request.app.state.secrets
    try:
        return decode_token(credentials.credentials, secrets)
    except TokenExpiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
