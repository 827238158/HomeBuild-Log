#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 sudo ./upgrade.sh <新镜像标签> 运行。" >&2
    exit 1
fi
if [ "$#" -ne 1 ]; then
    echo "用法：sudo ./upgrade.sh homebuild-log:版本标签" >&2
    exit 1
fi

cd "$(dirname "$0")"
new_image=$1
old_image=$(sed -n 's/^HOMEBUILD_IMAGE=//p' .env | head -n 1)
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_directory="$PWD/.deployment-backups"
backup_path="$backup_directory/local-data-$timestamp.tar.gz"

sha256sum --check SHA256SUMS
image_archive=$(awk '{print $2}' SHA256SUMS | sed 's/^\*//' | head -n 1)
mkdir -p "$backup_directory"
chmod 700 "$backup_directory"

# 停止写入后再备份 SQLite 与附件，保证升级前副本一致。
docker compose --env-file .env down
tar -czf "$backup_path" .local-data
docker load --input "$image_archive"
sed -i "s|^HOMEBUILD_IMAGE=.*|HOMEBUILD_IMAGE=$new_image|" .env
printf 'previous_image=%s\nbackup_path=%s\n' "$old_image" "$backup_path" > .last-upgrade
chmod 600 .last-upgrade

if ! docker compose --env-file .env up --detach || ! ./verify.sh; then
    echo "升级未通过，请执行 sudo ./rollback.sh 回退。" >&2
    exit 1
fi

echo "升级完成；迁移前备份：$backup_path"
