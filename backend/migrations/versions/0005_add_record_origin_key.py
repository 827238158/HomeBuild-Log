"""add stable origin key for idempotent local suggestion confirmation

Revision ID: 0005_add_record_origin_key
Revises: 0004_add_domain_records
Create Date: 2026-06-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_add_record_origin_key"
down_revision: str | None = "0004_add_domain_records"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("records") as batch:
        batch.add_column(sa.Column("origin_key", sa.String(200), nullable=True))
        batch.create_unique_constraint(
            "uq_records_project_id_origin_key", ["project_id", "origin_key"]
        )


def downgrade() -> None:
    with op.batch_alter_table("records") as batch:
        batch.drop_constraint("uq_records_project_id_origin_key", type_="unique")
        batch.drop_column("origin_key")
