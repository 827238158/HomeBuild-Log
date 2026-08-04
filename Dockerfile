# syntax=docker/dockerfile:1.7

FROM node:24.17.0-alpine3.23 AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13.14-slim-bookworm AS runtime

ARG APP_VERSION=4a-20260715
LABEL org.opencontainers.image.title="HomeBuild Log" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN groupadd --gid 10001 homebuild \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin homebuild

WORKDIR /app/backend
COPY backend/requirements.runtime.lock ./requirements.runtime.lock
RUN python -m pip install --no-cache-dir --requirement requirements.runtime.lock

COPY backend/alembic.ini ./alembic.ini
COPY backend/migrations/ ./migrations/
COPY backend/app/ ./app/
COPY --from=frontend-builder /build/frontend/dist/ /app/frontend/dist/
COPY docker/entrypoint.sh /usr/local/bin/homebuild-entrypoint

RUN mkdir -p /app/.local-data \
    && chown -R 10001:10001 /app/.local-data \
    && chmod 0755 /usr/local/bin/homebuild-entrypoint

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3).read()"]

ENTRYPOINT ["/usr/local/bin/homebuild-entrypoint"]
