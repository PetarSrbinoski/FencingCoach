"""add mental_entries, usda_foods, extend data_summaries

Revision ID: 0003_mental_usda_summaries
Revises: 0002_day_type_overrides
Create Date: 2026-05-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003_mental_usda_summaries"
down_revision = "0002_day_type_overrides"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── mental_entries ────────────────────────────────────────────────
    op.create_table(
        "mental_entries",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("entry_type", sa.String(20), nullable=False),
        sa.Column("mood_score", sa.Integer(), nullable=True),
        sa.Column("energy_score", sa.Integer(), nullable=True),
        sa.Column("focus_score", sa.Integer(), nullable=True),
        sa.Column("confidence_score", sa.Integer(), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("tags", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mental_entries_day", "mental_entries", ["day"])

    # ── usda_foods ────────────────────────────────────────────────────
    op.create_table(
        "usda_foods",
        sa.Column("fdc_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("description_lower", sa.String(500), nullable=False),
        sa.Column("data_type", sa.String(40), nullable=True),
        sa.Column("category", sa.String(200), nullable=True),
        sa.Column("nutrients", JSONB(), nullable=False),
        sa.Column("serving_size_g", sa.Float(), nullable=True),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("fdc_id"),
    )
    op.create_index(
        "ix_usda_foods_description_trgm", "usda_foods", ["description_lower"]
    )

    # ── extend data_summaries with domain column ──────────────────────
    # Drop old constraints/indexes and recreate with domain
    op.drop_constraint("uq_summary_period", "data_summaries", type_="unique")
    op.drop_index("ix_summary_period_start", table_name="data_summaries")

    op.add_column(
        "data_summaries",
        sa.Column("domain", sa.String(30), nullable=False, server_default="general"),
    )

    op.create_unique_constraint(
        "uq_summary_domain_period",
        "data_summaries",
        ["domain", "period", "period_start"],
    )
    op.create_index(
        "ix_summary_domain_period",
        "data_summaries",
        ["domain", "period", "period_start"],
    )

    # Enable pg_trgm extension for fuzzy food search (optional, won't fail if exists)
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")

    op.drop_index("ix_summary_domain_period", table_name="data_summaries")
    op.drop_constraint("uq_summary_domain_period", "data_summaries", type_="unique")
    op.drop_column("data_summaries", "domain")

    op.create_unique_constraint(
        "uq_summary_period", "data_summaries", ["period", "period_start"]
    )
    op.create_index(
        "ix_summary_period_start", "data_summaries", ["period", "period_start"]
    )

    op.drop_index("ix_usda_foods_description_trgm", table_name="usda_foods")
    op.drop_table("usda_foods")

    op.drop_index("ix_mental_entries_day", table_name="mental_entries")
    op.drop_table("mental_entries")
