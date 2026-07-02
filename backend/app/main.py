from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.analytics import router as analytics_router
from app.api.audit import router as audit_router
from app.api.auth import router as auth_router
from app.api.domain import router as domain_router
from app.api.extractions import router as extractions_router
from app.api.health import router as health_router
from app.api.sources import router as sources_router
from app.api.views import router as views_router
from app.core.config import SecretsConfig
from app.core.paths import StoragePaths, ensure_storage_directories, get_storage_paths
from app.db import create_database_engine
from app.health import HealthChecker, RuntimeHealthChecker

# 无需认证即可访问的路径前缀
_PUBLIC_PREFIXES = ("/api/v1/health", "/api/v1/auth", "/openapi.json", "/docs", "/redoc")


class _AuthMiddleware(BaseHTTPMiddleware):
    """全局认证中间件：拦截 API 请求，验证 Bearer Token。"""

    async def dispatch(self, request: Request, call_next):
        # 跳过公开路径
        path = request.url.path
        if any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES):
            return await call_next(request)

        # 只拦截 API 路径；静态文件、根路径等放行
        if not path.startswith("/api/"):
            return await call_next(request)

        from app.auth import InvalidTokenError, TokenExpiredError, decode_token

        secrets: SecretsConfig = request.app.state.secrets
        auth_header = request.headers.get("Authorization", "")

        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "请先登录。", "code": "UNAUTHORIZED", "retryable": False},
            )

        token = auth_header[7:]
        try:
            decode_token(token, secrets)
        except TokenExpiredError as exc:
            return JSONResponse(
                status_code=401,
                content={"detail": str(exc), "code": "TOKEN_EXPIRED", "retryable": False},
            )
        except InvalidTokenError as exc:
            return JSONResponse(
                status_code=401,
                content={"detail": str(exc), "code": "INVALID_TOKEN", "retryable": False},
            )

        return await call_next(request)


def create_app(
    *,
    storage_paths: StoragePaths | None = None,
    health_checker: HealthChecker | None = None,
    secrets: SecretsConfig | None = None,
) -> FastAPI:
    paths = storage_paths or get_storage_paths()
    secrets_config = secrets or SecretsConfig(paths.config)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 启动时只初始化基础目录；数据库结构始终由 Alembic 管理。
        ensure_storage_directories(paths)
        secrets_config.ensure_initialized()
        engine = create_database_engine(paths.database_file)
        app.state.secrets = secrets_config
        app.state.health_checker = health_checker or RuntimeHealthChecker(engine, paths)
        app.state.engine = engine
        app.state.storage_paths = paths
        # 共享连接池由应用生命周期统一释放；测试可替换 transport/client。
        # 不继承系统代理，避免缺少可选 SOCKS 依赖时阻断本地服务启动。
        app.state.ai_http_client = httpx.Client(trust_env=False)
        try:
            yield
        finally:
            app.state.ai_http_client.close()
            engine.dispose()

    application = FastAPI(title="HomeBuild Log API", version="0.1.0", lifespan=lifespan)
    application.add_middleware(_AuthMiddleware)
    application.include_router(health_router, prefix="/api/v1")
    application.include_router(auth_router, prefix="/api/v1")
    application.include_router(sources_router, prefix="/api/v1")
    application.include_router(audit_router, prefix="/api/v1")
    # 固定路径的分析接口必须先于 /records/{record_id} 注册。
    application.include_router(analytics_router, prefix="/api/v1")
    application.include_router(domain_router, prefix="/api/v1")
    application.include_router(extractions_router, prefix="/api/v1")
    application.include_router(views_router, prefix="/api/v1")
    return application


app = create_app()
