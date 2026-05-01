"""add day_type_overrides table

Revision ID: 0002_day_type_overrides
Revises: 0001_init
Create Date: 2026-05-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_day_type_overrides"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "day_type_overrides",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("override_type", sa.String(20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("day"),
    )


def downgrade() -> None:
    op.drop_table("day_type_overrides")
