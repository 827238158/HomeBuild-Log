#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 sudo ./deploy.sh 运行。" >&2
    exit 1
fi

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
    echo "未找到 Docker Engine，请先按 README-UBUNTU.md 安装。" >&2
    exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
    echo "未找到 Docker Compose v2 插件。" >&2
    exit 1
fi
if [ ! -f .env ]; then
    cp .env.example .env
    chmod 600 .env
fi

sha256sum --check SHA256SUMS
image_archive=$(awk '{print $2}' SHA256SUMS | sed 's/^\*//' | head -n 1)
docker load --input "$image_archive"

# 容器固定使用 UID/GID 10001；GNU install 会把纯数字当用户名，因此分步设置数值所有者。
install -d -m 0750 .local-data
chown 10001:10001 .local-data
docker compose --env-file .env up --detach

./verify.sh
