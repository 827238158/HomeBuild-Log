from __future__ import annotations

from pathlib import Path

from sqlalchemy import URL, create_engine, event
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
    engine = create_engine(database_url(database_file))

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:
        # SQLite 默认不执行外键约束；领域关联必须在每次连接时显式开启。
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def create_session_factory(engine: Engine) -> sessionmaker:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
