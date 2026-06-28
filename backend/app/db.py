from __future__ import annotations

from pathlib import Path

from sqlalchemy import URL, create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    """后续领域模型共享的声明式基类。"""


def database_url(database_file: Path) -> str:
    # URL.create 可正确处理 Windows 盘符、空格和中文目录。
    return URL.create("sqlite+pysqlite", database=str(database_file.resolve())).render_as_string(
        hide_password=False
    )


def create_database_engine(database_file: Path) -> Engine:
    return create_engine(database_url(database_file))


def create_session_factory(engine: Engine) -> sessionmaker:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

