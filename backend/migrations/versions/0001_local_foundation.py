"""建立本地数据库迁移基线。

Revision ID: 0001_local_foundation
Revises:
Create Date: 2026-06-28
"""

from collections.abc import Sequence

revision: str = "0001_local_foundation"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 首个骨架不提前创建业务表；Alembic 版本表用于证明迁移链可运行。
    pass


def downgrade() -> None:
    pass
