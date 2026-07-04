"""app_settings

Adds a generic `app_settings` key/value table for simple global toggles
(single-user app, no per-user scoping needed). First consumer: the manual
LLM provider toggle (`key="llm_provider"`, `value="local"|"cloud"`).

Revision ID: 0004_app_settings
Revises: 0003_workout_overrides
Create Date: 2026-07-05 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0004_app_settings"
down_revision: Union[str, None] = "0003_workout_overrides"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("value", sa.String(length=200), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
