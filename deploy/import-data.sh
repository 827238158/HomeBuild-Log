#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "请使用 sudo ./import-data.sh <数据包.tar.gz> 运行。" >&2
    exit 1
fi
if [ "$#" -ne 1 ]; then
    echo "用法：sudo ./import-data.sh /路径/homebuild-data-时间.tar.gz" >&2
    exit 1
fi

cd "$(dirname "$0")"
archive=$(realpath "$1")
checksum_file="$archive.sha256"
if [ ! -f "$archive" ] || [ ! -f "$checksum_file" ]; then
    echo "数据包或对应的 .sha256 文件不存在。" >&2
    exit 1
fi
if [ -d .local-data ] && [ -n "$(find .local-data -mindepth 1 -print -quit)" ]; then
    echo ".local-data 已包含内容，为避免覆盖现有数据已拒绝导入。" >&2
    exit 1
fi

checksum_directory=$(dirname "$archive")
(cd "$checksum_directory" && sha256sum --check "$(basename "$checksum_file")")
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT INT TERM
tar -xzf "$archive" -C "$temporary"

data_root="$temporary/homebuild-data"
if [ ! -f "$data_root/MANIFEST.sha256" ]; then
    echo "数据包缺少 MANIFEST.sha256。" >&2
    exit 1
fi
(cd "$data_root" && sha256sum --check MANIFEST.sha256)

rm -rf -- .local-data
mv "$data_root" .local-data
rm -f .local-data/MANIFEST.sha256
chown -R 10001:10001 .local-data
chmod 0750 .local-data
echo "真实数据已校验并导入，随后可运行 sudo ./deploy.sh。"
