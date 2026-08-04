#!/bin/sh
set -eu

cd "$(dirname "$0")"
attempt=0
while [ "$attempt" -lt 40 ]; do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' homebuild-log-app-1 2>/dev/null || true)
    if [ "$status" = "healthy" ]; then
        docker compose --env-file .env exec -T app python -c \
            "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3).read().decode())"
        echo "HomeBuild Log 已通过容器健康检查。"
        exit 0
    fi
    if [ "$status" = "unhealthy" ]; then
        docker compose --env-file .env logs --tail 100 app
        echo "容器健康检查失败。" >&2
        exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
done

docker compose --env-file .env logs --tail 100 app
echo "等待容器健康状态超时。" >&2
exit 1
