from __future__ import annotations

import argparse
import hashlib
import shutil
import sqlite3
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_runtime_data(source_root: Path, export_root: Path) -> None:
    """复制运行数据；SQLite 使用在线备份 API 获得一致快照。"""
    database_source = source_root / "db" / "homebuild-log.sqlite3"
    if not database_source.is_file():
        raise FileNotFoundError(f"未找到数据库：{database_source}")

    for item in source_root.iterdir():
        if item.name in {"db", "runtime"}:
            continue
        destination = export_root / item.name
        if item.is_dir():
            shutil.copytree(item, destination)
        elif item.is_file():
            shutil.copy2(item, destination)

    database_destination = export_root / "db" / database_source.name
    database_destination.parent.mkdir(parents=True)
    with sqlite3.connect(database_source) as source_connection:
        integrity = source_connection.execute("PRAGMA integrity_check").fetchone()
        if integrity != ("ok",):
            raise RuntimeError(f"SQLite 完整性检查失败：{integrity}")
        with sqlite3.connect(database_destination) as destination_connection:
            source_connection.backup(destination_connection)


def write_manifest(export_root: Path) -> None:
    entries: list[str] = []
    for path in sorted(item for item in export_root.rglob("*") if item.is_file()):
        if path.name == "MANIFEST.sha256":
            continue
        relative = path.relative_to(export_root).as_posix()
        entries.append(f"{sha256_file(path)}  {relative}")
    (export_root / "MANIFEST.sha256").write_text("\n".join(entries) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="导出 HomeBuild Log 一致性数据迁移包")
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    args = parser.parse_args()

    project_root = args.project_root.resolve()
    source_root = project_root / ".local-data"
    output_directory = args.output_directory.resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    archive_path = output_directory / f"homebuild-data-{timestamp}.tar.gz"

    with tempfile.TemporaryDirectory(prefix="homebuild-export-") as temporary:
        export_root = Path(temporary) / "homebuild-data"
        export_root.mkdir()
        copy_runtime_data(source_root, export_root)
        write_manifest(export_root)
        with tarfile.open(archive_path, "w:gz") as archive:
            archive.add(export_root, arcname=export_root.name)

    checksum_path = archive_path.with_suffix(archive_path.suffix + ".sha256")
    checksum_path.write_text(
        f"{sha256_file(archive_path)}  {archive_path.name}\n", encoding="utf-8"
    )
    attachment_count = sum(
        1 for item in (source_root / "attachments" / "originals").glob("*") if item.is_file()
    )
    print(f"数据包：{archive_path}")
    print(f"校验文件：{checksum_path}")
    print(f"原始附件数量：{attachment_count}")
    print("警告：数据包包含配置、密钥和个人附件，请安全保管。")


if __name__ == "__main__":
    main()
