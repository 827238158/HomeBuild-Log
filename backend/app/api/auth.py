from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.auth import create_access_token
from app.core.config import SecretsConfig

router = APIRouter(tags=["auth"], prefix="/auth")


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=LoginResponse)
def login(request: Request, body: LoginRequest) -> LoginResponse:
    secrets: SecretsConfig = request.app.state.secrets
    if not secrets.verify_password(body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="密码错误。",
        )

    token = create_access_token(secrets)
    return LoginResponse(access_token=token)
