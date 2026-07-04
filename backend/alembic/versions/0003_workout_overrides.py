"""workout_overrides

Adds a `workout_overrides` table so a specific day's gym session (normally
computed on the fly by `services.training.build_session`) can be manually
replaced — used by the coach chat agent's `update_day_workout` tool.

Revision ID: 0003_workout_overrides
Revises: 0002_garmin_status
Create Date: 2026-07-04 10:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0003_workout_overrides"
down_revision: Union[str, None] = "0002_garmin_status"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workout_overrides",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("session_name", sa.String(length=80), nullable=True),
        sa.Column("exercises", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("day"),
    )


def downgrade() -> None:
    op.drop_table("workout_overrides")
