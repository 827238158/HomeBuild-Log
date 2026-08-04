#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 sudo ./rollback.sh 运行。" >&2
    exit 1
fi

cd "$(dirname "$0")"
if [ ! -f .last-upgrade ]; then
    echo "缺少 .last-upgrade，无法确定旧镜像和备份。" >&2
    exit 1
fi

previous_image=$(sed -n 's/^previous_image=//p' .last-upgrade)
backup_path=$(sed -n 's/^backup_path=//p' .last-upgrade)
case "$backup_path" in
    "$PWD/.deployment-backups/"*) ;;
    *) echo "备份路径不在受控目录内，拒绝回退。" >&2; exit 1 ;;
esac
if [ ! -f "$backup_path" ]; then
    echo "未找到迁移前备份：$backup_path" >&2
    exit 1
fi

echo "风险：回退会停止服务，并用迁移前备份替换当前 .local-data。"
printf '请输入 RESTORE 确认：'
read -r confirmation
if [ "$confirmation" != "RESTORE" ]; then
    echo "已取消。"
    exit 1
fi

failed_path="$PWD/.deployment-backups/failed-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
docker compose --env-file .env down
tar -czf "$failed_path" .local-data
rm -rf -- "$PWD/.local-data"
tar -xzf "$backup_path" -C "$PWD"
chown -R 10001:10001 .local-data
chmod 0750 .local-data
sed -i "s|^HOMEBUILD_IMAGE=.*|HOMEBUILD_IMAGE=$previous_image|" .env
docker compose --env-file .env up --detach
./verify.sh
echo "已回退；失败版本数据另存为：$failed_path"
