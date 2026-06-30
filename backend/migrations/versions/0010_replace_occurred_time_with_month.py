"""replace record occurrence datetime and precision with a calendar month

Revision ID: 0010_occurred_month
Revises: 0009_add_source_maintenance
Create Date: 2026-06-30
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from alembic import op

revision: str = "0010_occurred_month"
down_revision: str | None = "0009_add_source_maintenance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BEIJING = ZoneInfo("Asia/Shanghai")


def _to_month(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip()
        if len(text) == 7:
            return text
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    # 历史 SQLite 时间为无偏移 UTC，转年月时必须先恢复时区。
    if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(BEIJING).strftime("%Y-%m")


def _month_start_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    year, month = (int(part) for part in value.split("-", 1))
    return datetime(year, month, 1, tzinfo=BEIJING).astimezone(UTC).replace(tzinfo=None)


def _migrate_candidate_payloads(*, downgrade: bool = False) -> None:
    connection = op.get_bind()
    bundles = sa.table(
        "candidate_bundles",
        sa.column("id", sa.String()),
        sa.column("bundle_json", sa.JSON()),
    )
    for bundle_id, content in connection.execute(
        sa.select(bundles.c.id, bundles.c.bundle_json)
    ):
        changed = False
        for candidate in (content or {}).get("suggestions", []):
            payload = candidate.get("payload")
            if not isinstance(payload, dict):
                continue
            if downgrade:
                month = payload.pop("occurred_month", None)
                payload["occurred_at"] = (
                    f"{month}-01T00:00:00+08:00" if month else None
                )
                payload["time_precision"] = "month" if month else "unknown"
            else:
                payload["occurred_month"] = _to_month(payload.pop("occurred_at", None))
                payload.pop("time_precision", None)
            changed = True
        if changed:
            connection.execute(
                bundles.update()
                .where(bundles.c.id == bundle_id)
                .values(bundle_json=content)
            )


def upgrade() -> None:
    with op.batch_alter_table("records") as batch:
        batch.add_column(sa.Column("occurred_month", sa.String(7), nullable=True))

    connection = op.get_bind()
    records = sa.table(
        "records",
        sa.column("id", sa.String()),
        sa.column("occurred_at", sa.DateTime()),
        sa.column("occurred_month", sa.String(7)),
    )
    for record_id, occurred_at in connection.execute(
        sa.select(records.c.id, records.c.occurred_at)
    ):
        connection.execute(
            records.update()
            .where(records.c.id == record_id)
            .values(occurred_month=_to_month(occurred_at))
        )

    _migrate_candidate_payloads()
    with op.batch_alter_table("records") as batch:
        batch.drop_column("time_precision")
        batch.drop_column("occurred_at")


def downgrade() -> None:
    with op.batch_alter_table("records") as batch:
        batch.add_column(sa.Column("occurred_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column(
                "time_precision",
                sa.String(32),
                nullable=False,
                server_default="unknown",
            )
        )

    connection = op.get_bind()
    records = sa.table(
        "records",
        sa.column("id", sa.String()),
        sa.column("occurred_month", sa.String(7)),
        sa.column("occurred_at", sa.DateTime()),
        sa.column("time_precision", sa.String(32)),
    )
    for record_id, month in connection.execute(
        sa.select(records.c.id, records.c.occurred_month)
    ):
        connection.execute(
            records.update()
            .where(records.c.id == record_id)
            .values(
                occurred_at=_month_start_utc(month),
                time_precision="month" if month else "unknown",
            )
        )

    _migrate_candidate_payloads(downgrade=True)
    with op.batch_alter_table("records") as batch:
        batch.drop_column("occurred_month")
