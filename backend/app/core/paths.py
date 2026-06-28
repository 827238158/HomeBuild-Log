from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class StoragePaths:
    """集中定义项目内的运行数据位置，避免数据散落到系统盘。"""

    root: Path
    database_directory: Path
    database_file: Path
    attachment_originals: Path
    attachment_derived: Path
    models: Path
    backups: Path
    exports: Path

    @property
    def directories(self) -> tuple[Path, ...]:
        return (
            self.database_directory,
            self.attachment_originals,
            self.attachment_derived,
            self.models,
            self.backups,
            self.exports,
        )


def build_storage_paths(root: Path) -> StoragePaths:
    resolved_root = root.resolve()
    database_directory = resolved_root / "db"
    return StoragePaths(
        root=resolved_root,
        database_directory=database_directory,
        database_file=database_directory / "homebuild-log.sqlite3",
        attachment_originals=resolved_root / "attachments" / "originals",
        attachment_derived=resolved_root / "attachments" / "derived",
        models=resolved_root / "models",
        backups=resolved_root / "backups",
        exports=resolved_root / "exports",
    )


def get_storage_paths() -> StoragePaths:
    return build_storage_paths(PROJECT_ROOT / ".local-data")


def ensure_storage_directories(paths: StoragePaths) -> None:
    # 原件与派生文件分区，后续清理派生文件时不会误删原始证据。
    for directory in paths.directories:
        directory.mkdir(parents=True, exist_ok=True)
