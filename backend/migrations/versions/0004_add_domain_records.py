"""add project, shared entities and eight domain record tables

Revision ID: 0004_add_domain_records
Revises: 0003_add_audit
Create Date: 2026-06-28
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0004_add_domain_records"
down_revision: str | None = "0003_add_audit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_PROJECT_ID = "00000000000000000000000000000001"


def _detail(name: str, *columns: sa.Column) -> None:
    op.create_table(
        name,
        sa.Column(
            "record_id",
            sa.String(32),
            sa.ForeignKey("records.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        *columns,
    )


def _named_table(name: str, *columns: sa.Column) -> None:
    op.create_table(
        name,
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        *columns,
    )


def _association(name: str, target: str, target_column: str, *, evidence: bool = False) -> None:
    columns: list[sa.Column] = [
        sa.Column(
            "record_id",
            sa.String(32),
            sa.ForeignKey("records.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            target_column,
            sa.String(32),
            sa.ForeignKey(f"{target}.id"),
            primary_key=True,
        ),
    ]
    if evidence:
        columns.append(sa.Column("evidence_excerpt", sa.Text))
    op.create_table(name, *columns)


def upgrade() -> None:
    now = datetime.now(tz=UTC)
    op.create_table(
        "projects",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    projects = sa.table(
        "projects",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("is_active", sa.Boolean),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        projects,
        [
            {
                "id": DEFAULT_PROJECT_ID,
                "name": "我的装修",
                "is_active": True,
                "created_at": now,
                "updated_at": now,
            }
        ],
    )
    with op.batch_alter_table("source_entries") as batch:
        batch.add_column(sa.Column("project_id", sa.String(32), nullable=True))
    op.execute(
        sa.text("UPDATE source_entries SET project_id = :project_id").bindparams(
            project_id=DEFAULT_PROJECT_ID
        )
    )
    with op.batch_alter_table("source_entries") as batch:
        batch.alter_column("project_id", existing_type=sa.String(32), nullable=False)
        batch.create_foreign_key(
            "fk_source_entries_project_id_projects",
            "projects",
            ["project_id"],
            ["id"],
        )

    op.create_table(
        "spaces",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("parent_id", sa.String(32), sa.ForeignKey("spaces.id")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "parent_id", "name"),
    )
    _named_table(
        "materials",
        sa.Column("brand", sa.String(200)),
        sa.Column("model", sa.String(200)),
        sa.Column("color", sa.String(200)),
        sa.Column("finish", sa.String(200)),
    )
    _named_table("vendors", sa.Column("contact", sa.String(500)))
    _named_table(
        "participants",
        sa.Column("role", sa.String(100)),
        sa.Column("contact", sa.String(500)),
    )
    _named_table(
        "project_stages",
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_table(
        "records",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("record_type", sa.String(32), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("occurred_at", sa.DateTime(timezone=True)),
        sa.Column("time_precision", sa.String(32), nullable=False, server_default="unknown"),
        sa.Column("original_time_text", sa.Text),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="Asia/Shanghai"),
        sa.Column("stage_id", sa.String(32), sa.ForeignKey("project_stages.id")),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_records_record_type", "records", ["record_type"])

    _detail(
        "event_details",
        sa.Column("event_kind", sa.String(64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("process", sa.Text),
        sa.Column("result", sa.Text),
    )
    _detail(
        "ledger_details",
        sa.Column("direction", sa.String(16), nullable=False),
        sa.Column("payment_kind", sa.String(32), nullable=False),
        sa.Column("amount_minor", sa.Integer, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="CNY"),
        sa.Column("payment_date", sa.Date),
        sa.Column("payment_method", sa.String(100)),
        sa.Column("vendor_id", sa.String(32), sa.ForeignKey("vendors.id")),
    )
    _detail(
        "issue_details",
        sa.Column("discovered_at", sa.DateTime(timezone=True)),
        sa.Column("phenomenon", sa.Text, nullable=False),
        sa.Column("severity", sa.String(32)),
        sa.Column("responsible_party", sa.String(200)),
        sa.Column("handling_plan", sa.Text),
        sa.Column("actual_result", sa.Text),
        sa.Column("resolution_kind", sa.String(32)),
    )
    _detail(
        "measurement_details",
        sa.Column("object_name", sa.String(300), nullable=False),
        sa.Column("measurement_role", sa.String(32), nullable=False),
        sa.Column("approximate", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("tolerance_text", sa.String(200)),
        sa.Column("measured_at", sa.DateTime(timezone=True)),
        sa.Column("method", sa.String(200)),
    )
    op.create_table(
        "measurement_values",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "record_id",
            sa.String(32),
            sa.ForeignKey("measurement_details.record_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("axis", sa.String(50)),
        sa.Column("value", sa.Numeric(18, 4), nullable=False),
        sa.Column("unit", sa.String(32), nullable=False),
        sa.Column("ordinal", sa.Integer, nullable=False),
        sa.UniqueConstraint("record_id", "ordinal"),
    )
    _detail(
        "decision_details",
        sa.Column("topic", sa.String(300), nullable=False),
        sa.Column("options_json", sa.JSON, nullable=False),
        sa.Column("selected_option", sa.Text),
        sa.Column("rationale", sa.Text),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
    )
    _detail(
        "procurement_details",
        sa.Column("item_name", sa.String(300), nullable=False),
        sa.Column("specification", sa.String(500)),
        sa.Column("quantity", sa.Numeric(18, 4)),
        sa.Column("quantity_unit", sa.String(32)),
        sa.Column("vendor_id", sa.String(32), sa.ForeignKey("vendors.id")),
        sa.Column("order_number", sa.String(200)),
        sa.Column("order_total_minor", sa.Integer),
        sa.Column("currency", sa.String(3), nullable=False, server_default="CNY"),
        sa.Column("promised_date", sa.Date),
        sa.Column("delivery_address", sa.Text),
        sa.Column("return_terms", sa.Text),
        sa.Column("acceptance_result", sa.Text),
    )
    _detail(
        "research_details",
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("options_json", sa.JSON, nullable=False),
        sa.Column("dimensions_json", sa.JSON, nullable=False),
        sa.Column("sources_json", sa.JSON, nullable=False),
        sa.Column("conclusion", sa.Text),
        sa.Column("limitations", sa.Text),
    )
    _detail(
        "todo_details",
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("planned_at", sa.DateTime(timezone=True)),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("trigger_condition", sa.Text),
        sa.Column("priority", sa.String(32)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("completion_evidence", sa.Text),
    )

    _association("record_sources", "source_entries", "source_id", evidence=True)
    _association("record_spaces", "spaces", "space_id")
    _association("record_materials", "materials", "material_id")
    _association("record_participants", "participants", "participant_id")
    _association("record_attachments", "attachments", "attachment_id")
    op.create_table(
        "record_relations",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("project_id", sa.String(32), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("from_record_id", sa.String(32), sa.ForeignKey("records.id"), nullable=False),
        sa.Column("to_record_id", sa.String(32), sa.ForeignKey("records.id"), nullable=False),
        sa.Column("relation_type", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("from_record_id <> to_record_id", name="ck_record_relation_not_self"),
        sa.UniqueConstraint("from_record_id", "to_record_id", "relation_type"),
    )


def downgrade() -> None:
    for name in (
        "record_relations",
        "record_attachments",
        "record_participants",
        "record_materials",
        "record_spaces",
        "record_sources",
        "measurement_values",
        "todo_details",
        "research_details",
        "procurement_details",
        "decision_details",
        "measurement_details",
        "issue_details",
        "ledger_details",
        "event_details",
    ):
        op.drop_table(name)
    op.drop_index("ix_records_record_type", table_name="records")
    op.drop_table("records")
    for name in ("project_stages", "participants", "vendors", "materials", "spaces"):
        op.drop_table(name)
    with op.batch_alter_table("source_entries") as batch:
        batch.drop_constraint("fk_source_entries_project_id_projects", type_="foreignkey")
        batch.drop_column("project_id")
    op.drop_table("projects")
