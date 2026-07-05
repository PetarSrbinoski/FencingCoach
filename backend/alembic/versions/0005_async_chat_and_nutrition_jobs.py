"""async_chat_and_nutrition_jobs

Detaches chat replies and nutrition estimates from the HTTP request that
triggers them, so generation keeps running (and its result gets saved)
even if the athlete navigates away — see app/core/background.py.

- `coach_messages`: add `status` (pending|done|error) and `error`. New
  rows default to "done" so existing rows (and any endpoint that still
  inserts synchronously) don't need special-casing.
- `nutrition_estimates`: new table. `POST /nutrition/estimate` used to
  return a result without ever persisting it — this also fixes that,
  giving every estimate request a durable, pollable record.

Revision ID: 0005_async_chat_and_nutrition_jobs
Revises: 0004_app_settings
Create Date: 2026-07-05 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0005_async_chat_and_nutrition_jobs"
down_revision: Union[str, None] = "0004_app_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "coach_messages",
        sa.Column("status", sa.String(length=10), nullable=False, server_default="done"),
    )
    op.add_column("coach_messages", sa.Column("error", sa.Text(), nullable=True))
    op.add_column("coach_messages", sa.Column("meta", postgresql.JSONB(), nullable=True))

    op.create_table(
        "nutrition_estimates",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("kcal", sa.Float(), nullable=True),
        sa.Column("protein_g", sa.Float(), nullable=True),
        sa.Column("carbs_g", sa.Float(), nullable=True),
        sa.Column("fat_g", sa.Float(), nullable=True),
        sa.Column("fiber_g", sa.Float(), nullable=True),
        sa.Column("micros", postgresql.JSONB(), nullable=True),
        sa.Column("items", postgresql.JSONB(), nullable=True),
        sa.Column("confidence", sa.String(length=20), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("nutrition_estimates")
    op.drop_column("coach_messages", "meta")
    op.drop_column("coach_messages", "error")
    op.drop_column("coach_messages", "status")
