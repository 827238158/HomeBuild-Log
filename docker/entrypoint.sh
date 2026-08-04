#!/bin/sh
set -eu

# 数据库迁移失败时立即退出，避免应用在不完整结构上运行。
python -m alembic -c /app/backend/alembic.ini upgrade head

exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log
